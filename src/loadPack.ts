/**
 * Load pack files from the public directory.
 * Auto-detects pack format from manifest and loads appropriate file types.
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

  // Load all pack files in parallel with priority for essential files
  // Load data files first (needed for map initialization), then geometry, then adjacencies
  const loadPromises: Array<{ fileName: string; promise: Promise<[string, Uint8Array] | null> }> = [];
  
  // Priority order: data files first (needed for initialization), then geometry, then adjacencies
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
            // Some files might not exist (e.g., state layer has no adj file)
            return null;
          }
            const arrayBuffer = await response.arrayBuffer();
            return [fileName, new Uint8Array(arrayBuffer)] as [string, Uint8Array];
        })
        .catch(() => null); // Ignore missing files
      
      loadPromises.push({ fileName, promise });
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

