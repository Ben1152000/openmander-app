/**
 * Load pack files from the public directory.
 * Auto-detects pack format from manifest and loads appropriate file types.
 * Optimized for PMTiles webpack packs: skips geometry files (loaded by MapLibre on-demand).
 * 
 * @param packPath Path to the pack directory
 * @param onProgress Optional callback for progress updates (current, total, fileName?)
 */
export async function loadPackFromDirectory(
  packPath: string,
  onProgress?: (current: number, total: number, fileName?: string) => void
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};

  // List of layers to load
  const layers = ["state", "county", "tract", "group", "vtd", "block"];

  // Load manifest first to detect pack format
  let manifest: any = null;
  let dataExt = "json"; // Default to JSON for backward compatibility
  let geomExt = "geojson"; // Default to GeoJSON
  let hullExt = "geojson"; // Default to GeoJSON
  
  try {
    const manifestResponse = await fetch(`${packPath}/manifest.json`);
    if (!manifestResponse.ok) {
      throw new Error(`Failed to load manifest: ${manifestResponse.statusText}`);
    }
    manifest = await manifestResponse.json();
    
    // Detect format from manifest
    if (manifest.formats) {
      // Use formats from manifest if available
      dataExt = manifest.formats.data === "csv" ? "csv" : "json";
      geomExt = manifest.formats.geometry === "pmtiles" ? "pmtiles" : 
                manifest.formats.geometry === "geoparquet" ? "geoparquet" : "geojson";
      hullExt = manifest.formats.hull === "wkb" ? "wkb" : 
                manifest.formats.hull === "geoparquet" ? "geoparquet" : "geojson";
    } else {
      // Fallback: try to detect from file list in manifest
      const fileKeys = Object.keys(manifest.files || {});
      if (fileKeys.some(f => f.endsWith('.pmtiles'))) {
        geomExt = "pmtiles";
        dataExt = "csv";
        hullExt = "wkb";
      } else if (fileKeys.some(f => f.endsWith('.csv'))) {
        dataExt = "csv";
      }
    }
  } catch (err) {
    console.warn("Could not load manifest, using defaults:", err);
  }

  // OPTIMIZATION: For PMTiles webpack packs, skip geometry files (loaded by MapLibre on-demand)
  // But still load all data files needed by WASM
  const isPmtilesPack = geomExt === "pmtiles";
  
  const loadPromises: Array<{ fileName: string; promise: Promise<[string, Uint8Array] | null> }> = [];
  
  if (isPmtilesPack) {
    // For PMTiles webpack packs: load all data files (WASM needs them), skip geometry
    const priorityOrder = [
      { dir: "data", ext: dataExt },
      // Skip geometry - MapLibre loads PMTiles directly
      // Load hull and adjacency files (WASM may need them)
      { dir: "hull", ext: hullExt },
      { dir: "adj", ext: "csr.bin" },
    ];

    for (const fileType of priorityOrder) {
      for (const layer of layers) {
        const fileName = `${fileType.dir}/${layer}.${fileType.ext}`;
        const filePath = `${packPath}/${fileName}`;
        
        const promise = fetch(filePath)
          .then(async (response) => {
            if (!response.ok) {
              // Some files might not exist (e.g., state layer has no adj file)
              console.warn(`File not found: ${fileName}`);
              return null;
            }
            const arrayBuffer = await response.arrayBuffer();
            return [fileName, new Uint8Array(arrayBuffer)] as [string, Uint8Array];
          })
          .catch((err) => {
            console.warn(`Failed to load ${fileName}:`, err);
            return null;
          });
        
        loadPromises.push({ fileName, promise });
      }
    }
  } else {
    // For non-PMTiles packs: load all files as before (backward compatibility)
    const priorityOrder = [
      { dir: "data", ext: dataExt },
      { dir: "geom", ext: geomExt },
      { dir: "hull", ext: hullExt },
      { dir: "adj", ext: "csr.bin" },
    ];

    for (const fileType of priorityOrder) {
      for (const layer of layers) {
        const fileName = `${fileType.dir}/${layer}.${fileType.ext}`;
        const filePath = `${packPath}/${fileName}`;
        
        const promise = fetch(filePath)
          .then(async (response) => {
            if (!response.ok) {
              return null;
            }
            const arrayBuffer = await response.arrayBuffer();
            return [fileName, new Uint8Array(arrayBuffer)] as [string, Uint8Array];
          })
          .catch(() => null);
        
        loadPromises.push({ fileName, promise });
      }
    }
  }

  // Load files with progress tracking
  let loadedCount = 0;
  const totalFiles = loadPromises.length;
  
  // Wrap promises to track progress with file names
  const trackedPromises = loadPromises.map(({ fileName, promise }) =>
    promise.then((result) => {
      loadedCount++;
      if (onProgress) {
        onProgress(loadedCount, totalFiles, fileName);
      }
      return result;
    })
  );

  const results = await Promise.all(trackedPromises);
  for (const result of results) {
    if (result) {
      files[result[0]] = result[1];
    }
  }

  // Check if required files are present (using detected format)
  const requiredFiles = [
    `data/state.${dataExt}`,
    `data/county.${dataExt}`,
    `data/block.${dataExt}`
  ];
  const missingFiles = requiredFiles.filter(f => !files[f]);
  if (missingFiles.length > 0) {
    console.warn("Missing required files:", missingFiles);
  }
  
  return files;
}
