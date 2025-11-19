#!/usr/bin/env bun
/**
 * File Server with R2 Backup Support
 * 
 * Serves files from the container filesystem and handles backup requests
 * that create tar.gz archives and upload to R2 storage.
 * 
 * Endpoints:
 * - GET /path/to/file - Serve file content
 * - GET /path/to/directory?backup=true - Create tar.gz and upload to R2
 * - GET /path/to/directory?restore=<backup_filename> - Fetch backup from R2 and restore to directory
 * - GET /path/to/directory?list_backups=true - List available backups for the directory
 * 
 * Features:
 * - Multipart concurrent downloads with retries for large files (>= 50 MB)
 * - Automatic HEAD request to check file size before downloading
 * - Configurable chunk size (10 MB) and concurrent download limit (5 chunks at once)
 * - Per-chunk retry logic with exponential backoff
 * - Automatic reconstitution of file from downloaded parts
 * 
 * Why reverse-epoch filenames?
 * - S3-compatible storage (including Cloudflare R2) returns ListObjects results
 *   in lexicographic (alphabetical) ascending order only. There is no server-side
 *   option to sort by last-modified or to request newest-first.
 * - To make an ascending alphabetical listing return the newest backups first,
 *   we prefix backup object keys with a fixed-width reverse-epoch (seconds)
 *   value, followed by a human-readable UTC date (YYYYMMDDHH) and the directory
 *   name: backups/<reverseEpochSec>_<YYYYMMDDHH>_<dir>.tar.gz.
 * - This ensures that simple S3 list calls yield the most recent backups first,
 *   avoiding extra client-side fetching and sorting.
 */

import { spawn } from "bun";
import { file, S3Client } from "bun";
import path from "node:path";
import type { Dirent } from "node:fs";
import { readdir, stat, mkdir, rm } from "node:fs/promises";

const PORT = 8083;

// Use a fixed "max epoch" ~100 years in the future to compute reverse-epoch seconds
// New backup filenames start with this reverse-epoch so lexicographic ascending order
// yields newest-first.
const MAX_EPOCH_SECONDS = Math.floor(new Date('2125-01-01T00:00:00Z').getTime() / 1000);
const REV_SECONDS_WIDTH = String(MAX_EPOCH_SECONDS).length;

function formatUTCDateYYYYMMDDHH(d: Date): string {
  const yyyy = d.getUTCFullYear().toString();
  const MM = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const HH = String(d.getUTCHours()).padStart(2, '0');
  return `${yyyy}${MM}${dd}${HH}`;
}

function generateBackupKey(dirName: string, at: Date = new Date()): string {
  const nowSeconds = Math.floor(at.getTime() / 1000);
  const reverseEpochSeconds = MAX_EPOCH_SECONDS - nowSeconds;
  const reversePart = String(reverseEpochSeconds).padStart(REV_SECONDS_WIDTH, '0');
  const datePart = formatUTCDateYYYYMMDDHH(at);
  // Global ordering by reverse-epoch; include human-readable date and dir name
  return `backups/${reversePart}_${datePart}_${dirName}.tar.gz`;
}

interface BackupResult {
  success: boolean;
  backup_path: string;
  size: number;
  note?: string;
}

interface RestoreResult {
  success: boolean;
  restored_from: string;
  restored_to: string;
  size: number;
  note?: string;
}

interface BackupListItem {
  path: string;
  size: number;
  timestamp: string;
}

interface ListBackupsResult {
  success: boolean;
  directory: string;
  backups: BackupListItem[];
}

type ModpackSource = 'modrinth' | 'curseforge';
type ModpackJobStatus = 'pending' | 'downloading' | 'installing' | 'completed' | 'failed';

interface ModpackJobProgress {
  phase: string;
  currentFile?: string;
  currentIndex?: number;
  totalFiles?: number;
  note?: string;
}

interface ModpackJobResult {
  loader?: 'PAPER' | 'FORGE' | 'FABRIC' | 'NEOFORGE';
  minecraftVersion?: string;
  profileSuggestion?: string;
  packName?: string;
  filesInstalled: number;
  overridesApplied: boolean;
  metadata?: Record<string, unknown>;
}

interface ManagedFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number | null;
  modified: number | null;
}

interface ManagedFileListing {
  root: string;
  path: string;
  parent: string | null;
  entries: ManagedFileEntry[];
}

interface ModpackJob {
  id: string;
  source: ModpackSource;
  status: ModpackJobStatus;
  startedAt: number;
  updatedAt: number;
  progress?: ModpackJobProgress;
  error?: string;
  result?: ModpackJobResult;
}

interface ModrinthInstallPayload {
  url: string;
  packVersion?: string;
}

interface CurseforgeInstallPayload {
  projectId: number;
  fileId: number;
}

interface ModrinthFileEntry {
  path: string;
  downloads: string[];
  hashes?: Record<string, string>;
  env?: {
    server?: 'required' | 'optional' | 'unsupported';
    client?: 'required' | 'optional' | 'unsupported';
  };
  fileSize?: number;
}

interface ModrinthManifest {
  name?: string;
  summary?: string;
  dependencies?: Record<string, string>;
  files: ModrinthFileEntry[];
  overrides?: string;
  versionId?: string;
  project_id?: string;
  projectId?: string;
}

interface CurseforgeManifest {
  name?: string;
  overrides?: string;
  minecraft: {
    version: string;
    modLoaders: Array<{ id: string; primary?: boolean }>;
  };
  files: Array<{
    projectID: number;
    fileID: number;
    required: boolean;
  }>;
}

interface CurseforgePackInfo {
  name: string;
  fileName: string;
  fileId: number;
  downloadUrl: string;
}

const PROFILE_HINTS: Array<{ profileId: string; loader: 'PAPER' | 'FORGE' | 'FABRIC' | 'NEOFORGE'; minecraftVersion: string }> = [
  { profileId: 'paper-1-21-10', loader: 'PAPER', minecraftVersion: '1.21.10' },
  { profileId: 'paper-1-21-8', loader: 'PAPER', minecraftVersion: '1.21.8' },
  { profileId: 'paper-1-21-7', loader: 'PAPER', minecraftVersion: '1.21.7' },
  { profileId: 'paper-1-20-6', loader: 'PAPER', minecraftVersion: '1.20.6' },
  { profileId: 'paper-1-19-4', loader: 'PAPER', minecraftVersion: '1.19.4' },
  { profileId: 'forge-1-20-1', loader: 'FORGE', minecraftVersion: '1.20.1' },
  { profileId: 'forge-1-19-2', loader: 'FORGE', minecraftVersion: '1.19.2' },
  { profileId: 'forge-1-18-2', loader: 'FORGE', minecraftVersion: '1.18.2' },
  { profileId: 'forge-1-16-5', loader: 'FORGE', minecraftVersion: '1.16.5' },
  { profileId: 'neoforge-1-21-1', loader: 'NEOFORGE', minecraftVersion: '1.21.1' },
  { profileId: 'neoforge-1-20-4', loader: 'NEOFORGE', minecraftVersion: '1.20.4' },
  { profileId: 'neoforge-1-20-1', loader: 'NEOFORGE', minecraftVersion: '1.20.1' },
  { profileId: 'fabric-1-21-1', loader: 'FABRIC', minecraftVersion: '1.21.1' },
  { profileId: 'fabric-1-20-1', loader: 'FABRIC', minecraftVersion: '1.20.1' },
  { profileId: 'fabric-1-19-2', loader: 'FABRIC', minecraftVersion: '1.19.2' },
  { profileId: 'fabric-1-18-2', loader: 'FABRIC', minecraftVersion: '1.18.2' },
];

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Multipart download configuration
const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024; // 100 MB
const DOWNLOAD_CHUNK_SIZE = 50 * 1024 * 1024;   // 50 MB per chunk
const MAX_CONCURRENT_DOWNLOADS = 5;            // Download 5 chunks at once

// /**
//  * Retry wrapper for fetch requests to cloud storage
//  * Retries up to MAX_RETRIES times with exponential backoff
//  */
// async function fetchWithRetry(
//   url: string,
//   options: RequestInit,
//   operationName: string
// ): Promise<Response> {
//   let lastError: Error | null = null;
//   for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
//     try {
//       console.log(`[FileServer] ${operationName}: Attempt ${attempt}/${MAX_RETRIES}`);
//       const response = await fetch(url, options);
      
//       // Return response (caller will check if it's ok)
//       return response;
//     } catch (error: any) {
//       lastError = error;
//       console.warn(
//         `[FileServer] ${operationName}: Attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`
//       );

//       // Don't wait after the last attempt
//       if (attempt < MAX_RETRIES) {
//         const delayMs = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
//         console.log(`[FileServer] ${operationName}: Retrying in ${delayMs}ms...`);
//         await new Promise(resolve => setTimeout(resolve, delayMs));
//       }
//     }
//   }

//   // All retries failed
//   throw new Error(
//     `${operationName} failed after ${MAX_RETRIES} attempts: ${lastError?.message}`
//   );
// }

/**
 * Download a specific byte range from S3 with retries
 */
