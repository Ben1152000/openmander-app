/**
 * Load pack files from the public directory, driven entirely by manifest.json.
 * Every file listed in the manifest is fetched; any failure throws an error.
 *
 * @param packPath Path to the pack directory (no trailing slash)
 * @param onProgress Optional callback for progress updates (current, total, fileName?)
 */
export async function loadPackFromDirectory(
  packPath: string,
  onProgress?: (current: number, total: number, fileName?: string) => void,
  signal?: AbortSignal,
): Promise<Record<string, Uint8Array>> {
  // Load manifest first — it is the source of truth for which files exist.
  const manifestResponse = await fetch(`${packPath}/manifest.json`, { signal });
  if (!manifestResponse.ok) {
    throw new Error(`Failed to load manifest.json: ${manifestResponse.status} ${manifestResponse.statusText}`);
  }
  const manifest = await manifestResponse.json();

  // All files listed in the manifest, excluding PMTiles tile sources.
  // PMTiles files are served via the MapLibre tile protocol (see loadAndCachePMTiles)
  // and must not be loaded into WASM memory.
  const fileKeys: string[] = Object.keys(manifest.files ?? {})
    .filter(f => !f.endsWith('.pmtiles'));
  if (fileKeys.length === 0) {
    throw new Error("manifest.json contains no non-PMTiles files");
  }

  const files: Record<string, Uint8Array> = {};
  let loadedCount = 0;
  const total = fileKeys.length;

  await Promise.all(fileKeys.map(async (fileName) => {
    const response = await fetch(`${packPath}/${fileName}`, { signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${fileName}: ${response.status} ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    files[fileName] = new Uint8Array(buffer);
    loadedCount++;
    onProgress?.(loadedCount, total, fileName);
  }));

  return files;
}
