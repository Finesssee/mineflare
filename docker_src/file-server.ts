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

  private async handleRequest(req: Request): Promise<Response> {
    this.requestCount++;
    
    const url = new URL(req.url);
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
  private async handleFileServe(pathname: string): Promise<Response> {
    console.log(`[FileServer] File serve request for: ${pathname}`);
    // Normalize path
    let filePath = pathname === "/" ? "/" : pathname;
    if (!filePath.startsWith("/")) {
      filePath = "/" + filePath;
    }
    if(filePath.startsWith("//")) {
      filePath = filePath.substring(1);
    }

    try {
      console.log(`[FileServer] Checking if file exists: ${filePath}`);
      // Check if file exists
      // this returns false for directories!
      const fileHandle = Bun.file(filePath);
      const exists = await fileHandle.exists();

      if (!exists) {
        return new Response("File not found", { status: 404 });
      }

      // Bun's stat doesn't have isDirectory, so we try to read it
      // If it fails with a specific error, it's likely a directory
      try {
        const content = await fileHandle.arrayBuffer();
        
        return new Response(content, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": content.byteLength.toString(),
          },
        });
      } catch (e: any) {
        if (e.message?.includes("EISDIR") || e.code === "EISDIR") {
          return new Response("Path is a directory", { status: 404 });
        }
        throw e;
      }
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
  await proc.exited;
}

// Helper to ensure directory exists
async function ensureDirectory(path: string): Promise<void> {
  const proc = spawn(["mkdir", "-p", path]);
  await proc.exited;
}

// Start the server
const server = new FileServer();
server.start().catch((error) => {
  console.error("[FileServer] Failed to start:", error);
  process.exit(1);
});

