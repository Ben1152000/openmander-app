/**
 * Load pack files from the public directory.
 * For webpack (JSON format), loads individual files and returns them as a map.
 * 
 * @param packPath Path to the pack directory
 * @param onProgress Optional callback for progress updates (current, total)
 */
export async function loadPackFromDirectory(
  packPath: string,
  onProgress?: (current: number, total: number) => void
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};

  // List of files to load based on pack structure
  const layers = ["state", "county", "tract", "group", "vtd", "block"];
  const fileTypes = [
    { dir: "adj", ext: "csr.bin" },
    { dir: "data", ext: "json" },
    { dir: "geom", ext: "geojson" },
    { dir: "hull", ext: "geojson" },
  ];

  // Load manifest first to verify pack structure
  try {
    const manifestResponse = await fetch(`${packPath}/manifest.json`);
    if (!manifestResponse.ok) {
      throw new Error(`Failed to load manifest: ${manifestResponse.statusText}`);
    }
    const manifest = await manifestResponse.json();
    console.log("Pack manifest:", manifest);
  } catch (err) {
    console.warn("Could not load manifest:", err);
  }

  // Load all pack files in parallel with priority for essential files
  // Load data files first (needed for map initialization), then geometry, then adjacencies
  const loadPromises: Promise<[string, Uint8Array]>[] = [];
  
  // Priority order: data files first (needed for initialization), then geometry, then adjacencies
  const priorityOrder = [
    { dir: "data", ext: "json" },
    { dir: "geom", ext: "geojson" },
    { dir: "hull", ext: "geojson" },
    { dir: "adj", ext: "csr.bin" },
  ];

  for (const fileType of priorityOrder) {
    for (const layer of layers) {
      const fileName = `${fileType.dir}/${layer}.${fileType.ext}`;
      const filePath = `${packPath}/${fileName}`;
      
      loadPromises.push(
        fetch(filePath)
          .then(async (response) => {
            if (!response.ok) {
              // Some files might not exist (e.g., state layer has no adj file)
              return null;
            }
            const arrayBuffer = await response.arrayBuffer();
            return [fileName, new Uint8Array(arrayBuffer)] as [string, Uint8Array];
          })
          .catch(() => null) // Ignore missing files
      );
    }
  }

  // Load files with progress tracking
  let loadedCount = 0;
  const totalFiles = loadPromises.length;
  
  // Wrap promises to track progress
  const trackedPromises = loadPromises.map((promise, index) =>
    promise.then((result) => {
      loadedCount++;
      if (onProgress) {
        onProgress(loadedCount, totalFiles);
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

  console.log(`Loaded ${Object.keys(files).length} pack files from ${packPath}`);
  
  // Debug: log which files were loaded
  const loadedFiles = Object.keys(files).sort();
  console.log("Loaded files:", loadedFiles);
  
  // Check if required files are present
  const requiredFiles = ["data/state.json", "data/county.json", "data/block.json"];
  const missingFiles = requiredFiles.filter(f => !files[f]);
  if (missingFiles.length > 0) {
    console.warn("Missing required files:", missingFiles);
  }
  
  return files;
}

