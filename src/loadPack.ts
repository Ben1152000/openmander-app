/**
 * Load pack files from the public directory, driven entirely by manifest.json.
 * Every file listed in the manifest is fetched; any failure throws an error.
 *
 * Files that were split into chunks during the build (e.g. foo.pmtiles.part000,
 * foo.pmtiles.part001) are fetched in parallel and concatenated back into their
 * original logical file (foo.pmtiles).
 *
 * @param packPath Path to the pack directory (no trailing slash)
 * @param onProgress Optional callback for progress updates (current, total, fileName?)
 * @returns packFiles — non-PMTiles files for WASM; pmtilesBuffer — assembled PMTiles
 *          if it was chunked (null if unchunked, letting the caller use loadAndCachePMTiles).
 */

const PART_RE = /\.part(\d{3})$/;

async function fetchAndConcat(urls: string[], signal?: AbortSignal): Promise<Uint8Array> {
  const buffers = await Promise.all(urls.map(async (url) => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    return new Uint8Array(await res.arrayBuffer());
  }));
  if (buffers.length === 1) return buffers[0];
  const totalLen = buffers.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const b of buffers) { out.set(b, offset); offset += b.length; }
  return out;
}

export async function loadPackFromDirectory(
  packPath: string,
  onProgress?: (current: number, total: number, fileName?: string) => void,
  signal?: AbortSignal,
): Promise<{ packFiles: Record<string, Uint8Array>; pmtilesBuffer: ArrayBuffer | null }> {
  const manifestResponse = await fetch(`${packPath}/manifest.json`, { signal });
  if (!manifestResponse.ok) {
    throw new Error(`Failed to load manifest.json: ${manifestResponse.status} ${manifestResponse.statusText}`);
  }
  const manifest = await manifestResponse.json();

  // Group manifest keys by logical base name (strip .partNNN suffix if present).
  const allKeys: string[] = Object.keys(manifest.files ?? {});
  const groups = new Map<string, string[]>(); // logicalName -> sorted part keys

  for (const key of allKeys) {
    const m = key.match(PART_RE);
    const logicalName = m ? key.slice(0, -m[0].length) : key;
    if (!groups.has(logicalName)) groups.set(logicalName, []);
    groups.get(logicalName)!.push(key);
  }
  for (const parts of groups.values()) parts.sort();

  const logicalNames = Array.from(groups.keys());
  const nonPmtilesNames = logicalNames.filter(n => !n.endsWith('.pmtiles'));
  const pmtilesNames   = logicalNames.filter(n => n.endsWith('.pmtiles'));

  if (nonPmtilesNames.length === 0) {
    throw new Error("manifest.json contains no non-PMTiles files");
  }

  let loaded = 0;
  const total = logicalNames.length;

  // Fetch non-PMTiles files (passed to WASM).
  const packFiles: Record<string, Uint8Array> = {};
  await Promise.all(nonPmtilesNames.map(async (logicalName) => {
    const parts = groups.get(logicalName)!;
    packFiles[logicalName] = await fetchAndConcat(parts.map(p => `${packPath}/${p}`), signal);
    loaded++;
    onProgress?.(loaded, total, logicalName);
  }));

  // Fetch PMTiles chunks only if the file was split (parts differ from logical name).
  let pmtilesBuffer: ArrayBuffer | null = null;
  for (const logicalName of pmtilesNames) {
    const parts = groups.get(logicalName)!;
    const isChunked = parts.length > 1 || parts[0] !== logicalName;
    if (isChunked) {
      const data = await fetchAndConcat(parts.map(p => `${packPath}/${p}`), signal);
      pmtilesBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    }
    loaded++;
    onProgress?.(loaded, total, logicalName);
  }

  return { packFiles, pmtilesBuffer };
}
