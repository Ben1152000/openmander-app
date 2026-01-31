import { useEffect, useRef, useState } from "react";
import maplibregl, { Map } from "maplibre-gl";
import { useWasm } from "./useWasm";
import { loadPackFromDirectory } from "./loadPack";
import { Protocol } from "pmtiles";
import "./App.css";

// PMTiles protocol handler - set up once using the pmtiles library
let pmtilesProtocolSetup = false;

function setupPmtilesProtocol() {
  if (pmtilesProtocolSetup) return;
  
  // Use the pmtiles library's protocol handler
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  
  pmtilesProtocolSetup = true;
}

type FeatureId = string; // e.g., GEOID20
type DistrictId = number;

// Constants
const ZOOM_THRESHOLD_COUNTY_TO_VTD = 8;
const ZOOM_THRESHOLD_VTD_TO_BLOCK = 12;
const DEFAULT_ZOOM = 6;
const DEFAULT_NUM_DISTRICTS = 4;
const DEFAULT_LAYER = "county";

// Colors are now computed in MapLibre style expressions, not in JS


export default function App() {
  const mapRef = useRef<Map | null>(null);
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const { wasm, loading: wasmLoading, error: wasmError } = useWasm();

  // State for pack data
  const [plan, setPlan] = useState<any>(null);
  const [mapData, setMapData] = useState<{ wasmMap?: any; wasmMapProxy?: any; packFiles?: Record<string, Uint8Array> } | null>(null);
  const [numDistricts, setNumDistricts] = useState(DEFAULT_NUM_DISTRICTS); // Default for Illinois
  const [mapInitialized, setMapInitialized] = useState(false);
  const [planUpdateTrigger, setPlanUpdateTrigger] = useState(0);
  const updatingFromPlanRef = useRef(false);
  
  // Loading states
  const [loadingPack, setLoadingPack] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>("");
  
  // Level-of-detail: track current layer
  const [currentZoom, setCurrentZoom] = useState<number>(DEFAULT_ZOOM); // For display only
  const [activeLayer, setActiveLayer] = useState<string>(DEFAULT_LAYER); // Triggers layer switch when changed
  const [currentLayer, setCurrentLayer] = useState<string>(DEFAULT_LAYER); // For display
  const previousLayerRef = useRef<string>(DEFAULT_LAYER); // Track previous layer to detect threshold crossings
  const featureHashesRef = useRef<Record<string, string>>({}); // Track feature hashes: featureId -> hash
  const activeLayerRef = useRef<string>(DEFAULT_LAYER); // Ref to track activeLayer for immediate access in event handlers
  const loadedSourcesRef = useRef<Set<string>>(new Set()); // Track which sources have been loaded

  // Assignments: Store in ref to avoid React re-renders and object cloning overhead
  // Only keep small UI state in React (counts per district for display)
  // Use Record instead of Map to avoid type conflicts
  const assignmentsRef = useRef<Record<string, number>>({});
  const [activeDistrict, setActiveDistrict] = useState<DistrictId>(1);
  const [paintMode, setPaintMode] = useState(false);
  
  // Optional: Keep counts in state for UI display (lightweight, only updates when needed)
  const [districtCounts, setDistrictCounts] = useState<Record<number, number>>({});
  
  // Visualization mode: "districts" or "partisan"
  const [visualizationMode, setVisualizationMode] = useState<"districts" | "partisan">("districts");
  
  // Store partisan lean data (geo_id -> lean percentage, positive = Dem, negative = Rep)
  const partisanLeanRef = useRef<Record<string, number>>({});
  
  // Store geo_id by index for each layer (index -> geo_id)
  const geoIdByIndexRef = useRef<Record<string, Record<number, string>>>({});

  // Load Illinois pmtiles pack data
  useEffect(() => {
    if (!wasm) return;

    const loadIllinoisPack = async () => {
      setLoadingPack(true);
      setLoadingStatus("Loading pack files...");
      try {
        const packPath = "/packs/IL_2020_webpack";
        const packFiles = await loadPackFromDirectory(packPath, (current, total, fileName) => {
          if (fileName) {
            setLoadingStatus(`Loading pack files... (${current}/${total}) - ${fileName}`);
          } else {
          setLoadingStatus(`Loading pack files... (${current}/${total})`);
          }
        });

        setLoadingStatus("Initializing map...");

        // Yield to React's render cycle to allow status update to be displayed
        // Use requestAnimationFrame to ensure the browser paints the update before blocking
        await new Promise(resolve => {
          requestAnimationFrame(() => {
            // Double RAF to ensure paint happens
            requestAnimationFrame(resolve);
          });
        });
        
        // Construct WasmMap from pack files
        // Note: This runs synchronously on the main thread and will block UI updates
        // The requestAnimationFrame above ensures React renders the "Initializing map..." status first
        const { WasmMap } = wasm as any;
        const wasmMap = new WasmMap(packFiles);

        // Store the map for plan creation
        setMapData({ wasmMap, packFiles });
      } catch (err) {
        console.error("Failed to load Illinois pmtiles pack:", err);
        setLoadingStatus("Error loading pack");
        // No fallback - PMTiles are required
      } finally {
        setLoadingPack(false);
        setLoadingStatus("");
      }
    };

    loadIllinoisPack();
  }, [wasm]);
  
  // Load partisan lean data from CSV files
  useEffect(() => {
    if (!mapData?.packFiles) return;
    
    const loadPartisanData = async () => {
      const packFiles = mapData.packFiles; // Store reference for TypeScript
      if (!packFiles) return; // Additional guard for TypeScript
      
      try {
        const allLayers = ["state", "county", "tract", "group", "vtd", "block"];
        const leanData: Record<string, number> = {};
        const indexMaps: Record<string, Record<number, string>> = {};
        
        // Load data for each layer
        for (const layerName of allLayers) {
          const csvFile = packFiles[`data/${layerName}.csv`];
          if (!csvFile) {
            console.warn(`${layerName} CSV file not found`);
            continue;
          }
          
          // Parse CSV
          const csvText = new TextDecoder().decode(csvFile);
          const lines = csvText.split('\n');
          const headers = lines[0].split(',');
          
          // Find column indices
          const idxIdx = headers.indexOf('idx');
          const geoIdIdx = headers.indexOf('geo_id');
          const demIdx = headers.indexOf('E_20_PRES_Dem');
          const repIdx = headers.indexOf('E_20_PRES_Rep');
          
          if (idxIdx === -1 || geoIdIdx === -1) {
            console.warn(`Required columns not found in ${layerName} CSV`);
            continue;
          }
          
          const indexToGeoId: Record<number, string> = {};
          
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const cols = line.split(',');
            const idx = parseInt(cols[idxIdx]);
            const geoId = cols[geoIdIdx];
            
            // Store index -> geo_id mapping
            indexToGeoId[idx] = geoId;
            
            // Calculate partisan lean if election data exists
            if (demIdx !== -1 && repIdx !== -1) {
              const dem = parseFloat(cols[demIdx]) || 0;
              const rep = parseFloat(cols[repIdx]) || 0;
              const total = dem + rep;
              
              if (total > 0) {
                // Calculate lean: positive = Dem, negative = Rep
                leanData[geoId] = (dem - rep) / total;
              }
            }
          }
          
          indexMaps[layerName] = indexToGeoId;
          console.log(`Loaded ${layerName}: ${Object.keys(indexToGeoId).length} features`);
        }
        
        partisanLeanRef.current = leanData;
        geoIdByIndexRef.current = indexMaps;
        console.log(`Total partisan lean data: ${Object.keys(leanData).length} features`);
      } catch (err) {
        console.error("Failed to load partisan data:", err);
      }
    };
    
    loadPartisanData();
  }, [mapData]);

  // Update feature-state with partisan lean when visualization mode changes
  useEffect(() => {
    if (!mapRef.current || !mapInitialized || !loadedSourcesRef.current.has("all")) return;
    
    const map = mapRef.current;
    const sourceId = "units-all";
    
    if (visualizationMode === "partisan") {
      console.log(`Partisan mode activated. Have ${Object.keys(partisanLeanRef.current).length} partisan lean values`);
      
      // Update feature-state for all visible features with partisan lean
      const updatePartisanStates = () => {
        const allLayers = ["state", "county", "tract", "group", "vtd", "block"];
        let updatedCount = 0;
        let totalFeatures = 0;
        let sampleGeoIds: string[] = [];
        
        for (const layerName of allLayers) {
          const fillLayerId = `units-${layerName}-fill`;
          if (!map.getLayer(fillLayerId)) {
            console.log(`Layer ${fillLayerId} not found`);
            continue;
          }
          
          const features = map.queryRenderedFeatures({ layers: [fillLayerId] });
          totalFeatures += features.length;
          
          console.log(`Layer ${layerName}: ${features.length} features`);
          
          for (const feature of features) {
            const index = feature.properties?.index;
            if (index === undefined) {
              console.log(`Feature missing index:`, feature.properties);
              continue;
            }
            
            // Look up geo_id from index
            const indexMap = geoIdByIndexRef.current[layerName];
            if (!indexMap) {
              console.log(`No index map for layer ${layerName}`);
              continue;
            }
            
            const geoId = indexMap[parseInt(index)];
            if (!geoId) {
              if (updatedCount === 0) {
                console.log(`No geo_id for index ${index} in layer ${layerName}`);
              }
              continue;
            }
            
            if (sampleGeoIds.length < 5) {
              sampleGeoIds.push(`${index}->${geoId}`);
            }
            
            const lean = partisanLeanRef.current[geoId];
            if (lean !== undefined) {
              map.setFeatureState(
                { source: sourceId, sourceLayer: layerName, id: index },
                { partisanLean: lean }
              );
              updatedCount++;
            } else if (updatedCount === 0) {
              // Log first mismatch
              console.log(`No lean data for geo_id: ${geoId} (index ${index})`);
            }
          }
        }
        
        console.log(`Total features: ${totalFeatures}, Updated: ${updatedCount}`);
        console.log(`Sample geo_ids from features:`, sampleGeoIds);
        console.log(`Sample geo_ids from partisan data:`, Object.keys(partisanLeanRef.current).slice(0, 5));
      };
      
      updatePartisanStates();
      
      // Update on map move/zoom
      map.on("moveend", updatePartisanStates);
      
      return () => {
        map.off("moveend", updatePartisanStates);
      };
    } else {
      // Clear partisan lean feature-state when switching back to district mode
      console.log("District mode activated. Clearing partisan lean states.");
      
      const clearPartisanStates = () => {
        const allLayers = ["state", "county", "tract", "group", "vtd", "block"];
        
        for (const layerName of allLayers) {
          const fillLayerId = `units-${layerName}-fill`;
          if (!map.getLayer(fillLayerId)) continue;
          
          const features = map.queryRenderedFeatures({ layers: [fillLayerId] });
          
          for (const feature of features) {
            const index = feature.properties?.index;
            if (index === undefined) continue;
            
            map.setFeatureState(
              { source: sourceId, sourceLayer: layerName, id: index },
              { partisanLean: null }
            );
          }
        }
      };
      
      clearPartisanStates();
    }
  }, [visualizationMode, mapInitialized]);

  // Create plan from WASM when mapData and numDistricts are available
  useEffect(() => {
    if (!wasm || !mapData?.wasmMap || !numDistricts) return;

    setLoadingStatus("Creating plan...");
    try {
      const { WasmPlan } = wasm as any;
      const newPlan = new WasmPlan(mapData.wasmMap, numDistricts);
      newPlan.randomize();
      setPlan(newPlan);
      setLoadingStatus("");
    } catch (err) {
      console.error("Failed to create plan:", err);
      setLoadingStatus("Error creating plan");
    }
  }, [wasm, mapData, numDistricts]);

  // Determine which layer to show based on zoom level
  const getLayerForZoom = (zoom: number): string => {
    if (zoom < ZOOM_THRESHOLD_COUNTY_TO_VTD) return "county";
    if (zoom < ZOOM_THRESHOLD_VTD_TO_BLOCK) return "vtd";
    return "block";
  };

  // Update assignments ref when plan changes (not in React state to avoid re-renders)
  // This is called only on plan updates, not on every assignment change
  useEffect(() => {
    if (!plan || activeLayer !== "block") return;

    // Update assignments ref from plan (stored in ref, not state, to avoid React overhead)
    try {
      const assignmentsObj = plan.assignments_dict();
      if (assignmentsObj && typeof assignmentsObj === 'object') {
        const assignmentsDict = assignmentsObj as Record<string, number>;
        // Store in ref instead of state to avoid React re-renders and object cloning
        assignmentsRef.current = assignmentsDict;
        
        // Update district counts for UI display (lightweight)
        const counts: Record<number, number> = {};
        for (const district of Object.values(assignmentsDict)) {
          counts[district] = (counts[district] ?? 0) + 1;
        }
        setDistrictCounts(counts);
            }
          } catch (err) {
      console.error("Failed to get assignments from plan:", err);
    }
  }, [planUpdateTrigger, plan, activeLayer]);

  // Initialize map only once
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;

    // Set up PMTiles protocol handler
    setupPmtilesProtocol();

    const map = new maplibregl.Map({
      container: mapDivRef.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [-89.0, 40.0], // Illinois center
      zoom: DEFAULT_ZOOM,
      // CRITICAL FIX: Enable anti-aliasing to eliminate phantom tile boundaries
      // Note: antialias is supported but may not be in all type definitions
      antialias: true,
      // OPTIMIZATION: Improve rendering quality
      fadeDuration: 0, // Disable fade-in animation for instant tile display
      // Enable pixel ratio for high-DPI displays
      pixelRatio: window.devicePixelRatio || 1,
    } as any); // Type assertion needed for antialias property
    mapRef.current = map;

    map.on("load", () => {
      // Source and layers will be added by the effect that watches geojsonByLayer
      // Don't add them here since geojson might not be loaded yet

      // Track zoom level changes to switch between layers (county/vtd/block)
      // Use zoomend instead of zoom to avoid constant re-renders during zoom gestures
      map.on("zoomend", () => {
          const zoom = map.getZoom();
          const newLayer = getLayerForZoom(zoom);
          const previousLayer = previousLayerRef.current;
          
        // Update layer when threshold is crossed
          if (newLayer !== previousLayer) {
            console.log(`Layer changed from ${previousLayer} to ${newLayer} at zoom ${zoom}`);
          previousLayerRef.current = newLayer;
          activeLayerRef.current = newLayer;
          
          // OPTIMIZATION: Directly toggle layer visibility without React state updates
          // All layers are already loaded, so we just show/hide them
          const allLayers = ["state", "county", "tract", "group", "vtd", "block"];
          for (const layerName of allLayers) {
            const fillLayerId = `units-${layerName}-fill`;
            const lineLayerId = `units-${layerName}-line`;
            const visibility = layerName === newLayer ? "visible" : "none";
            
            if (map.getLayer(fillLayerId)) {
              map.setLayoutProperty(fillLayerId, "visibility", visibility);
            }
            if (map.getLayer(lineLayerId)) {
              map.setLayoutProperty(lineLayerId, "visibility", visibility);
            }
          }
          
          // Update React state for UI (but layer is already switched)
          setActiveLayer(newLayer);
          setCurrentLayer(newLayer);
        }
        setCurrentZoom(zoom);
      });

      // Initial layer setup
      const initialZoom = map.getZoom();
      const initialLayer = getLayerForZoom(initialZoom);
      previousLayerRef.current = initialLayer;
      activeLayerRef.current = initialLayer;
      setActiveLayer(initialLayer);
      setCurrentLayer(initialLayer);
      setCurrentZoom(initialZoom);

      setMapInitialized(true);
    });

    return () => {
      // Cleanup on unmount
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapInitialized(false);
    };
  }, []); // Only run once on mount

  // Set up PMTiles vector tile source once (single file with all layers)
  // Then toggle layer visibility for fast switching
  useEffect(() => {
    if (!mapRef.current || !mapInitialized) {
      return;
    }
    
    const map = mapRef.current;
    const sourceId = "units-all"; // Single source for all layers

    // Load the single multi-layer PMTiles source if not already loaded
    if (!loadedSourcesRef.current.has("all")) {
      const pmtilesPath = `/packs/IL_2020_webpack/geom/geometries.pmtiles`;
      console.log(`Loading multi-layer PMTiles source`);
      setLoadingStatus(`Loading geometry layers...`);
      
      try {
        // Add single source with all layers
        map.addSource(sourceId, {
          type: "vector",
          url: `pmtiles://${pmtilesPath}`,
          // Performance hints for MapLibre
          scheme: "xyz",
          bounds: [-91.5, 36.9, -87.0, 42.5], // Illinois bounds (approximate)
        } as any);

        // Define paint style for fill layers (supports both district and partisan visualization)
        const fillPaint: any = {
          "fill-color": [
            "case",
            // If partisanLean feature-state exists (not null), use partisan coloring
            ["!=", ["feature-state", "partisanLean"], null],
            [
              "interpolate",
              ["linear"],
              ["feature-state", "partisanLean"],
              -1, "#ff0000",    // 100% Republican = red
              -0.5, "#ff8080",  // 75% Republican = light red
              0, "#e8e8e8",     // 50-50 = light gray
              0.5, "#8080ff",   // 75% Democrat = light blue
              1, "#0000ff"      // 100% Democrat = blue
            ],
            // Otherwise use district coloring
            [
              "match",
              ["feature-state", "district"],
              1, "hsl(57 70% 50%)",
              2, "hsl(114 70% 50%)",
              3, "hsl(171 70% 50%)",
              4, "hsl(228 70% 50%)",
              5, "hsl(285 70% 50%)",
              6, "hsl(342 70% 50%)",
              7, "hsl(39 70% 50%)",
              8, "hsl(96 70% 50%)",
              9, "hsl(153 70% 50%)",
              10, "hsl(210 70% 50%)",
              "rgba(0,0,0,0)"
            ]
          ],
          "fill-opacity": 0.7,
          "fill-antialias": true,
        };

        // Define paint style for line layers (shared across all layers)
        const linePaint: any = {
          "line-width": 1.5,
          "line-color": "rgba(0,0,0,0.4)",
          "line-gap-width": 0,
          "line-blur": 0.5
        };

        const lineLayout: any = {
          "line-cap": "round",
          "line-join": "round"
        };

        // Create fill and line layers for each geometry layer
        const allLayers = ["state", "county", "tract", "group", "vtd", "block"];
        for (const layerName of allLayers) {
          const fillLayerId = `units-${layerName}-fill`;
          const lineLayerId = `units-${layerName}-line`;

          // Add fill layer
          map.addLayer({
            id: fillLayerId,
            type: "fill",
            source: sourceId,
            "source-layer": layerName, // Reference the layer name from PMTiles
            paint: fillPaint,
            layout: {
              visibility: "none" // Start hidden, will show current layer below
            }
          });

          // Add line layer
          map.addLayer({
            id: lineLayerId,
            type: "line",
            source: sourceId,
            "source-layer": layerName, // Reference the layer name from PMTiles
            paint: linePaint,
            layout: {
              ...lineLayout,
              visibility: "none" // Start hidden, will show current layer below
            }
          });
        }

        // Mark as loaded
        loadedSourcesRef.current.add("all");

        // Handle source errors
        const source = map.getSource(sourceId) as maplibregl.VectorTileSource;
        source.on("error", (e: any) => {
          console.error(`PMTiles source error:`, e);
          setLoadingStatus(`Error loading geometry layers`);
        });

        source.on("data", (e: any) => {
          if (e.dataType === "source" && e.isSourceLoaded) {
            console.log(`Multi-layer PMTiles source loaded - all layers ready`);
            setLoadingStatus("");
          }
        });
      } catch (err) {
        console.error(`Failed to add multi-layer PMTiles source:`, err);
        setLoadingStatus(`Error: Failed to load geometry layers`);
      }
    }
  }, [mapInitialized]);

  // Toggle layer visibility when currentLayer changes
  useEffect(() => {
    if (!mapRef.current || !mapInitialized || !loadedSourcesRef.current.has("all")) {
      return;
    }

    const map = mapRef.current;
    const allLayers = ["state", "county", "tract", "group", "vtd", "block"];

    // Show current layer, hide all others
    for (const layerName of allLayers) {
      const fillLayerId = `units-${layerName}-fill`;
      const lineLayerId = `units-${layerName}-line`;
      
      const fillLayer = map.getLayer(fillLayerId);
      const lineLayer = map.getLayer(lineLayerId);
      
      const visibility = layerName === currentLayer ? "visible" : "none";
      
      if (fillLayer) {
        map.setLayoutProperty(fillLayerId, "visibility", visibility);
      }
      if (lineLayer) {
        map.setLayoutProperty(lineLayerId, "visibility", visibility);
      }
    }
  }, [currentLayer, mapInitialized]);
  
  // Toggle line visibility based on visualization mode
  useEffect(() => {
    if (!mapRef.current || !mapInitialized || !loadedSourcesRef.current.has("all")) {
      return;
    }

    const map = mapRef.current;
    const allLayers = ["state", "county", "tract", "group", "vtd", "block"];

    // Hide lines in partisan mode, show in district mode
    const lineVisibility = visualizationMode === "partisan" ? "none" : "visible";
    
    for (const layerName of allLayers) {
      const lineLayerId = `units-${layerName}-line`;
      const lineLayer = map.getLayer(lineLayerId);
      
      if (lineLayer) {
        // Only update if the layer is currently visible (matches currentLayer)
        if (layerName === currentLayer) {
          map.setLayoutProperty(lineLayerId, "visibility", lineVisibility);
        }
      }
    }
  }, [visualizationMode, currentLayer, mapInitialized]);

  // Set up map event handlers for paint mode
  // Properly cleanup handlers when layer changes to avoid leaks
  useEffect(() => {
    if (!mapRef.current || !mapInitialized) return;

    const map = mapRef.current;
    const fillLayerId = `units-${currentLayer}-fill`;

    if (!map.getLayer(fillLayerId)) return;

    // Create stable handler functions for proper cleanup
    const handleMouseMove = () => {
        map.getCanvas().style.cursor = paintMode ? "crosshair" : "pointer";
    };
    
    const handleMouseLeave = () => {
        map.getCanvas().style.cursor = "";
    };

    const handleClick = (e: any) => {
        if (!paintMode) return;
        const f = e.features?.[0] as any;
      const id: FeatureId = String(f?.properties?.geo_id ?? "");
        if (!id) return;

      // Update assignments ref (no React state update = no re-render)
      const prevDistrict = assignmentsRef.current[id];
      assignmentsRef.current[id] = activeDistrict;
      
      // Update district counts incrementally (lightweight UI state)
      setDistrictCounts((c) => {
        const next = { ...c };
        if (prevDistrict != null) {
          next[prevDistrict] = (next[prevDistrict] ?? 1) - 1;
        }
        next[activeDistrict] = (next[activeDistrict] ?? 0) + 1;
        return next;
      });
      
      // Update feature-state immediately for responsive UI (only district number, color in style)
      const sourceId = "units-all"; // Single source for all layers
      map.setFeatureState(
        {
          source: sourceId,
          sourceLayer: currentLayer, // Use layer name as source-layer
          id: id
        },
        {
          district: activeDistrict
        }
      );
      
      // Update hash for change tracking
      featureHashesRef.current[id] = `${id}:${activeDistrict}`;
    };

    // Add handlers
    map.on("mousemove", fillLayerId, handleMouseMove);
    map.on("mouseleave", fillLayerId, handleMouseLeave);
    map.on("click", fillLayerId, handleClick);

    // Cleanup: remove handlers when layer changes or component unmounts
    return () => {
      map.off("mousemove", fillLayerId, handleMouseMove);
      map.off("mouseleave", fillLayerId, handleMouseLeave);
      map.off("click", fillLayerId, handleClick);
    };
  }, [paintMode, activeDistrict, mapInitialized, currentLayer]);

  // Update feature-state for district assignments when plan changes
  // This uses MapLibre's feature-state API to efficiently update colors without regenerating tiles
  // OPTIMIZED: Only updates visible features, batches updates, and debounces during tile loading
  useEffect(() => {
    if (!plan || !mapRef.current || !mapInitialized || updatingFromPlanRef.current) return;
    
    const map = mapRef.current;
    const layerName = currentLayer;
    const sourceId = "units-all"; // Single source for all layers
    const fillLayerId = `units-${layerName}-fill`;
    const source = map.getSource(sourceId) as maplibregl.VectorTileSource;
    
    if (!source) return; // Source not loaded yet

    // Get assignments from plan (only for block layer, other layers don't have districts)
    if (layerName !== "block") return;

    // Update feature-state for rendered features only (what's actually on screen)
    // Look up districts from assignmentsRef (not from WASM on every update)
    const updateFeatureStates = () => {
      try {
        const fillLayer = map.getLayer(fillLayerId);
        if (!fillLayer) return;

        // OPTIMIZATION: Only query rendered features (visible on screen)
        // This is much faster than updating all features in the dataset
        const features = map.queryRenderedFeatures({ layers: [fillLayerId] });

        // OPTIMIZATION: Batch feature-state updates to reduce repaints
        let updatedCount = 0;
        const updates: Array<{ id: string; district: number | null }> = [];
        
        for (const feature of features) {
          const geoId = feature.properties?.geo_id;
          if (!geoId) continue;

          // Look up district from ref (fast, no WASM boundary crossing)
          const district = assignmentsRef.current[geoId] ?? null;
          const newHash = `${geoId}:${district ?? 0}`;
          const oldHash = featureHashesRef.current[geoId];

          // Only update if changed
          if (newHash !== oldHash) {
            featureHashesRef.current[geoId] = newHash;
            updates.push({ id: geoId, district });
            updatedCount++;
          }
        }

        // Apply all updates in a single batch
        if (updates.length > 0) {
          for (const { id, district } of updates) {
            map.setFeatureState(
              {
                source: sourceId,
                sourceLayer: layerName, // Use layer name as source-layer
                id: id
              },
              {
                district: district ?? null
              }
            );
          }
          console.log(`Updated feature-state for ${updatedCount} rendered features`);
        }
      } catch (err) {
        console.error("Error updating feature states:", err);
      }
    };

    // OPTIMIZATION: Debounce updates to avoid blocking during tile loading
    // Use a longer delay to let tiles fully load before updating feature states
    let timeoutId: number | null = null;
    let pending = false;
    
    const schedule = () => {
      if (pending) return;
      pending = true;
      
      // Clear any pending timeout
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      
      // Debounce: wait 200ms after last event before updating
      timeoutId = window.setTimeout(() => {
        pending = false;
        timeoutId = null;
        requestAnimationFrame(updateFeatureStates);
      }, 200);
    };

    // Update when camera settles (not during active panning/zooming)
    map.on("moveend", schedule);
    map.on("zoomend", schedule);
    
    // OPTIMIZATION: Use 'idle' event to update only when map is fully loaded
    // This ensures tiles are loaded before we try to update feature states
    map.on("idle", schedule);

    // Initial update after tiles have had time to load
    const initialTimeoutId = setTimeout(schedule, 300);

    return () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      clearTimeout(initialTimeoutId);
      map.off("moveend", schedule);
      map.off("zoomend", schedule);
      map.off("idle", schedule);
    };
  }, [planUpdateTrigger, plan, currentLayer, mapInitialized]);

  const handleRandomize = () => {
    if (!plan) return;
    try {
      plan.randomize();
      // Trigger update
      setPlanUpdateTrigger((prev) => prev + 1);
    } catch (err) {
      console.error("Failed to randomize plan:", err);
    }
  };

  const handleOptimize = () => {
    if (!plan) return;
    try {
      // Run a few optimization steps
      plan.tabu_balance("TOTPOP", 100, 10, 0.5, 50);
      // Trigger update
      setPlanUpdateTrigger((prev) => prev + 1);
    } catch (err) {
      console.error("Failed to optimize plan:", err);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", height: "100vh", width: "100vw", margin: 0, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: 14, borderRight: "1px solid #ddd", overflow: "auto" }}>
        <h2 style={{ margin: "0 0 10px 0" }}>OpenMander UI</h2>

        {wasmLoading && <div>Loading WASM...</div>}
        {wasmError && <div style={{ color: "red" }}>WASM Error: {wasmError.message}</div>}
        {!wasmLoading && !wasmError && <div style={{ color: "green" }}>✓ WASM loaded</div>}
        
        <div style={{ fontSize: 12, color: "#666", marginTop: 8, marginBottom: 8 }}>
          Zoom: {currentZoom.toFixed(1)} | Layer: {currentLayer}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, marginTop: 10 }}>
          <label>Districts:</label>
          <input
            type="number"
            value={numDistricts}
            min={1}
            max={10}
            onChange={(e) => setNumDistricts(parseInt(e.target.value || "4", 10))}
            style={{ width: 80 }}
          />
        </div>

        <button
          onClick={handleRandomize}
          style={{ width: "100%", marginBottom: 8 }}
          disabled={!plan}
        >
          Randomize Plan
        </button>
        <button
          onClick={handleOptimize}
          style={{ width: "100%", marginBottom: 12 }}
          disabled={!plan}
        >
          Optimize (Equalize Pop)
        </button>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 4 }}>Visualization:</label>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => setVisualizationMode("districts")}
              style={{
                flex: 1,
                backgroundColor: visualizationMode === "districts" ? "#4CAF50" : "#f0f0f0",
                color: visualizationMode === "districts" ? "white" : "black",
              }}
            >
              Districts
            </button>
            <button
              onClick={() => setVisualizationMode("partisan")}
              style={{
                flex: 1,
                backgroundColor: visualizationMode === "partisan" ? "#4CAF50" : "#f0f0f0",
                color: visualizationMode === "partisan" ? "white" : "black",
              }}
            >
              Partisan Lean
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <label>District:</label>
          <input
            type="number"
            value={activeDistrict}
            min={1}
            onChange={(e) => setActiveDistrict(parseInt(e.target.value || "1", 10))}
            style={{ width: 80 }}
          />
          <button onClick={() => setPaintMode((v) => !v)}>
            {paintMode ? "Paint: ON" : "Paint: OFF"}
          </button>
        </div>

        <button
          onClick={() => {
            assignmentsRef.current = {};
            setDistrictCounts({});
            // Clear all feature states
            if (mapRef.current && currentLayer === "block") {
              const sourceId = "units-all"; // Single source for all layers
              const fillLayerId = `units-${currentLayer}-fill`;
              const features = mapRef.current.queryRenderedFeatures({ layers: [fillLayerId] });
              for (const feature of features) {
                const geoId = feature.properties?.geo_id;
                if (geoId) {
                  mapRef.current.setFeatureState(
                    { source: sourceId, sourceLayer: currentLayer, id: geoId },
                    { district: null }
                  );
                }
              }
            }
          }}
          style={{ width: "100%", marginBottom: 12 }}
        >
          Clear assignments
        </button>

        <h3 style={{ margin: "12px 0 6px 0" }}>Metrics (toy)</h3>
        <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 }}>
          {Object.keys(districtCounts).length === 0 && <div>(no assignments yet)</div>}
          {Object.entries(districtCounts)
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([d, c]) => (
              <div key={d}>
                D{d}: {String(c)} units
              </div>
            ))}
        </div>

        <hr style={{ margin: "14px 0" }} />

        <h3 style={{ margin: "12px 0 6px 0" }}>Where OpenMander fits</h3>
        <ol style={{ paddingLeft: 18, margin: 0 }}>
          <li>Download pack (your existing layout)</li>
          <li>Load into WASM worker (Map/Plan)</li>
          <li>UI sends: set assignments / run steps</li>
          <li>Worker returns: assignments + metrics</li>
        </ol>
      </div>

      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <div ref={mapDivRef} style={{ width: "100%", height: "100%" }} />
        {/* Loading indicator overlay */}
        {loadingPack && (
          <div
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              backgroundColor: "rgba(255, 255, 255, 0.95)",
              padding: "12px 16px",
              borderRadius: "8px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
              display: "flex",
              alignItems: "center",
              gap: 12,
              zIndex: 1000,
              minWidth: 200,
            }}
          >
            <div className="loading-spinner" />
            <div>
              <div style={{ fontWeight: 500, fontSize: 14, color: "#333" }}>
                {loadingPack ? "Loading map..." : `Loading ${activeLayer}...`}
              </div>
              {loadingStatus && (
                <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                  {loadingStatus}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

