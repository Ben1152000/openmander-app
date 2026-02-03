/**
 * Consolidated PMTiles caching layer
 * - IndexedDB storage for offline support
 * - Global fetch interceptor for serving cached tiles
 * - Download and cache entire PMTiles file
 */

// ============================================================================
// INDEXEDDB CACHING
// ============================================================================

const DB_NAME = "openmander-pmtiles";
const STORE_NAME = "tiles";
const DB_VERSION = 1;

interface CacheEntry {
  url: string;
  data: ArrayBuffer;
  timestamp: number;
  size: number;
}

let db: IDBDatabase | null = null;

/**
 * Initialize IndexedDB for PMTiles caching
 */
async function initDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "url" });
      }
    };
  });
}

/**
 * Get cached PMTiles file from IndexedDB
 */
async function getCachedFile(url: string): Promise<ArrayBuffer | null> {
  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(url);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const entry = request.result as CacheEntry | undefined;
        resolve(entry?.data ?? null);
      };
    });
  } catch (err) {
    console.warn("Failed to read from cache:", err);
    return null;
  }
}

/**
 * Cache PMTiles file in IndexedDB
 */
async function cacheFile(url: string, data: ArrayBuffer): Promise<void> {
  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const entry: CacheEntry = {
        url,
        data,
        timestamp: Date.now(),
        size: data.byteLength,
      };

      const request = store.put(entry);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (err) {
    console.warn("Failed to cache file:", err);
  }
}

/**
 * Download entire PMTiles file with progress tracking
 */
async function downloadPMTilesFile(
  url: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<ArrayBuffer> {
  // First check cache
  const cached = await getCachedFile(url);
  if (cached) {
    return cached;
  }

  // Download the entire file using original fetch
  const originalFetchFn = getOriginalFetch();
  if (!originalFetchFn) {
    throw new Error("Original fetch function not available");
  }
  const response = await originalFetchFn(url);
  if (!response.ok) {
    throw new Error(`Failed to download PMTiles: ${response.statusText}`);
  }

  const contentLength = response.headers.get("content-length");
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  if (!response.body) {
    throw new Error("Response body is empty");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      loaded += value.length;

      if (onProgress && total > 0) {
        onProgress(loaded, total);
      }
    }
  } catch (err) {
    reader.cancel();
    throw err;
  }

  // Combine chunks into single ArrayBuffer
  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new ArrayBuffer(totalSize);
  const view = new Uint8Array(buffer);
  let offset = 0;

  for (const chunk of chunks) {
    view.set(chunk, offset);
    offset += chunk.length;
  }

  // Cache the file
  await cacheFile(url, buffer);

  return buffer;
}

/**
 * Load and cache PMTiles file, returning the buffer for use with MapLibre
 */
export async function loadAndCachePMTiles(
  pmtilesPath: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<ArrayBuffer> {
  // Construct full URL
  const baseUrl = window.location.origin;
  const fullUrl = `${baseUrl}${pmtilesPath}`;

  return downloadPMTilesFile(fullUrl, onProgress);
}

/**
 * Clear all cached PMTiles files
 */
export async function clearPMTilesCache(): Promise<void> {
  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (err) {
    console.warn("Failed to clear cache:", err);
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{ totalSize: number; fileCount: number }> {
  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const entries = request.result as CacheEntry[];
        const totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);
        resolve({ totalSize, fileCount: entries.length });
      };
    });
  } catch (err) {
    console.warn("Failed to get cache stats:", err);
    return { totalSize: 0, fileCount: 0 };
  }
}

// ============================================================================
// FETCH INTERCEPTOR
// ============================================================================

let cachedPMTilesBuffer: ArrayBuffer | null = null;
let originalFetch: typeof fetch | null = null;

// Save the original fetch immediately
originalFetch = globalThis.fetch;

// Replace fetch globally
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const urlStr = typeof input === "string" ? input : input.toString();

  // If it's a geometries.pmtiles file request and we have a cached buffer, serve from cache
  if (urlStr.includes("geometries.pmtiles") && cachedPMTilesBuffer) {
    const method = init?.method || "GET";

    // Get the range header if present - handle different header formats
    let rangeHeader: string | undefined;
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        // Headers object - use get() method (case-insensitive)
        rangeHeader = init.headers.get("Range") ?? undefined;
      } else if (Array.isArray(init.headers)) {
        // Array of [key, value] pairs
        const rangeEntry = init.headers.find(([key]) => key.toLowerCase() === "range");
        rangeHeader = rangeEntry ? rangeEntry[1] : undefined;
      } else if (typeof init.headers === "object") {
        // Plain object - check both cases since object keys are case-sensitive
        const headersObj = init.headers as Record<string, string>;
        rangeHeader = headersObj["Range"] ?? headersObj["range"];
      }
    }

    // Handle HEAD requests
    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        statusText: "OK",
        headers: new Headers({
          "Content-Type": "application/octet-stream",
          "Content-Length": cachedPMTilesBuffer.byteLength.toString(),
          "Accept-Ranges": "bytes",
        }),
      });
    }

    // Handle range requests (HTTP 206)
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : cachedPMTilesBuffer.byteLength - 1;
        const slice = cachedPMTilesBuffer.slice(start, end + 1);

        return new Response(slice, {
          status: 206,
          statusText: "Partial Content",
          headers: new Headers({
            "Content-Type": "application/octet-stream",
            "Content-Length": slice.byteLength.toString(),
            "Content-Range": `bytes ${start}-${end}/${cachedPMTilesBuffer.byteLength}`,
            "Accept-Ranges": "bytes",
          }),
        });
      }
    }

    // Handle full file requests (HTTP 200)
    return new Response(cachedPMTilesBuffer.slice(0), {
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "Content-Type": "application/octet-stream",
        "Content-Length": cachedPMTilesBuffer.byteLength.toString(),
        "Accept-Ranges": "bytes",
      }),
    });
  }

  // For all other requests, use the original fetch
  return originalFetch!(input, init);
};

/**
 * Set the PMTiles buffer for the fetch interceptor to serve
 */
export function setPMTilesBuffer(buffer: ArrayBuffer) {
  cachedPMTilesBuffer = buffer;
}

/**
 * Get the original fetch function (before interception)
 */
export function getOriginalFetch() {
  return originalFetch;
}

/**
 * Get the currently cached buffer
 */
export function getCachedBuffer() {
  return cachedPMTilesBuffer;
}
