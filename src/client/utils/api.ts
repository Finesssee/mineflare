import { getBackendUrl } from "alchemy/cloudflare/bun-spa";
const apiBaseUrl = getBackendUrl();
console.log("apiBaseUrl", apiBaseUrl);

export function apiHost() {
  const host = apiBaseUrl.host;
  console.log("apiHost", host);
  return host;
}

export function backendUrl(path: string) {
  return new URL(path, getBackendUrl());
}


export function fetchApi(path: string, init?: Parameters<typeof fetch>[1]) {
    return fetch(backendUrl(path), {
        ...init,
        credentials: 'include',
    });
}

/**
 * Wrapper around fetchApi that reloads the page on 401 Unauthorized
 * Use this for all authenticated API calls to auto-handle session expiry
 */
export async function fetchWithAuth(path: string, init?: Parameters<typeof fetchApi>[1]): Promise<Response> {
  const response = await fetchApi(path, init);
  
  // If we get a 401 Unauthorized, the session has expired or been invalidated
  // Reload the page to force re-authentication
  if (response.status === 401) {
    console.log('Received 401 Unauthorized, reloading page to re-authenticate...');
    window.location.reload();
    // Return a never-resolving promise to prevent further execution
    return new Promise(() => {});
  }
  
  return response;
}