async function downloadRangeWithRetry(
  s3Client: S3Client,
  key: string,
  start: number,
  end: number,
  partNumber: number,
  totalParts: number
): Promise<ArrayBuffer> {
  let lastError: Error | null = null;
  const rangeSize = end - start + 1;
  const rangeSizeKB = (rangeSize / 1024).toFixed(2);
  
  console.log(
    `[FileServer] [Part ${partNumber}/${totalParts}] Starting download of bytes ${start}-${end} (${rangeSizeKB} KB)`
  );
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[FileServer] [Part ${partNumber}/${totalParts}] Attempt ${attempt}/${MAX_RETRIES}`
      );
      
      // Construct direct S3 URL for range request
      const endpoint = process.env.AWS_ENDPOINT_URL;
      const bucket = process.env.DATA_BUCKET_NAME || process.env.DYNMAP_BUCKET;
      const url = `${endpoint}/${bucket}/${key}`;
      
      console.log(
        `[FileServer] [Part ${partNumber}/${totalParts}] Fetching from: ${url}`
      );
      console.log(
        `[FileServer] [Part ${partNumber}/${totalParts}] Range header: bytes=${start}-${end}`
      );
      
      const fetchStartTime = Date.now();
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Range": `bytes=${start}-${end}`,
        },
      });
      const fetchDuration = Date.now() - fetchStartTime;
      
      console.log(
        `[FileServer] [Part ${partNumber}/${totalParts}] Response received in ${fetchDuration}ms, status: ${response.status}`
      );
      
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '(unable to read body)');
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorBody}`);
      }
      
      console.log(
        `[FileServer] [Part ${partNumber}/${totalParts}] Reading response body...`
      );
      const readStartTime = Date.now();
      const data = await response.arrayBuffer();
      const readDuration = Date.now() - readStartTime;
      const totalDuration = Date.now() - fetchStartTime;
      
      console.log(
        `[FileServer] [Part ${partNumber}/${totalParts}] ✓ Downloaded ${data.byteLength} bytes (expected ${rangeSize}) in ${totalDuration}ms (fetch: ${fetchDuration}ms, read: ${readDuration}ms)`
      );
      
      if (data.byteLength !== rangeSize) {
        console.warn(
          `[FileServer] [Part ${partNumber}/${totalParts}] WARNING: Size mismatch! Expected ${rangeSize}, got ${data.byteLength}`
        );
      }
      
      return data;
    } catch (error: any) {
      lastError = error;
      console.error(
        `[FileServer] [Part ${partNumber}/${totalParts}] ✗ Attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`
      );
      if (error.code) {
        console.error(`[FileServer] [Part ${partNumber}/${totalParts}] Error code: ${error.code}`);
      }
      
      if (attempt < MAX_RETRIES) {
        const delayMs = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[FileServer] [Part ${partNumber}/${totalParts}] Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  console.error(
    `[FileServer] [Part ${partNumber}/${totalParts}] All ${MAX_RETRIES} attempts exhausted`
  );
  throw new Error(
    `Failed to download part ${partNumber}/${totalParts} after ${MAX_RETRIES} attempts: ${lastError?.message}`
  );
}

/**
 * Download large file from S3 using concurrent multipart downloads
 */
async function downloadLargeFile(
  s3Client: S3Client,
  key: string,
  tempFile: string,
  fileSize: number
): Promise<void> {
  const downloadStartTime = Date.now();
  console.log(
    `[FileServer] Starting multipart download: ${key} (${(fileSize / (1024 * 1024)).toFixed(2)} MB)`
  );
  
  // Calculate number of parts
  const numParts = Math.ceil(fileSize / DOWNLOAD_CHUNK_SIZE);
  console.log(`[FileServer] Configuration:`);
  console.log(`[FileServer]   - File size: ${fileSize} bytes (${(fileSize / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`[FileServer]   - Chunk size: ${DOWNLOAD_CHUNK_SIZE} bytes (${(DOWNLOAD_CHUNK_SIZE / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`[FileServer]   - Total parts: ${numParts}`);
  console.log(`[FileServer]   - Max concurrent: ${MAX_CONCURRENT_DOWNLOADS}`);
  console.log(`[FileServer]   - Total batches: ${Math.ceil(numParts / MAX_CONCURRENT_DOWNLOADS)}`);
  
  // Create array of download tasks
  const downloadTasks: Array<{
    partNumber: number;
    start: number;
    end: number;
    tempFile: string;
  }> = [];
  
  for (let i = 0; i < numParts; i++) {
    const start = i * DOWNLOAD_CHUNK_SIZE;
    const end = Math.min(start + DOWNLOAD_CHUNK_SIZE - 1, fileSize - 1);
    downloadTasks.push({
      partNumber: i + 1,
      start,
      end,
      tempFile: `${tempFile}.part${i}`,
    });
  }
  console.log(`[FileServer] Download tasks created`);
  
  // Download parts concurrently with controlled concurrency
  const downloadPart = async (task: typeof downloadTasks[0]) => {
    const partStartTime = Date.now();
    const data = await downloadRangeWithRetry(
      s3Client,
      key,
      task.start,
      task.end,
      task.partNumber,
      numParts
    );
    
    // Write part to temp file
    const writeStartTime = Date.now();
    await Bun.write(task.tempFile, data);
    const writeDuration = Date.now() - writeStartTime;
    const totalPartDuration = Date.now() - partStartTime;
    console.log(
      `[FileServer] [Part ${task.partNumber}/${numParts}] Written to ${task.tempFile} in ${writeDuration}ms (total: ${totalPartDuration}ms)`
    );
  };
  
  // Process downloads with controlled concurrency
  console.log(`[FileServer] ======== BATCH DOWNLOADS START ========`);
  const batchStartTime = Date.now();
  const results: Promise<void>[] = [];
  let completedParts = 0;
  
  for (let i = 0; i < downloadTasks.length; i += MAX_CONCURRENT_DOWNLOADS) {
    const batchNumber = Math.floor(i / MAX_CONCURRENT_DOWNLOADS) + 1;
    const totalBatches = Math.ceil(numParts / MAX_CONCURRENT_DOWNLOADS);
    const batch = downloadTasks.slice(i, i + MAX_CONCURRENT_DOWNLOADS);
    
    console.log(
      `[FileServer] -------- Batch ${batchNumber}/${totalBatches} --------`
    );
    console.log(
      `[FileServer] Downloading parts ${batch[0].partNumber}-${batch[batch.length - 1].partNumber} concurrently...`
    );
    
    const batchItemStartTime = Date.now();
    const batchPromises = batch.map(task => downloadPart(task));
    await Promise.all(batchPromises);
    const batchItemDuration = Date.now() - batchItemStartTime;
    
    completedParts += batch.length;
    const progress = ((completedParts / numParts) * 100).toFixed(1);
    console.log(
      `[FileServer] Batch ${batchNumber}/${totalBatches} complete in ${(batchItemDuration / 1000).toFixed(2)}s (${progress}% done)`
    );
    
    results.push(...batchPromises);
  }
  
  const batchDuration = Date.now() - batchStartTime;
  console.log(`[FileServer] ======== BATCH DOWNLOADS COMPLETE ========`);
  console.log(`[FileServer] All ${numParts} parts downloaded in ${(batchDuration / 1000).toFixed(2)}s`);
  
  console.log(`[FileServer] ======== FILE RECONSTITUTION START ========`);
  console.log(`[FileServer] Reconstituting file from ${numParts} parts...`);
  
  const reconStartTime = Date.now();
  // Reconstitute the file from parts
  const targetFile = Bun.file(tempFile).writer();
  
  for (let i = 0; i < numParts; i++) {
    const partFile = `${tempFile}.part${i}`;
    const partData = await Bun.file(partFile).arrayBuffer();
    targetFile.write(partData);
    
    if ((i + 1) % 10 === 0 || i === numParts - 1) {
      console.log(`[FileServer] Reconstitution progress: ${i + 1}/${numParts} parts merged`);
    }
    
    // Clean up part file
    try {
      await unlink(partFile);
    } catch (e) {
      console.warn(`[FileServer] Failed to clean up part file ${partFile}: ${e}`);
    }
  }
  
  await targetFile.end();
  
  const reconDuration = Date.now() - reconStartTime;
  const totalDuration = Date.now() - downloadStartTime;
  
  console.log(`[FileServer] ======== FILE RECONSTITUTION COMPLETE ========`);
  console.log(`[FileServer] Reconstitution took ${(reconDuration / 1000).toFixed(2)}s`);
  console.log(`[FileServer] Total multipart download time: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`[FileServer] Average speed: ${((fileSize / (1024 * 1024)) / (totalDuration / 1000)).toFixed(2)} MB/s`);
  console.log(`[FileServer] File saved to: ${tempFile}`);
}

/**
 * Create an S3Client instance with credentials from environment variables
 */
function createS3Client(bucketName: 'dynmap' | 'data'): S3Client {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const endpoint = process.env.AWS_ENDPOINT_URL;
  const bucket = bucketName === 'data' ? process.env.DATA_BUCKET_NAME : process.env.DYNMAP_BUCKET;

  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) {
    throw new Error("Missing AWS credentials in environment");
  }

  return new S3Client({
    accessKeyId,
    secretAccessKey,
    endpoint,
    bucket,
    virtualHostedStyle: false,
  });
}

class FileServer {
  private requestCount = 0;
  private backupCount = 0;
  private restoreCount = 0;
  private activeRestores = 0;
  private backupJobs: Map<string, {
    id: string;
    directory: string;
    status: "pending" | "running" | "success" | "failed";
    startedAt: number;
    completedAt?: number;
    result?: { backup_path: string; size: number; note?: string };
    error?: string;
  }> = new Map();
  private modpackJobs: Map<string, ModpackJob> = new Map();
  private readonly managedRoots: string[];

  constructor() {
    this.managedRoots = (process.env.FILE_MANAGER_ROOTS || '/data')
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean)
      .map(root => root.startsWith('/') ? root : `/${root}`)
      .map(root => root === '/' ? '/' : root.replace(/\/+$/, ''));
    if (this.managedRoots.length === 0) {
      this.managedRoots.push('/data');
    }
  }

  private jsonResponse(data: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
    const body = JSON.stringify(data);
    const byteLength = new TextEncoder().encode(body).length;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Content-Length": String(byteLength),
      ...(init?.headers || {}),
    };
    return new Response(body, { status: init?.status ?? 200, headers });
  }

  private isMaintenanceModeEnabled(): boolean {
    return (process.env.MAINTENANCE_MODE || '').toLowerCase() === 'true';
  }

  private ensureMaintenanceModeEnabled() {
    if (!this.isMaintenanceModeEnabled()) {
      throw new Error('Maintenance mode must be enabled before installing a modpack. Stop the server and enter maintenance mode from the Mineflare dashboard.');
    }
  }

  private resolveManagedPath(rawPath: string | null | undefined, options?: { allowRootFallback?: boolean }): { absolute: string; root: string; parent: string | null } {
    const allowFallback = options?.allowRootFallback !== false;
    const candidate = rawPath && rawPath.trim().length ? rawPath.trim() : (allowFallback ? this.managedRoots[0] : null);
    if (!candidate) {
      throw new Error('Path is required');
    }

    const normalizedInput = candidate.startsWith('/') ? candidate : `/${candidate}`;
    const absolutePath = path.posix.resolve('/', path.posix.normalize(normalizedInput));

    for (const root of this.managedRoots) {
      if (root === '/' || absolutePath === root || absolutePath.startsWith(`${root}/`)) {
        return {
          absolute: absolutePath,
          root,
          parent: this.computeParent(root, absolutePath)
        };
      }
    }

    throw new Error('Path is outside managed roots');
  }

  private computeParent(root: string, absolute: string): string | null {
    if (absolute === root) {
      return null;
    }
    const candidate = path.posix.dirname(absolute);
    if (candidate.length < root.length) {
      return root;
    }
    if (!candidate.startsWith(root)) {
      return root;
    }
    return candidate;
  }

  private async describeEntry(entry: Dirent, basePath: string): Promise<ManagedFileEntry> {
    const entryPath = path.posix.join(basePath, entry.name);
    let statsInfo: Awaited<ReturnType<typeof stat>> | null = null;
    try {
      statsInfo = await stat(entryPath);
    } catch {
      // Ignore stat errors for broken symlinks, etc.
    }

    const type: ManagedFileEntry['type'] = entry.isDirectory()
      ? 'directory'
      : entry.isSymbolicLink()
        ? 'symlink'
        : 'file';

    return {
      name: entry.name,
      path: entryPath,
      type,
      size: statsInfo && statsInfo.isFile() ? statsInfo.size : null,
      modified: statsInfo ? statsInfo.mtimeMs : null,
    };
  }

  private generateJobId(source: ModpackSource): string {
    const random = Math.random().toString(36).slice(2, 8);
    return `${source}-${Date.now().toString(36)}-${random}`;
  }

  async start() {
    console.log(`[FileServer] Starting on port ${PORT}...`);

    const self = this;
    const server = Bun.serve({
      port: PORT,
      idleTimeout: 255, // THis is essential to support large uploads
      hostname: "0.0.0.0",
      async fetch(req) {
        return await self.handleRequest(req);
      },
      error(error) {
        console.error("[FileServer] Error:", error);
        return new Response("Internal Server Error", { status: 500 });
      },
    });

    console.log(`[FileServer] Listening on ${server.hostname}:${server.port}`);
    
    // Start periodic status logger
    // Default: 60 seconds (1 minute), configurable via STATUS_LOG_INTERVAL_SECONDS env var
    const statusLogIntervalSeconds = process.env.STATUS_LOG_INTERVAL_SECONDS 
      ? parseInt(process.env.STATUS_LOG_INTERVAL_SECONDS, 10) 
      : 60;
    const statusLogIntervalMs = statusLogIntervalSeconds * 1000;
    
    console.log(`[FileServer] Status logging interval: ${statusLogIntervalSeconds} seconds`);
    
    setInterval(() => {
      const restoreStatus = self.activeRestores > 0 ? ` | Restore in progress (${self.activeRestores})` : '';
      console.log(
        `[FileServer Status] Requests: ${self.requestCount} | Backups: ${self.backupCount} | Restores: ${self.restoreCount}${restoreStatus}`
      );
    }, statusLogIntervalMs);
  }

  private async handleListFiles(url: URL): Promise<Response> {
    try {
      const target = this.resolveManagedPath(url.searchParams.get('path'), { allowRootFallback: true });
      const entries = await readdir(target.absolute, { withFileTypes: true });
      const listing = await Promise.all(entries.map(entry => this.describeEntry(entry, target.absolute)));
      listing.sort((a, b) => {
        if (a.type === b.type) {
          return a.name.localeCompare(b.name);
        }
        if (a.type === 'directory') return -1;
        if (b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      });
      const payload: ManagedFileListing = {
        root: target.root,
        path: target.absolute,
        parent: target.parent,
        entries: listing,
      };
      return this.jsonResponse(payload, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error: any) {
      const message = error?.message || 'Failed to list files';
      const status = message.includes('outside') ? 403 : message.includes('required') ? 400 : 500;
      return this.jsonResponse({ error: message }, { status });
    }
  }

  private async handleReadFile(url: URL): Promise<Response> {
    try {
      const target = this.resolveManagedPath(url.searchParams.get('path'), { allowRootFallback: false });
      try {
        await stat(target.absolute);
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          return new Response('File not found', { status: 404 });
        }
        throw err;
      }
      const fileHandle = Bun.file(target.absolute);
      const buffer = await fileHandle.arrayBuffer();
      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store'
        }
      });
    } catch (error: any) {
      const message = error?.message || 'Failed to read file';
      const status = message.includes('outside') ? 403 : message.includes('required') ? 400 : 500;
      return this.jsonResponse({ error: message }, { status });
    }
  }

  private async handleWriteFile(url: URL, req: Request): Promise<Response> {
    try {
      this.ensureMaintenanceModeEnabled();
      const target = this.resolveManagedPath(url.searchParams.get('path'), { allowRootFallback: false });
      const buffer = await req.arrayBuffer();
      await mkdir(path.posix.dirname(target.absolute), { recursive: true });
      await Bun.write(target.absolute, buffer);
      return this.jsonResponse({ success: true, path: target.absolute });
    } catch (error: any) {
      const message = error?.message || 'Failed to write file';
      const status = message.includes('maintenance') ? 400 : message.includes('outside') ? 403 : 500;
      return this.jsonResponse({ error: message }, { status });
    }
  }

  private async handleDeletePath(url: URL): Promise<Response> {
    try {
      this.ensureMaintenanceModeEnabled();
      const target = this.resolveManagedPath(url.searchParams.get('path'), { allowRootFallback: false });
      await rm(target.absolute, { recursive: true, force: true });
      return this.jsonResponse({ success: true, path: target.absolute });
    } catch (error: any) {
      const message = error?.message || 'Failed to delete path';
      const status = message.includes('maintenance') ? 400 : message.includes('outside') ? 403 : 500;
      return this.jsonResponse({ error: message }, { status });
    }
  }

  private async handleCreateDirectory(req: Request): Promise<Response> {
    try {
      this.ensureMaintenanceModeEnabled();
      let body: { path?: string } | null = null;
      try {
        body = await req.json();
      } catch {
        // Ignore - validation below
      }
      const rawPath = body?.path;
      if (!rawPath || !rawPath.trim()) {
        return this.jsonResponse({ error: 'Directory path is required' }, { status: 400 });
      }
      const target = this.resolveManagedPath(rawPath, { allowRootFallback: false });
      await mkdir(target.absolute, { recursive: true });
      return this.jsonResponse({ success: true, path: target.absolute });
    } catch (error: any) {
      const message = error?.message || 'Failed to create directory';
      const status = message.includes('maintenance') ? 400 : message.includes('outside') ? 403 : 500;
      return this.jsonResponse({ error: message }, { status });
    }
  }

  private async handleRequest(req: Request): Promise<Response> {
    this.requestCount++;
    
    const url = new URL(req.url);
    if (url.pathname === '/fs/list' && req.method === 'GET') {
      return this.handleListFiles(url);
    }
    if (url.pathname === '/fs/file' && req.method === 'GET') {
      return this.handleReadFile(url);
    }
    if (url.pathname === '/fs/file' && req.method === 'PUT') {
      return this.handleWriteFile(url, req);
    }
    if (url.pathname === '/fs/file' && req.method === 'DELETE') {
      return this.handleDeletePath(url);
    }
    if (url.pathname === '/fs/directory' && req.method === 'POST') {
      return this.handleCreateDirectory(req);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/modpack/status/')) {
      const id = url.pathname.replace('/modpack/status/', '').trim();
      if (!id) {
        return this.jsonResponse({ error: 'Missing job id' }, { status: 400 });
      }
      return this.handleModpackStatus(id);
    }
    if (req.method === 'POST' && url.pathname === '/modpack/install/modrinth') {
      return await this.handleModrinthInstall(req);
    }
    if (req.method === 'POST' && url.pathname === '/modpack/install/curseforge') {
      return await this.handleCurseforgeInstall(req);
    }
    // Background backup status endpoint
    if (url.pathname === "/backup-status") {
      const id = url.searchParams.get("id");
      if (!id) {
        return this.jsonResponse({ error: "Missing id" }, { status: 400 });
      }
      const job = this.backupJobs.get(id);
      if (!job) {
        return this.jsonResponse({ id, status: "not_found" });
      }
      return this.jsonResponse({
        id: job.id,
        directory: job.directory,
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt ?? null,
        result: job.result ?? null,
        error: job.error ?? null,
      });
    }
    const isBackup = url.searchParams.get("backup")?.toLowerCase() === "true";
    const restoreParam = url.searchParams.get("restore");
    const isListBackups = url.searchParams.get("list_backups")?.toLowerCase() === "true";

    if (isBackup) {
      const id = url.searchParams.get("backup_id");
      if (id) {
        // Start background backup and return immediately
        return await this.handleBackgroundBackupStart(url.pathname, id);
      }
      return await this.handleBackup(url.pathname);
    } else if (restoreParam) {
      return await this.handleRestore(url.pathname, restoreParam);
    } else if (isListBackups) {
      return await this.handleListBackups(url.pathname);
    } else {
      return await this.handleFileServe(url.pathname);
    }
  }

  private async handleModpackStatus(id: string): Promise<Response> {
    const job = this.modpackJobs.get(id);
    if (!job) {
      return this.jsonResponse({ id, status: 'not_found' }, { status: 404 });
    }
    return this.jsonResponse(job);
  }

  private async handleModrinthInstall(req: Request): Promise<Response> {
    let payload: ModrinthInstallPayload;
    try {
      payload = await req.json();
    } catch (error) {
      return this.jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
    const packVersion = typeof payload?.packVersion === 'string' ? payload.packVersion.trim() : undefined;

    if (!url) {
      return this.jsonResponse({ error: 'Missing Modrinth pack URL' }, { status: 400 });
    }

    try {
      this.ensureMaintenanceModeEnabled();
    } catch (error: any) {
      return this.jsonResponse({ error: error?.message || 'Maintenance mode is required' }, { status: 400 });
    }

    const jobId = this.generateJobId('modrinth');
    const job: ModpackJob = {
      id: jobId,
      source: 'modrinth',
      status: 'pending',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      progress: { phase: 'queued' },
    };
    this.modpackJobs.set(jobId, job);

    this.processModrinthJob(job, { url, packVersion }).catch((error) => {
      console.error('[FileServer] Modrinth install failed:', error);
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      job.progress = { phase: 'failed', note: job.error };
      job.updatedAt = Date.now();
    });

    return this.jsonResponse({ id: jobId, status: job.status });
  }

  private async handleCurseforgeInstall(req: Request): Promise<Response> {
    let payload: CurseforgeInstallPayload;
    try {
      payload = await req.json();
    } catch (error) {
      return this.jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const projectId = Number(payload?.projectId);
    const fileId = Number(payload?.fileId);

    if (!Number.isFinite(projectId) || !Number.isFinite(fileId)) {
      return this.jsonResponse({ error: 'projectId and fileId are required numeric values' }, { status: 400 });
    }

    try {
      this.ensureMaintenanceModeEnabled();
    } catch (error: any) {
      return this.jsonResponse({ error: error?.message || 'Maintenance mode is required' }, { status: 400 });
    }

    if (!process.env.CURSEFORGE_API_KEY) {
      return this.jsonResponse({ error: 'CURSEFORGE_API_KEY is not configured on the container' }, { status: 400 });
    }

    const jobId = this.generateJobId('curseforge');
    const job: ModpackJob = {
      id: jobId,
      source: 'curseforge',
      status: 'pending',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      progress: { phase: 'queued' },
    };
    this.modpackJobs.set(jobId, job);

    this.processCurseforgeJob(job, { projectId, fileId }).catch((error) => {
      console.error('[FileServer] CurseForge install failed:', error);
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      job.progress = { phase: 'failed', note: job.error };
      job.updatedAt = Date.now();
    });

    return this.jsonResponse({ id: jobId, status: job.status });
  }

  private async handleBackgroundBackupStart(pathname: string, id: string): Promise<Response> {
    // Normalize directory path
    let directory = pathname;
    if (!directory.startsWith("/")) {
      directory = "/" + directory;
    }

    // If already exists, return its current state
    const existing = this.backupJobs.get(id);
    if (existing) {
      return this.jsonResponse({
        id: existing.id,
        directory: existing.directory,
        status: existing.status,
        startedAt: existing.startedAt,
        completedAt: existing.completedAt ?? null,
      });
    }

    // Create new job
    const job = {
      id,
      directory,
      status: "pending" as const,
      startedAt: Date.now(),
    };
    this.backupJobs.set(id, job);
    this.backupCount++;
    console.log(`[FileServer] Background backup job created: ${id} for ${directory}`);

    // Start async work (do not await)
    this.executeBackupJob(job).then(r => {
      console.log(`[FileServer] Background backup job completed: ${id} for ${directory}`);
      return r;
    }).catch((err) => {
      const j = this.backupJobs.get(id);
      if (j) {
        j.status = "failed";
        j.completedAt = Date.now();
        j.error = String(err?.message || err);
        this.backupJobs.set(id, j);
      }
      console.error(`[FileServer] Background backup job failed: ${id}`, err);
    });

    return this.jsonResponse({
      id,
      started: true,
      directory,
      status: job.status,
      startedAt: job.startedAt,
    });
  }

  private async executeBackupJob(job: { id: string; directory: string; status: "pending" | "running" | "success" | "failed"; startedAt: number; completedAt?: number; result?: { backup_path: string; size: number; note?: string }; error?: string; }): Promise<void> {
    const { id, directory } = job;
    console.log(`[FileServer] Starting background backup execution for ${id}: ${directory}`);

    try {
      job.status = "running";
      this.backupJobs.set(id, job);

      // Create S3 client
      const s3Client = createS3Client('data');

      // Generate backup filename using reverse-epoch seconds for newest-first lex order
      const now = new Date();
      const dirName = directory.split("/").filter(Boolean).pop() || "backup";
      const backupFilename = generateBackupKey(dirName, now);

      console.log(`[FileServer] [${id}] Creating backup: ${directory} -> ${backupFilename}`);

      // Create tar.gz archive using tar command
      // Note: By default tar stores symlinks as symlinks (doesn't follow them)
      const tempFile = `/tmp/backup_${formatUTCDateYYYYMMDDHH(new Date())}_${id}.tar.gz`;
      const tarProc = spawn([
        "tar",
        "-czf",
        tempFile,
        "--exclude=./logs",           // Exclude logs directory if it exists
        "--exclude=./cache",          // Exclude cache directory if it exists
        "-C",
        directory.substring(0, directory.lastIndexOf("/")) || "/",
        dirName,
      ]);
      const tarExit = await tarProc.exited;
      if (tarExit !== 0) {
        const stderr = await new Response(tarProc.stderr).text();
        const stdout = await new Response(tarProc.stdout).text();
        console.error(`[FileServer] [${id}] tar stderr: ${stderr}`);
        console.error(`[FileServer] [${id}] tar stdout: ${stdout}`);
        throw new Error(`tar command failed with exit code ${tarExit}: ${stderr || stdout || 'no error output'}`);
      }

      console.log(`[FileServer] [${id}] Archive created: ${tempFile}`);

      // Get file size
      const tarFile = Bun.file(tempFile);
      const tarStat = await tarFile.stat();
      const fileSize = tarStat?.size || 0;
      const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
      console.log(`[FileServer] [${id}] Archive size: ${fileSize} bytes (${fileSizeMB} MB)`);

      // // Calculate MD5 hash by streaming the file
      // const md5Hash = await this.calculateMD5FromFile(tempFile);
      // console.log(`[FileServer] [${id}] Archive MD5: ${md5Hash}`);

      // // Check for existing backup
      // const existingBackup = await this.findExistingBackupByMD5(
      //   s3Client,
      //   dirName,
      //   md5Hash
      // );
      // if (existingBackup) {
      //   console.log(`[FileServer] [${id}] Found existing backup with same MD5: ${existingBackup.path}`);
      //   try { await unlink(tempFile); } catch {}
      //   job.status = "success";
      //   job.completedAt = Date.now();
      //   job.result = { backup_path: existingBackup.path, size: existingBackup.size, note: "Duplicate backup skipped (same content already exists)." };
      //   this.backupJobs.set(id, job);
      //   console.log(`[FileServer] [${id}] Background backup marked success (duplicate)`);
      //   return;
      // }

      console.log(`[FileServer] [${id}] Uploading to S3: ${backupFilename} (streaming from disk)`);
      const fileForUpload = Bun.file(tempFile);
      await s3Client.write(backupFilename, fileForUpload, {
        type: "application/x-tar",
      });
      try {
        await Bun.write(tempFile, "");
        await unlink(tempFile);
      } catch {
        console.error(`[FileServer] [${id}] Failed to clean up temp file: ${tempFile}`);
      }

      console.log(`[FileServer] [${id}] Backup completed successfully`);
      job.status = "success";
      job.completedAt = Date.now();
      job.result = { backup_path: backupFilename, size: fileSize, note: "complete backup" };
      this.backupJobs.set(id, job);
    } catch (error: any) {
      job.status = "failed";
      job.completedAt = Date.now();
      job.error = `Backup failed: ${error?.message || String(error)}`;
      this.backupJobs.set(id, job);
      console.error(`[FileServer] [${id}] ${job.error}`);
    }
  }

  private async processModrinthJob(job: ModpackJob, payload: ModrinthInstallPayload) {
    const tempDir = `/tmp/modpack-${job.id}`;
    await ensureDirectory(tempDir);

    try {
      job.status = 'downloading';
      job.progress = { phase: 'Resolving Modrinth metadata' };
      job.updatedAt = Date.now();

      const resolution = await this.resolveModrinthDownload(payload.url, payload.packVersion);

      const archivePath = path.join(tempDir, 'pack.mrpack');
      job.progress = { phase: 'Downloading pack archive', note: resolution.packName };
      job.updatedAt = Date.now();
      const archiveBuffer = await this.downloadFileToPath(resolution.downloadUrl, archivePath, undefined, job, `Pack ${resolution.versionId || ''}`);
      console.log(`[FileServer] Downloaded Modrinth archive (${archiveBuffer.byteLength} bytes)`);

      job.progress = { phase: 'Extracting pack archive' };
      job.updatedAt = Date.now();
      await this.extractArchive(archivePath, tempDir);

      const manifestPath = path.join(tempDir, 'modrinth.index.json');
      const manifest = await this.loadModrinthManifest(manifestPath);
      job.progress = { phase: 'Preparing filesystem for install' };
      job.updatedAt = Date.now();
      await this.resetModsDirectory();

      const overridesDirName = manifest.overrides || 'overrides';
      const overridesPath = path.join(tempDir, overridesDirName);
      const overridesApplied = await this.applyOverrides(overridesPath);

      job.status = 'installing';
      job.updatedAt = Date.now();
      const installInfo = await this.installModrinthFiles(manifest, job);

      job.status = 'completed';
      job.progress = { phase: 'completed', note: 'Modpack installation finished' };
      job.result = {
        loader: installInfo.loader,
        minecraftVersion: installInfo.minecraftVersion,
        profileSuggestion: this.recommendProfile(installInfo.loader, installInfo.minecraftVersion),
        packName: manifest.name || resolution.packName,
        filesInstalled: installInfo.installedCount,
        overridesApplied,
        metadata: {
          modrinthProjectId: resolution.projectId,
          modrinthVersionId: resolution.versionId,
        },
      };
      job.updatedAt = Date.now();
    } finally {
      await removePath(tempDir);
    }
  }

  private async processCurseforgeJob(job: ModpackJob, payload: CurseforgeInstallPayload) {
    const tempDir = `/tmp/curseforge-${job.id}`;
    await ensureDirectory(tempDir);

    try {
      job.status = 'downloading';
      job.progress = { phase: 'Resolving CurseForge metadata' };
      job.updatedAt = Date.now();

      const packInfo = await this.fetchCurseforgePack(payload.projectId, payload.fileId);

      const archivePath = path.join(tempDir, packInfo.fileName);
      job.progress = { phase: 'Downloading pack archive', note: packInfo.name };
      job.updatedAt = Date.now();
      await this.downloadFileToPath(packInfo.downloadUrl, archivePath, undefined, job, `Pack ${packInfo.fileId}`);

      job.progress = { phase: 'Extracting pack archive' };
      job.updatedAt = Date.now();
      await this.extractArchive(archivePath, tempDir);

      const manifestPath = path.join(tempDir, 'manifest.json');
      const manifest = await this.loadCurseforgeManifest(manifestPath);

      job.progress = { phase: 'Preparing filesystem for install' };
      job.updatedAt = Date.now();
      await this.resetModsDirectory();

      const overridesDir = manifest.overrides ? path.join(tempDir, manifest.overrides) : path.join(tempDir, 'overrides');
      const overridesApplied = await this.applyOverrides(overridesDir);

      job.status = 'installing';
      job.updatedAt = Date.now();
      const installInfo = await this.installCurseforgeFiles(manifest, job);

      job.status = 'completed';
      job.progress = { phase: 'completed', note: 'Modpack installation finished' };
      job.result = {
        loader: installInfo.loader,
        minecraftVersion: installInfo.minecraftVersion,
        profileSuggestion: this.recommendProfile(installInfo.loader, installInfo.minecraftVersion),
        packName: packInfo.name,
        filesInstalled: installInfo.installedCount,
        overridesApplied,
        metadata: {
          curseforgeProjectId: payload.projectId,
          curseforgeFileId: payload.fileId,
        },
      };
      job.updatedAt = Date.now();
    } finally {
      await removePath(tempDir);
    }
  }

  private async resolveModrinthDownload(url: string, versionHint?: string): Promise<{ downloadUrl: string; packName: string; projectId?: string; versionId?: string }> {
    let downloadUrl = url;
    let packName = 'Modrinth Pack';
    let projectId: string | undefined;
    let versionId = versionHint;

    const parsed = new URL(url);
    if (parsed.pathname.endsWith('.mrpack')) {
      const parts = parsed.pathname.split('/');
      packName = parts.pop() || packName;
      return { downloadUrl: url, packName, projectId: parsed.searchParams.get('projectId') || undefined, versionId: parsed.searchParams.get('versionId') || versionId };
    }
    const slug = this.extractModrinthSlug(parsed);
    if (!versionHint && parsed.pathname.includes('/version/')) {
      const segments = parsed.pathname.split('/').filter(Boolean);
      versionId = segments[segments.indexOf('version') + 1];
    }

    const project = await this.modrinthRequest<any>(`/project/${slug}`);
    projectId = project?.project_id || project?.id || slug;
    packName = project?.title || packName;

    let versionData: any;
    if (versionId) {
      versionData = await this.modrinthRequest<any>(`/project/${slug}/version/${versionId}`);
    } else {
      const versions = await this.modrinthRequest<any[]>(`/project/${slug}/version`);
      versionData = this.pickPreferredModrinthVersion(versions);
    }

    if (!versionData) {
      throw new Error('Unable to locate Modrinth version');
    }

    versionId = versionData.id;
    const fileEntry = Array.isArray(versionData.files) && versionData.files.length > 0
      ? (versionData.files.find((f: any) => f.primary) || versionData.files[0])
      : null;
    if (!fileEntry?.url) {
      throw new Error('Modrinth version is missing downloadable files');
    }

    downloadUrl = fileEntry.url;
    packName = versionData.name || packName;

    return { downloadUrl, packName, projectId, versionId };
  }

  private extractModrinthSlug(parsed: URL): string {
    const segments = parsed.pathname.split('/').filter(Boolean);
    const modpackIdx = segments.findIndex((segment) => segment === 'modpack');
    if (modpackIdx >= 0 && segments[modpackIdx + 1]) {
      return segments[modpackIdx + 1];
    }
    return segments[segments.length - 1] || parsed.hostname;
  }

  private async modrinthRequest<T>(pathname: string): Promise<T> {
    const response = await fetch(`https://api.modrinth.com/v2${pathname}`);
    if (!response.ok) {
      throw new Error(`Modrinth API request failed (${response.status})`);
    }
    return await response.json() as T;
  }

  private pickPreferredModrinthVersion(versions: any[]): any {
    if (!Array.isArray(versions) || versions.length === 0) {
      return null;
    }
    const release = versions.find((version) => version.version_type === 'release');
    return release || versions[0];
  }

  private async downloadFileToPath(
    url: string,
    destination: string,
    headers?: Record<string, string>,
    job?: ModpackJob,
    description?: string
  ): Promise<ArrayBuffer> {
    console.log(`[FileServer] Downloading ${description || url} -> ${destination}`);
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to download ${url} (${response.status} ${response.statusText})`);
    }
    const buffer = await response.arrayBuffer();
    await ensureDirectory(path.posix.dirname(destination));
    await Bun.write(destination, buffer);
    if (job) {
      job.updatedAt = Date.now();
    }
    return buffer;
  }

  private async extractArchive(archivePath: string, destination: string) {
    const proc = spawn(['unzip', '-o', archivePath, '-d', destination]);
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Failed to extract archive: ${stderr}`);
    }
  }

  private async loadModrinthManifest(manifestPath: string): Promise<ModrinthManifest> {
    const file = Bun.file(manifestPath);
    if (!(await file.exists())) {
      throw new Error('modrinth.index.json not found in archive');
    }
    const contents = await file.text();
    return JSON.parse(contents) as ModrinthManifest;
  }

  private async resetModsDirectory() {
    const modsDir = '/data/mods';
    await ensureDirectory(modsDir);
    const proc = spawn(['sh', '-c', `rm -rf ${modsDir}/*`]);
    await proc.exited;
    await ensureDirectory(modsDir);
  }

  private async applyOverrides(overridesPath: string): Promise<boolean> {
    if (!(await pathExists(overridesPath))) {
      return false;
    }
    console.log(`[FileServer] Applying overrides from ${overridesPath}`);
    const proc = spawn(['cp', '-a', `${overridesPath}/.`, '/data/']);
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Failed to copy overrides: ${stderr}`);
    }
    return true;
  }

  private sanitizeRelativePath(relPath: string): string {
    const normalized = path.posix.normalize(relPath).replace(/^\/+/g, '');
    if (!normalized || normalized.startsWith('..')) {
      throw new Error(`Unsafe path in manifest: ${relPath}`);
    }
    return normalized;
  }

  private async installModrinthFiles(manifest: ModrinthManifest, job: ModpackJob): Promise<{ installedCount: number; loader?: 'PAPER' | 'FORGE' | 'FABRIC' | 'NEOFORGE'; minecraftVersion?: string }> {
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    const total = files.length;
    let installed = 0;
    const loaderInfo = this.extractLoaderInfo(manifest.dependencies);

    for (let index = 0; index < files.length; index++) {
      const fileEntry = files[index];
      if (fileEntry.env?.server === 'unsupported') {
        continue;
      }
      const normalizedInput = (fileEntry.path || `mods/file-${index}.jar`).replace(/\\/g, '/');
      const relPath = this.sanitizeRelativePath(normalizedInput);
      const destination = path.posix.join('/data', relPath);
      const url = fileEntry.downloads?.[0];
      if (!url) {
        throw new Error(`Missing download URL for ${relPath}`);
      }
      job.progress = {
        phase: 'Installing mods',
        currentFile: relPath,
        currentIndex: index + 1,
        totalFiles: total,
      };
      job.updatedAt = Date.now();
      const buffer = await this.downloadFileToPath(url, destination, undefined, job, relPath);
      await this.verifyHash(buffer, fileEntry.hashes, relPath);
      installed++;
    }

    return {
      installedCount: installed,
      loader: loaderInfo.loader,
      minecraftVersion: loaderInfo.minecraftVersion,
    };
  }

  private extractLoaderInfo(dependencies?: Record<string, string>): { loader?: 'PAPER' | 'FORGE' | 'FABRIC' | 'NEOFORGE'; minecraftVersion?: string } {
    if (!dependencies) {
      return {};
    }
    if (dependencies['neoforge']) {
      return { loader: 'NEOFORGE', minecraftVersion: dependencies['minecraft'] };
    }
    if (dependencies['forge']) {
      return { loader: 'FORGE', minecraftVersion: dependencies['minecraft'] };
    }
    if (dependencies['fabric-loader'] || dependencies['quilt-loader']) {
      return { loader: 'FABRIC', minecraftVersion: dependencies['minecraft'] };
    }
    return { minecraftVersion: dependencies['minecraft'] };
  }

  private recommendProfile(loader?: 'PAPER' | 'FORGE' | 'FABRIC' | 'NEOFORGE', minecraftVersion?: string): string | undefined {
    if (!loader || !minecraftVersion) {
      return undefined;
    }
    return PROFILE_HINTS.find((profile) => profile.loader === loader && profile.minecraftVersion === minecraftVersion)?.profileId;
  }

  private async fetchCurseforgePack(projectId: number, fileId: number): Promise<CurseforgePackInfo> {
    const response = await this.curseforgeRequest<any>(`/mods/${projectId}/files/${fileId}`);
    const fileData = response?.data;
    if (!fileData?.downloadUrl) {
      throw new Error('CurseForge file metadata is missing a download URL');
    }
    return {
      name: fileData.displayName || fileData.fileName,
      fileName: fileData.fileName,
      fileId,
      downloadUrl: fileData.downloadUrl,
    };
  }

  private async fetchCurseforgeFile(projectId: number, fileId: number): Promise<any> {
    const response = await this.curseforgeRequest<any>(`/mods/${projectId}/files/${fileId}`);
    return response?.data;
  }

  private async curseforgeRequest<T>(pathname: string): Promise<T> {
    const apiKey = process.env.CURSEFORGE_API_KEY;
    if (!apiKey) {
      throw new Error('CURSEFORGE_API_KEY is not configured');
    }
    const response = await fetch(`https://api.curseforge.com/v1${pathname}`, {
      headers: {
        'x-api-key': apiKey,
      },
    });
    if (!response.ok) {
      throw new Error(`CurseForge API request failed (${response.status})`);
    }
    return await response.json() as T;
  }

  private async loadCurseforgeManifest(filePath: string): Promise<CurseforgeManifest> {
    const manifestFile = Bun.file(filePath);
    if (!(await manifestFile.exists())) {
      throw new Error('manifest.json not found in CurseForge archive');
    }
    return JSON.parse(await manifestFile.text()) as CurseforgeManifest;
  }

  private determineLoaderFromModLoaders(modLoaders: Array<{ id: string; primary?: boolean }>): { loader?: 'PAPER' | 'FORGE' | 'FABRIC' | 'NEOFORGE' } {
    if (!Array.isArray(modLoaders) || modLoaders.length === 0) {
      return {};
    }
    const loaderEntry = modLoaders.find((loader) => loader.primary) || modLoaders[0];
    const id = loaderEntry.id.toLowerCase();
    if (id.includes('neoforge')) {
      return { loader: 'NEOFORGE' };
    }
    if (id.includes('forge')) {
      return { loader: 'FORGE' };
    }
    if (id.includes('fabric')) {
      return { loader: 'FABRIC' };
    }
    return {};
  }

  private async installCurseforgeFiles(manifest: CurseforgeManifest, job: ModpackJob): Promise<{ installedCount: number; loader?: 'PAPER' | 'FORGE' | 'FABRIC' | 'NEOFORGE'; minecraftVersion?: string }> {
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    const total = files.length;
    const loaderInfo = this.determineLoaderFromModLoaders(manifest.minecraft?.modLoaders || []);
    const minecraftVersion = manifest.minecraft?.version;
    let installed = 0;

    for (let index = 0; index < files.length; index++) {
      const entry = files[index];
      if (entry.required === false) {
        continue;
      }
      job.progress = {
        phase: 'Installing mods',
        currentFile: `Project ${entry.projectID}`,
        currentIndex: index + 1,
        totalFiles: total,
      };
      job.updatedAt = Date.now();
      const fileData = await this.fetchCurseforgeFile(entry.projectID, entry.fileID);
      if (!fileData?.downloadUrl) {
        throw new Error(`CurseForge file ${entry.projectID}/${entry.fileID} is missing a download URL`);
      }
      const targetName = fileData.fileName || `${entry.projectID}-${entry.fileID}.jar`;
      const destination = path.posix.join('/data/mods', targetName);
      await this.downloadFileToPath(fileData.downloadUrl, destination, undefined, job, targetName);
      installed++;
    }

    return {
      installedCount: installed,
      loader: loaderInfo.loader,
      minecraftVersion,
    };
  }

  private async verifyHash(buffer: ArrayBuffer, hashes: Record<string, string> | undefined, label: string) {
    if (!hashes) {
      return;
    }
    if (hashes.sha1) {
      const digest = await crypto.subtle.digest('SHA-1', buffer);
      const hex = bufferToHex(digest);
      if (hex !== hashes.sha1.toLowerCase()) {
        throw new Error(`SHA-1 mismatch for ${label}`);
      }
    }
    if (hashes.sha512) {
      const digest = await crypto.subtle.digest('SHA-512', buffer);
      const hex = bufferToHex(digest);
      if (hex !== hashes.sha512.toLowerCase()) {
        throw new Error(`SHA-512 mismatch for ${label}`);
      }
    }
  }
  private async handleFileServe(pathname: string): Promise<Response> {
    console.log(`[FileServer] File serve request for: ${pathname}`);
    // Normalize path
    let filePath = pathname === "/" ? "/" : pathname;
    if (!filePath.startsWith("/")) {
      filePath = "/" + filePath;
    }
    if (filePath.startsWith("//")) {
      filePath = filePath.substring(1);
    }

    if (filePath.length > 1 && filePath.endsWith("/")) {
      filePath = filePath.replace(/\/+$/, "");
    }

    try {
      console.log(`[FileServer] Checking if file exists: ${filePath}`);

      const stats = await stat(filePath);

      if (stats.isDirectory()) {
        const entries = await readdir(filePath, { withFileTypes: true });
        const listing = entries
          .map(entry => {
            const type = entry.isDirectory() ? "d" : entry.isSymbolicLink() ? "l" : "-";
            return `${type} ${entry.name}`;
          })
          .join("\n");

        const body = [`Directory listing for ${filePath}:`, listing || "<empty>"]
          .filter(Boolean)
          .join("\n");

        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        });
      }

      const fileHandle = Bun.file(filePath);
      const content = await fileHandle.arrayBuffer();

      return new Response(content, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": content.byteLength.toString(),
        },
      });
    } catch (error: any) {
      if (error.code === "ENOENT") {
        return new Response("File not found", { status: 404 });
      } else if (error.code === "EACCES") {
        return new Response("Permission denied", { status: 500 });
      } else {
        console.error("[FileServer] Error serving file:", error);
        return new Response(`Internal server error: ${error.message}`, {
          status: 500,
        });
      }
    }
  }

  private async handleBackup(pathname: string): Promise<Response> {
    this.backupCount++;
    console.log(`[FileServer] Backup request for: ${pathname}`);

    try {
      // Normalize directory path
      let directory = pathname;
      if (!directory.startsWith("/")) {
        directory = "/" + directory;
      }
      
      // Create S3 client
      const s3Client = createS3Client('data');

      // Generate backup filename using reverse-epoch seconds for newest-first lex order
      const now = new Date();
      const dirName = directory.split("/").filter(Boolean).pop() || "backup";
      const backupFilename = generateBackupKey(dirName, now);

      console.log(`[FileServer] Creating backup: ${directory} -> ${backupFilename}`);

      // Create tar.gz archive using tar command
      // Note: By default tar stores symlinks as symlinks (doesn't follow them)
      const tempFile = `/tmp/backup_${formatUTCDateYYYYMMDDHH(now)}.tar.gz`;
      
      const tarProc = spawn([
        "tar",
        "-czf",
        tempFile,
        "--exclude=./logs",           // Exclude logs directory if it exists
        "--exclude=./cache",          // Exclude cache directory if it exists
        "-C",
        directory.substring(0, directory.lastIndexOf("/")) || "/",
        dirName,
      ]);

      const tarExit = await tarProc.exited;
      
      if (tarExit !== 0) {
        const stderr = await new Response(tarProc.stderr).text();
        const stdout = await new Response(tarProc.stdout).text();
        console.error(`[FileServer] tar stderr: ${stderr}`);
        console.error(`[FileServer] tar stdout: ${stdout}`);
        throw new Error(`tar command failed with exit code ${tarExit}: ${stderr || stdout || 'no error output'}`);
      }

      console.log(`[FileServer] Archive created: ${tempFile}`);

      // Get file size
      const tarFile = Bun.file(tempFile);
      const tarStat = await tarFile.stat();
      const fileSize = tarStat?.size || 0;
      const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);

      console.log(`[FileServer] Archive size: ${fileSize} bytes (${fileSizeMB} MB)`);

      // // Calculate MD5 hash by streaming the file
      // const md5Hash = await this.calculateMD5FromFile(tempFile);
      // console.log(`[FileServer] Archive MD5: ${md5Hash}`);

      // // Check if a backup with the same MD5 already exists
      // const existingBackup = await this.findExistingBackupByMD5(
      //   s3Client,
      //   dirName,
      //   md5Hash
      // );

      // if (existingBackup) {
      //   console.log(`[FileServer] Found existing backup with same MD5: ${existingBackup.path}`);
        
      //   // Clean up temp file
      //   try {
      //     await unlink(tempFile);
      //   } catch (e) {
      //     console.warn(`[FileServer] Failed to clean up temp file: ${e}`);
      //   }

      //   const result: BackupResult = {
      //     success: true,
      //     backup_path: existingBackup.path,
      //     size: existingBackup.size,
      //     note: "Duplicate backup skipped (same content already exists).",
      //   };

      //   return this.jsonResponse(result);
      // }

      // No existing backup found, proceed with upload
      console.log(`[FileServer] Uploading to S3: ${backupFilename} (streaming from disk)`);

      // Upload to S3 using Bun's S3 client (automatically handles streaming and retries)
      const fileForUpload = Bun.file(tempFile);
      await s3Client.write(backupFilename, fileForUpload, {
        type: "application/x-tar",
      });

      // Clean up temp file
      try {
        await Bun.write(tempFile, ""); // Empty the file first
        await unlink(tempFile);
      } catch (e) {
        console.warn(`[FileServer] Failed to clean up temp file: ${e}`);
      }

      console.log(`[FileServer] Backup completed successfully`);

      const result: BackupResult = {
        success: true,
        backup_path: backupFilename,
        size: fileSize,
        note: "complete backup",
      };

      return this.jsonResponse(result);
    } catch (error: any) {
      const errorMsg = `Backup failed: ${error.message}`;
      console.error(`[FileServer] ${errorMsg}`);
      console.error(error.stack);

      return this.jsonResponse({ error: errorMsg }, { status: 500 });
    }
  }

  // private async calculateMD5FromFile(filePath: string): Promise<string> {
  //   // Use Node.js crypto module which is available in Bun
  //   const crypto = await import("crypto");
  //   const hash = crypto.createHash('md5');
    
  //   // Stream the file in chunks to avoid loading into memory
  //   const file = Bun.file(filePath);
  //   const stream = file.stream();
  //   const reader = stream.getReader();
    
  //   try {
  //     while (true) {
  //       const { done, value } = await reader.read();
  //       if (done) break;
  //       hash.update(value);
  //     }
  //   } finally {
  //     reader.releaseLock();
  //   }
    
  //   return hash.digest('hex');
  // }

  // private async findExistingBackupByMD5(
  //   s3Client: S3Client,
  //   dirName: string,
  //   md5Hash: string
  // ): Promise<{ path: string; size: number } | null> {
  //   try {
  //     console.log(`[FileServer] Checking for existing backups with prefix: backups/${dirName}_`);
      
  //     // List recent backups globally, then filter by dir suffix
  //     const listResult = await s3Client.list({
  //       prefix: `backups/`,
  //       maxKeys: 50, // check a reasonable window
  //     });
      
  //     if (!listResult.contents) {
  //       console.log(`[FileServer] No existing backups found`);
  //       return null;
  //     }

  //     const contents = await listResult.contents;
      
  //     // using plain fetch here because bun client doesn't give us md5s
  //     const endpoint = process.env.AWS_ENDPOINT_URL;
  //     const bucket = process.env.DATA_BUCKET_NAME || process.env.DYNMAP_BUCKET;
  //     const keys = contents.map(c => c.key);
  //     // Check each backup's MD5
  //     for (const key of keys) {
  //       const headUrl = `${endpoint}/${bucket}/${key}`;
        
  //       const headResponse = await fetchWithRetry(
  //         headUrl,
  //         {
  //           method: "HEAD",
  //         },
  //         `Check MD5 for ${key}`
  //       );

  //       if (headResponse.ok) {
  //         const existingMD5 = headResponse.headers.get("x-amz-meta-md5");
  //         const contentLength = headResponse.headers.get("Content-Length");
          
  //         if (existingMD5 === md5Hash) {
  //           console.log(`[FileServer] Found matching backup: ${key} (MD5: ${existingMD5})`);
  //           return {
  //             path: key,
  //             size: contentLength ? parseInt(contentLength) : 0,
  //           };
  //         }
  //       }
  //     }

  //     console.log(`[FileServer] No existing backup with matching MD5 found`);
  //     return null;
  //   } catch (error) {
  //     console.warn(`[FileServer] Error checking for existing backups:`, error);
  //     return null;
  //   }
  // }

  private async handleRestore(pathname: string, backupFilename: string): Promise<Response> {
    this.restoreCount++;
    this.activeRestores++;
    const restoreStartTime = Date.now();
    console.log(`[FileServer] ============ RESTORE START ============`);
    console.log(`[FileServer] Restore request: ${backupFilename} -> ${pathname}`);
    console.log(`[FileServer] Active restores: ${this.activeRestores}`);

    try {
      // Normalize directory path
      let directory = pathname;
      if (!directory.startsWith("/")) {
        directory = "/" + directory;
      }
      console.log(`[FileServer] Normalized directory: ${directory}`);

      // Create S3 client
      console.log(`[FileServer] Creating S3 client for 'data' bucket...`);
      const s3Client = createS3Client('data');
      console.log(`[FileServer] S3 client created successfully`);

      // Validate backup filename (prevent path traversal)
      if (backupFilename.includes("..") || !backupFilename.startsWith("backups/")) {
        console.error(`[FileServer] Invalid backup filename: ${backupFilename}`);
        return new Response(
          JSON.stringify({ error: "Invalid backup filename" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      console.log(`[FileServer] Backup filename validated`);

      console.log(`[FileServer] Checking file size for: ${backupFilename}`);

      // First, check the file size with a HEAD request
      const endpoint = process.env.AWS_ENDPOINT_URL;
      const bucket = process.env.DATA_BUCKET_NAME || process.env.DYNMAP_BUCKET;
      const headUrl = `${endpoint}/${bucket}/${backupFilename}`;
      
      console.log(`[FileServer] Sending HEAD request to: ${headUrl}`);
      const headStartTime = Date.now();
      const headResponse = await fetch(headUrl, { method: "HEAD" });
      const headDuration = Date.now() - headStartTime;
      console.log(`[FileServer] HEAD request completed in ${headDuration}ms, status: ${headResponse.status}`);
      
      if (!headResponse.ok) {
        console.error(`[FileServer] Backup not found or HEAD request failed: ${backupFilename}`);
        return new Response(
          JSON.stringify({ 
            error: `Backup not found: ${backupFilename}`,
          }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      
      const contentLength = headResponse.headers.get("Content-Length");
      const fileSize = contentLength ? parseInt(contentLength, 10) : 0;
      const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
      
      console.log(`[FileServer] Backup file size: ${fileSize} bytes (${fileSizeMB} MB)`);
      console.log(`[FileServer] Large file threshold: ${LARGE_FILE_THRESHOLD} bytes (${(LARGE_FILE_THRESHOLD / (1024 * 1024)).toFixed(2)} MB)`);
      console.log(`[FileServer] Will use ${fileSize >= LARGE_FILE_THRESHOLD ? 'MULTIPART' : 'SIMPLE'} download method`);

      // Save to temp file
      const timestamp = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\..+/, "")
        .replace("T", "_");
      const tempFile = `/tmp/restore_${timestamp}.tar.gz`;
      console.log(`[FileServer] Temp file will be: ${tempFile}`);
      
      // Use multipart download for large files, simple download for small files
      const downloadStartTime = Date.now();
      if (fileSize >= LARGE_FILE_THRESHOLD) {
        console.log(
          `[FileServer] ======== MULTIPART DOWNLOAD START ========`
        );
        console.log(
          `[FileServer] File is large (>= ${(LARGE_FILE_THRESHOLD / (1024 * 1024)).toFixed(0)} MB), using multipart download`
        );
        await downloadLargeFile(s3Client, backupFilename, tempFile, fileSize);
        const downloadDuration = Date.now() - downloadStartTime;
        console.log(`[FileServer] ======== MULTIPART DOWNLOAD COMPLETE ========`);
        console.log(`[FileServer] Download took ${(downloadDuration / 1000).toFixed(2)}s`);
      } else {
        console.log(`[FileServer] ======== SIMPLE DOWNLOAD START ========`);
        console.log(`[FileServer] File is small, using simple download`);
        const s3File = s3Client.file(backupFilename);
        console.log(`[FileServer] Fetching file data via s3Client.file().arrayBuffer()...`);
        const fetchStartTime = Date.now();
        const fileData = await s3File.arrayBuffer();
        const fetchDuration = Date.now() - fetchStartTime;
        console.log(`[FileServer] Fetch completed in ${(fetchDuration / 1000).toFixed(2)}s`);
        console.log(`[FileServer] Writing ${fileData.byteLength} bytes to ${tempFile}...`);
        const writeStartTime = Date.now();
        await Bun.write(tempFile, fileData);
        const writeDuration = Date.now() - writeStartTime;
        console.log(`[FileServer] Write completed in ${(writeDuration / 1000).toFixed(2)}s`);
        const downloadDuration = Date.now() - downloadStartTime;
        console.log(`[FileServer] ======== SIMPLE DOWNLOAD COMPLETE ========`);
        console.log(`[FileServer] Download took ${(downloadDuration / 1000).toFixed(2)}s total`);
      }

      // Get file size from written file
      console.log(`[FileServer] Verifying downloaded file size...`);
      const restoredFile = Bun.file(tempFile);
      const restoredStat = await restoredFile.stat();
      const downloadedSize = restoredStat?.size || 0;

      console.log(`[FileServer] Downloaded file size: ${downloadedSize} bytes (${(downloadedSize / (1024 * 1024)).toFixed(2)} MB)`);
      console.log(`[FileServer] Expected size: ${fileSize} bytes (${fileSizeMB} MB)`);
      
      if (downloadedSize !== fileSize) {
        console.error(`[FileServer] WARNING: Downloaded size (${downloadedSize}) does not match expected size (${fileSize})`);
      } else {
        console.log(`[FileServer] Size verification: OK`);
      }

      // Ensure target directory exists
      const parentDir = directory.substring(0, directory.lastIndexOf("/")) || "/";
      console.log(`[FileServer] Parent directory: ${parentDir}`);
      console.log(`[FileServer] Ensuring parent directory exists...`);
      await ensureDirectory(parentDir);
      console.log(`[FileServer] Parent directory ready`);

      // Extract tar.gz archive to the parent directory
      // The tar will create/overwrite the target directory
      console.log(`[FileServer] ======== EXTRACTION START ========`);
      console.log(`[FileServer] Extracting to: ${parentDir}`);
      
      const extractStartTime = Date.now();
      const tarProc = spawn([
        "tar",
        "-xzf",
        tempFile,
        "-C",
        parentDir,
        "--overwrite",           // Overwrite existing files without unlinking directories
        "--no-same-permissions", // Don't preserve permissions (avoid utime errors)
        "--no-same-owner",       // Don't preserve ownership
        "--touch",               // Don't extract file modified time (avoids utime errors)
      ]);
      
      console.log(`[FileServer] Waiting for tar process to complete...`);
      const tarExit = await tarProc.exited;
      const extractDuration = Date.now() - extractStartTime;
      
      console.log(`[FileServer] tar exited with code: ${tarExit} (duration: ${(extractDuration / 1000).toFixed(2)}s)`);
      
      if (tarExit !== 0) {
        const stderr = await new Response(tarProc.stderr).text();
        console.error(`[FileServer] tar stderr: ${stderr}`);
        throw new Error(`tar extraction failed with exit code ${tarExit}: ${stderr}`);
      }

      console.log(`[FileServer] ======== EXTRACTION COMPLETE ========`);
      console.log(`[FileServer] Extraction took ${(extractDuration / 1000).toFixed(2)}s`);

      // Clean up temp file
      console.log(`[FileServer] Cleaning up temp file: ${tempFile}`);
      try {
        await unlink(tempFile);
        console.log(`[FileServer] Temp file cleaned up successfully`);
      } catch (e) {
        console.warn(`[FileServer] Failed to clean up temp file: ${e}`);
      }

      const totalDuration = Date.now() - restoreStartTime;
      console.log(`[FileServer] ============ RESTORE COMPLETE ============`);
      console.log(`[FileServer] Total restore time: ${(totalDuration / 1000).toFixed(2)}s`);
      console.log(`[FileServer] Downloaded: ${(downloadedSize / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`[FileServer] From: ${backupFilename}`);
      console.log(`[FileServer] To: ${directory}`);

      const result: RestoreResult = {
        success: true,
        restored_from: backupFilename,
        restored_to: directory,
        size: downloadedSize,
        note: "complete restore",
      };

      return this.jsonResponse(result);
    } catch (error: any) {
      const errorDuration = Date.now() - restoreStartTime;
      const errorMsg = `Restore failed: ${error.message}`;
      console.error(`[FileServer] ============ RESTORE FAILED ============`);
      console.error(`[FileServer] ${errorMsg}`);
      console.error(`[FileServer] Error type: ${error.constructor.name}`);
      console.error(`[FileServer] Error code: ${error.code}`);
      console.error(`[FileServer] Time elapsed before failure: ${(errorDuration / 1000).toFixed(2)}s`);
      console.error(error.stack);

      return this.jsonResponse({ error: errorMsg }, { status: 500 });
    } finally {
      this.activeRestores--;
      console.log(`[FileServer] Active restores now: ${this.activeRestores}`);
    }
  }

  private async handleListBackups(pathname: string): Promise<Response> {
    console.log(`[FileServer] List backups request for: ${pathname}`);

    try {
      // Normalize directory path
      let directory = pathname;
      if (!directory.startsWith("/")) {
        directory = "/" + directory;
      }

      // Create S3 client (or check credentials)
      const s3Client = createS3Client('data');

      // Get directory name for filtering
      const dirName = directory.split("/").filter(Boolean).pop() || "backup";
      
      console.log(`[FileServer] Listing backups for dir: ${dirName}`);
      
      // List all backups globally then filter by dir suffix
      const listResult = await S3Client.list({
        prefix: `backups/`,
      }, {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        endpoint: process.env.AWS_ENDPOINT_URL!,
        bucket: process.env.DATA_BUCKET_NAME || process.env.DYNMAP_BUCKET!,
      });

      // Convert S3 list result to our BackupListItem format
      const backups: BackupListItem[] = [];
      
      if (listResult.contents) {
        for (const item of listResult.contents) {
          if (!item.key.endsWith(`_${dirName}.tar.gz`)) continue;
          backups.push({
            path: item.key,
            size: item.size || 0,
            timestamp: item.lastModified ? item.lastModified.toString() : "unknown",
          });
        }
      }

      // Sort backups by timestamp (newest first)
      backups.sort((a, b) => {
        if (a.timestamp === "unknown" || b.timestamp === "unknown") return 0;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });

      console.log(`[FileServer] Found ${backups.length} backups`);

      const result: ListBackupsResult = {
        success: true,
        directory: directory,
        backups: backups,
      };

      return this.jsonResponse(result);
    } catch (error: any) {
      const errorMsg = `List backups failed: ${error.message}`;
      console.error(`[FileServer] ${errorMsg}`);
      console.error(error.stack);

      return this.jsonResponse({ error: errorMsg }, { status: 500 });
    }
  }
}

// Helper to delete file (Bun doesn't have unlink in standard API)
async function unlink(path: string): Promise<void> {
  const proc = spawn(["rm", "-f", path]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Failed to remove ${path}: ${stderr}`);
  }
}

// Helper to ensure directory exists
async function ensureDirectory(path: string): Promise<void> {
  const proc = spawn(["mkdir", "-p", path]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Failed to create directory ${path}: ${stderr}`);
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  const proc = spawn(['sh', '-c', `[ -e "${targetPath}" ]`]);
  const exitCode = await proc.exited;
  return exitCode === 0;
}

async function removePath(targetPath: string): Promise<void> {
  if (!targetPath || targetPath === '/' || targetPath === '/data') {
    return;
  }
  const proc = spawn(['rm', '-rf', targetPath]);
  await proc.exited;
}

function bufferToHex(buffer: ArrayBuffer): string {
  const byteArray = new Uint8Array(buffer);
  return Array.from(byteArray)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Start the server
const server = new FileServer();
server.start().catch((error) => {
  console.error("[FileServer] Failed to start:", error);
  process.exit(1);
});
