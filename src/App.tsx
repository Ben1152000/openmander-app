import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { Map } from "maplibre-gl";
import { useWasm } from "./useWasm";
import { loadPackFromDirectory } from "./loadPack";
import "./App.css";

type FeatureId = string; // e.g., GEOID20
type DistrictId = number;

// Constants
const BOUNDS_MARGIN = 0.0001; // Small margin for floating point comparison
const BOUNDS_PADDING_FACTOR = 0.5; // 50% padding on each side for preloading
const THROTTLE_DELAY_MS = 150; // Minimum time between loads (ms)
const ZOOM_DEBOUNCE_MS = 300; // Debounce delay for zoom events
const UPDATE_FLAG_RESET_DELAY_MS = 100; // Delay before resetting updatingFromPlanRef flag
const ZOOM_THRESHOLD_COUNTY_TO_VTD = 8.5;
const ZOOM_THRESHOLD_VTD_TO_BLOCK = 11.5;
const DEFAULT_ZOOM = 6;
const DEFAULT_NUM_DISTRICTS = 4;
const DEFAULT_LAYER = "county";

function hashColor(d: number): string {
  // stable, readable-ish palette without deps
  const h = (d * 57) % 360;
  return `hsl(${h} 70% 50%)`;
}

// Helper functions for bounds checking
type Bounds = [number, number, number, number]; // [min_lon, min_lat, max_lon, max_lat]

/**
 * Check if viewport bounds are completely within loaded bounds
 */
function isViewportWithinBounds(
  viewportBounds: Bounds,
  loadedBounds: Bounds
): boolean {
  const [viewportWest, viewportSouth, viewportEast, viewportNorth] = viewportBounds;
  const [loadedWest, loadedSouth, loadedEast, loadedNorth] = loadedBounds;
  
  return (
    viewportWest >= loadedWest - BOUNDS_MARGIN &&
    viewportSouth >= loadedSouth - BOUNDS_MARGIN &&
    viewportEast <= loadedEast + BOUNDS_MARGIN &&
    viewportNorth <= loadedNorth + BOUNDS_MARGIN
  );
}

/**
 * Check if viewport bounds exceed (go outside) loaded bounds
 */
function doesViewportExceedBounds(
  viewportBounds: Bounds,
  loadedBounds: Bounds
): boolean {
  const [viewportWest, viewportSouth, viewportEast, viewportNorth] = viewportBounds;
  const [loadedWest, loadedSouth, loadedEast, loadedNorth] = loadedBounds;
  
  return (
    viewportWest < loadedWest - BOUNDS_MARGIN ||
    viewportSouth < loadedSouth - BOUNDS_MARGIN ||
    viewportEast > loadedEast + BOUNDS_MARGIN ||
    viewportNorth > loadedNorth + BOUNDS_MARGIN
  );
}

/**
 * Check if viewport bounds are outside loaded bounds (for panning detection)
 * Uses different comparison logic - checks if viewport has moved outside the padded loaded area
 */
function isViewportOutsideLoadedArea(
  viewportBounds: Bounds,
  loadedBounds: Bounds
): boolean {
  const [viewportWest, viewportSouth, viewportEast, viewportNorth] = viewportBounds;
  const [loadedWest, loadedSouth, loadedEast, loadedNorth] = loadedBounds;
  
  // Check if current viewport (not padded) has moved outside the loaded area
  // The loaded area already includes padding, so we check if viewport is outside it
  return (
    viewportWest < loadedWest + BOUNDS_MARGIN ||
    viewportSouth < loadedSouth + BOUNDS_MARGIN ||
    viewportEast > loadedEast - BOUNDS_MARGIN ||
    viewportNorth > loadedNorth - BOUNDS_MARGIN
  );
}

/**
 * Check if request bounds cover the new bounds
 */
function doesRequestCoverBounds(
  requestBounds: Bounds,
  newBounds: Bounds
): boolean {
  const [reqWest, reqSouth, reqEast, reqNorth] = requestBounds;
  const [newWest, newSouth, newEast, newNorth] = newBounds;
  
  return (
    newWest >= reqWest - BOUNDS_MARGIN &&
    newSouth >= reqSouth - BOUNDS_MARGIN &&
    newEast <= reqEast + BOUNDS_MARGIN &&
    newNorth <= reqNorth + BOUNDS_MARGIN
  );
}

export default function App() {
  const mapRef = useRef<Map | null>(null);
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const { wasm, loading: wasmLoading, error: wasmError } = useWasm();

  // State for pack data
  const [geojson, setGeojson] = useState<any | null>(null);
  const [plan, setPlan] = useState<any>(null);
  const [mapData, setMapData] = useState<{ wasmMap?: any; packFiles?: Record<string, Uint8Array> } | null>(null);
  const [numDistricts, setNumDistricts] = useState(DEFAULT_NUM_DISTRICTS); // Default for Iowa
  const [mapInitialized, setMapInitialized] = useState(false);
  const [planUpdateTrigger, setPlanUpdateTrigger] = useState(0);
  const updatingFromPlanRef = useRef(false);
  
  // Loading states
  const [loadingPack, setLoadingPack] = useState(false);
  const [loadingLayer, setLoadingLayer] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>("");
  
  // Level-of-detail: store GeoJSON for different layers
  const [geojsonByLayer, setGeojsonByLayer] = useState<Record<string, any>>({});
  const [currentZoom, setCurrentZoom] = useState<number>(DEFAULT_ZOOM); // For display only
  const [activeLayer, setActiveLayer] = useState<string>(DEFAULT_LAYER); // Triggers data reload when changed
  const [currentLayer, setCurrentLayer] = useState<string>(DEFAULT_LAYER); // For display
  const [mapBounds, setMapBounds] = useState<[number, number, number, number] | null>(null); // [min_lon, min_lat, max_lon, max_lat]
  const [loadedBounds, setLoadedBounds] = useState<Record<string, [number, number, number, number]>>({}); // Track loaded bounds per layer
  const throttleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousLayerRef = useRef<string>(DEFAULT_LAYER); // Track previous layer to detect threshold crossings
  const featureHashesRef = useRef<Record<string, string>>({}); // Track feature hashes: featureId -> hash
  const loadedBoundsRef = useRef<Record<string, [number, number, number, number]>>({}); // Ref version for immediate access in event handlers
  const lastLoadTimeRef = useRef<number>(0); // Track last load time for throttling
  const loadingRequestRef = useRef<{ layer: string; bounds: [number, number, number, number] } | null>(null); // Track current loading request
  const loadingAbortControllerRef = useRef<AbortController | null>(null); // For cancelling in-flight requests
  const activeLayerRef = useRef<string>(DEFAULT_LAYER); // Ref to track activeLayer for immediate access in event handlers
  const zoomDebounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // For debouncing zoom events

  // Assignments: FeatureId -> DistrictId
  const [assignments, setAssignments] = useState<Record<FeatureId, DistrictId>>({});
  const [activeDistrict, setActiveDistrict] = useState<DistrictId>(1);
  const [paintMode, setPaintMode] = useState(true);

  // Metrics: simple counts per district
  const metrics = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const k of Object.keys(assignments)) {
      const d = assignments[k];
      counts[d] = (counts[d] ?? 0) + 1;
    }
    return counts;
  }, [assignments]);

  // Load Iowa webpack data
  useEffect(() => {
    if (!wasm) return;

    const loadIowaPack = async () => {
      setLoadingPack(true);
      setLoadingStatus("Loading pack files...");
      try {
        console.log("Loading Iowa webpack data...");
        const packPath = "/packs/IA_2020_webpack";
        const packFiles = await loadPackFromDirectory(packPath, (current, total) => {
          setLoadingStatus(`Loading pack files... (${current}/${total})`);
        });

        console.log(`Loaded ${Object.keys(packFiles).length} pack files`);
        setLoadingStatus("Initializing map...");

        // Create WasmMap from pack files
        const { WasmMap } = wasm as any;
        const wasmMap = new WasmMap(packFiles);

        // Get available layers
        const layers = wasmMap.layers_present();
        console.log("Available layers:", layers);

        // Store the map for plan creation
        setMapData({ wasmMap, packFiles });
        setLoadingStatus("");

        console.log("Iowa webpack loaded successfully");
      } catch (err) {
        console.error("Failed to load Iowa webpack:", err);
        setLoadingStatus("Error loading pack");
        // Fall back to demo GeoJSON
        try {
          const response = await fetch("/demo.geojson");
          if (response.ok) {
            const demoData = await response.json();
            setGeojson(demoData);
            setLoadingStatus("Loaded demo data");
          } else {
            console.error("Failed to load demo.geojson:", response.statusText);
            setLoadingStatus("Error: Could not load pack or demo data");
          }
        } catch (fallbackErr) {
          console.error("Failed to load demo.geojson", fallbackErr);
          setLoadingStatus("Error: Could not load pack or demo data");
        }
      } finally {
        setLoadingPack(false);
      }
    };

    loadIowaPack();
  }, [wasm]);

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
      console.log("Plan created with", numDistricts, "districts");
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

  // Update GeoJSON from plan (with district assignments) for all layers
  useEffect(() => {
    if (!plan || !wasm) return;

    updatingFromPlanRef.current = true;
    
    const loadLayerGeoJSON = async (layerName: string, bounds?: [number, number, number, number] | null) => {
      try {
        // Convert bounds to array format expected by WASM
        const boundsArray = bounds ? [bounds[0], bounds[1], bounds[2], bounds[3]] : null;
        
        let geojsonValue: any;
        if (layerName === "block") {
          // For blocks, use plan.to_geojson to get districts
          geojsonValue = plan.to_geojson(layerName, boundsArray);
        } else {
          // For county and vtd, use map.to_geojson (no districts for now)
          // TODO: Add district aggregation for higher-level layers
          if (!mapData?.wasmMap) {
            console.warn(`No wasmMap available for layer ${layerName}`);
            return null;
          }
          try {
            geojsonValue = mapData.wasmMap.to_geojson(layerName, boundsArray);
            if (!geojsonValue) {
              console.warn(`to_geojson returned null/undefined for layer ${layerName}`);
              return null;
            }
          } catch (err) {
            console.error(`Error calling to_geojson for layer ${layerName}:`, err);
            return null;
          }
        }
        
        if (!geojsonValue) {
          console.warn(`GeoJSON value is null/undefined for layer ${layerName}`);
          return null;
        }
        
        // Validate the structure first before expensive conversion
        if (typeof geojsonValue !== 'object') {
          console.warn(`Invalid GeoJSON structure for layer ${layerName}:`, geojsonValue);
          return null;
        }
        
        if (!geojsonValue.features || !Array.isArray(geojsonValue.features)) {
          console.warn(`GeoJSON missing features array for layer ${layerName}:`, geojsonValue);
          return null;
        }
        
        // Convert to plain JavaScript object to ensure it's serializable
        // This handles cases where js_sys::JSON::parse might create non-serializable objects
        // Only do the expensive conversion if the object appears to be a WASM object
        // (has non-standard properties or isn't a plain object)
        let plainObject: any;
        try {
          // Check if it's already a plain object by trying to serialize it
          // If it fails, then we need to convert it
          if (geojsonValue.constructor === Object || geojsonValue.constructor === Array) {
            // Likely already a plain object, but verify by checking if it has WASM-specific properties
            const hasWasmProperties = Object.getOwnPropertyNames(geojsonValue).some(
              prop => prop.startsWith('__') || typeof (geojsonValue as any)[prop] === 'function'
            );
            if (!hasWasmProperties) {
              // Already a plain object, use it directly
              plainObject = geojsonValue;
            } else {
              // Has WASM properties, need to convert
              plainObject = JSON.parse(JSON.stringify(geojsonValue));
            }
          } else {
            // Not a plain object, need to convert
            plainObject = JSON.parse(JSON.stringify(geojsonValue));
          }
        } catch (err) {
          // If serialization fails, try the expensive conversion as fallback
          console.warn(`Failed to serialize geojsonValue, using fallback conversion:`, err);
          plainObject = JSON.parse(JSON.stringify(geojsonValue));
        }
        
        return plainObject;
      } catch (err) {
        console.error(`Failed to get GeoJSON for layer ${layerName}:`, err);
        return null;
      }
    };

    // Check if current viewport is within loaded bounds
    const isViewportWithinLoadedBounds = (viewportBounds: Bounds | null, layer: string): boolean => {
      if (!viewportBounds) return false;
      
      const loaded = loadedBounds[layer];
      if (!loaded) return false; // No data loaded for this layer yet
      
      return isViewportWithinBounds(viewportBounds, loaded);
    };

    const loadCurrentLayer = async () => {
      // For block layer, we need plan. For other layers, we only need mapData.wasmMap
      if (activeLayer === "block") {
        if (!plan || !wasm) return;
      } else {
        if (!mapData?.wasmMap || !wasm) return;
      }
      
      // If no bounds yet, wait for map to initialize
      if (!mapBounds) {
        console.log("Waiting for map bounds...");
        return;
      }
      
      // Check if viewport is still within loaded bounds for this layer
      if (isViewportWithinLoadedBounds(mapBounds, activeLayer)) {
        console.log(`Viewport still within loaded bounds for ${activeLayer}, skipping reload`);
        return;
      }
      
      // Check if there's already a loading request that covers this viewport
      const currentRequest = loadingRequestRef.current;
      if (currentRequest && currentRequest.layer === activeLayer) {
        // Check if the current request's bounds already cover the new bounds
        if (doesRequestCoverBounds(currentRequest.bounds, mapBounds)) {
          console.log(`Current loading request already covers new viewport, skipping`);
          return;
        }
      }
      
      // Cancel any previous loading request
      if (loadingAbortControllerRef.current) {
        console.log(`Cancelling previous loading request`);
        loadingAbortControllerRef.current.abort();
      }
      
      // Create new abort controller for this request
      const abortController = new AbortController();
      loadingAbortControllerRef.current = abortController;
      
      // Track this loading request
      const requestId = { layer: activeLayer, bounds: mapBounds };
      loadingRequestRef.current = requestId;
      
      updatingFromPlanRef.current = true;
      setLoadingLayer(true);
      setLoadingStatus(`Loading ${activeLayer} layer...`);
      
      try {
        // Load only the active layer (viewport-based loading)
        console.log(`Loading ${activeLayer} layer for viewport (bounds: ${mapBounds})`);
        
        // Load the active layer with viewport bounds
        const layerGeoJSON = await loadLayerGeoJSON(activeLayer, mapBounds);
        
        // Check if this request was cancelled or superseded
        if (abortController.signal.aborted || loadingRequestRef.current !== requestId) {
          console.log(`Loading request was cancelled or superseded`);
          return;
        }
        
        if (layerGeoJSON && layerGeoJSON.features && Array.isArray(layerGeoJSON.features)) {
          // Initialize feature hashes for new features
          for (const f of layerGeoJSON.features) {
            const featureId = String(f.id ?? f.properties?.geo_id ?? "");
            const hash = String(f.properties?._hash ?? `${featureId}:${f.properties?.district ?? 0}`);
            if (featureId) {
              featureHashesRef.current[featureId] = hash;
            }
          }
          
          console.log(`Setting geojsonByLayer[${activeLayer}] with ${layerGeoJSON.features.length} features`);
          setGeojsonByLayer((prev) => {
            const updated = {
              ...prev,
              [activeLayer]: layerGeoJSON,
            };
            console.log(`Updated geojsonByLayer, now has layers: [${Object.keys(updated).join(', ')}]`);
            return updated;
          });
          setGeojson(layerGeoJSON);
          
          // Update loaded bounds for this layer (both state and ref)
          setLoadedBounds((prev) => {
            const updated = { ...prev, [activeLayer]: mapBounds };
            loadedBoundsRef.current = updated; // Keep ref in sync for immediate access
            return updated;
          });
          
          console.log(`Loaded ${activeLayer} layer: ${layerGeoJSON.features.length} features (viewport-filtered)`);
        } else {
          console.warn(`Failed to load ${activeLayer} layer GeoJSON`);
        }
        
        // For assignments, we still need to load all blocks (but we can do this less frequently)
        // Only update assignments when plan changes, not on every viewport change
        if (activeLayer === "block" && layerGeoJSON?.features && plan) {
          const assignmentsArray = plan.assignments_u32();
          const assignmentsDict: Record<string, number> = {};

          layerGeoJSON.features.forEach((feature: any, idx: number) => {
            const geoId = String(feature.properties?.geo_id ?? feature.properties?.GEOID20 ?? idx);
            const district = assignmentsArray[idx] || 0;
            if (district > 0) {
              assignmentsDict[geoId] = district;
            }
          });

          setAssignments(assignmentsDict);
        }
        
        setLoadingStatus("");
        
        // Clear the loading request on success (only if this is still the current request)
        if (loadingRequestRef.current === requestId) {
          loadingRequestRef.current = null;
          setLoadingLayer(false); // Clear loading state when request completes successfully
        }
      } catch (err) {
        // Check if this was an abort error or if request was superseded
        if (abortController.signal.aborted || loadingRequestRef.current !== requestId) {
          console.log(`Loading request was aborted or superseded`);
          return;
        }
        console.error("Failed to load GeoJSON layer:", err);
        setLoadingStatus("Error loading layer");
        
        // Clear the loading request on error (only if this is still the current request)
        if (loadingRequestRef.current === requestId) {
          loadingRequestRef.current = null;
          setLoadingLayer(false); // Clear loading state when request fails
        }
      } finally {
        // Clear abort controller if this is still the current one
        if (loadingAbortControllerRef.current === abortController) {
          loadingAbortControllerRef.current = null;
        }
        // Reset flag after a short delay to allow effects to run
        // Note: This timeout is intentionally not cleaned up as it's part of the async flow
        // and should complete even if the component unmounts during the delay
        setTimeout(() => {
          updatingFromPlanRef.current = false;
        }, UPDATE_FLAG_RESET_DELAY_MS);
      }
    };

    loadCurrentLayer();
  }, [plan, wasm, planUpdateTrigger, activeLayer, mapBounds, mapData]);

  // Initialize map only once
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapDivRef.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [-93.5, 42.0],
      zoom: DEFAULT_ZOOM,
    });
    mapRef.current = map;

    map.on("load", () => {
      // Source and layers will be added by the effect that watches geojsonByLayer
      // Don't add them here since geojson might not be loaded yet

      // Calculate bounds with padding (extends beyond visible area to preload nearby features)
      const calculatePaddedBounds = (): [number, number, number, number] => {
        const bounds = map.getBounds();
        const west = bounds.getWest();
        const south = bounds.getSouth();
        const east = bounds.getEast();
        const north = bounds.getNorth();
        
        // Add padding on each side to preload nearby features
        const lonPadding = (east - west) * BOUNDS_PADDING_FACTOR;
        const latPadding = (north - south) * BOUNDS_PADDING_FACTOR;
        
        return [
          west - lonPadding,
          south - latPadding,
          east + lonPadding,
          north + latPadding,
        ];
      };

      // Bounds update for panning (loads features as they pan into view)
      // Use throttle instead of debounce so it triggers during continuous panning
      const updateBoundsDuringPan = () => {
        const zoom = map.getZoom();
        setCurrentZoom(zoom);
        
        // Use activeLayerRef to get the current active layer (not calculated from zoom)
        // This ensures we only check bounds for the layer that's actually active,
        // not the layer that would be active at the current zoom (which might change during rapid zooming)
        const activeLayerForBounds = activeLayerRef.current; // Use the tracked active layer
        
        // Get current viewport bounds (without padding) to check if we need to load
        const bounds = map.getBounds();
        const viewportWest = bounds.getWest();
        const viewportSouth = bounds.getSouth();
        const viewportEast = bounds.getEast();
        const viewportNorth = bounds.getNorth();
        
        // Check if viewport has moved outside loaded bounds using ref for immediate access
        const loaded = loadedBoundsRef.current[activeLayerForBounds];
        
        let shouldLoad = false;
        
        if (!loaded) {
          // No data loaded for this layer, load it
          shouldLoad = true;
        } else {
          // Check if current viewport (not padded) has moved outside the loaded area
          // The loaded area already includes padding, so we check if viewport is outside it
          const viewportBoundsArray: Bounds = [viewportWest, viewportSouth, viewportEast, viewportNorth];
          if (isViewportOutsideLoadedArea(viewportBoundsArray, loaded)) {
            // Viewport has moved outside loaded area, load new features
            shouldLoad = true;
          }
        }
        
        // If we need to load, use padded bounds for the actual request
        if (shouldLoad) {
          const newBounds = calculatePaddedBounds();
          const now = Date.now();
          const timeSinceLastLoad = now - lastLoadTimeRef.current;
          
          // If enough time has passed since last load, load immediately
          if (timeSinceLastLoad >= THROTTLE_DELAY_MS) {
            lastLoadTimeRef.current = now;
            setMapBounds(newBounds);
          } else {
            // Otherwise, schedule a load after the throttle delay
            if (throttleTimeoutRef.current) {
              clearTimeout(throttleTimeoutRef.current);
            }
            throttleTimeoutRef.current = setTimeout(() => {
              lastLoadTimeRef.current = Date.now();
              setMapBounds(newBounds);
            }, THROTTLE_DELAY_MS - timeSinceLastLoad);
          }
        }
      };

      // Track zoom level changes - only update when crossing layer thresholds
      // Use debounce to avoid rapid updates during zoom animations
      map.on("zoomend", () => {
        // Clear any pending zoom update
        if (zoomDebounceTimeoutRef.current) {
          clearTimeout(zoomDebounceTimeoutRef.current);
        }
        
        // Debounce zoomend to batch rapid events
        zoomDebounceTimeoutRef.current = setTimeout(() => {
          const zoom = map.getZoom();
          const newLayer = getLayerForZoom(zoom);
          const previousLayer = previousLayerRef.current;
          
          // Only update activeLayer (which triggers effects) if layer changed
          if (newLayer !== previousLayer) {
            console.log(`Layer changed from ${previousLayer} to ${newLayer} at zoom ${zoom}`);
            previousLayerRef.current = newLayer;
            activeLayerRef.current = newLayer; // Update ref immediately
            setActiveLayer(newLayer); // This triggers the effect to reload data
            setCurrentLayer(newLayer);
            // Clear loaded bounds for the new layer to force reload
            setLoadedBounds((prev) => {
              const updated = { ...prev };
              delete updated[newLayer];
              return updated;
            });
            const newBounds = calculatePaddedBounds();
            setMapBounds(newBounds);
          } else {
            // Layer didn't change - check if viewport exceeds loaded area
            const currentViewportBounds = map.getBounds();
            const viewportBoundsArray: [number, number, number, number] = [
              currentViewportBounds.getWest(),
              currentViewportBounds.getSouth(),
              currentViewportBounds.getEast(),
              currentViewportBounds.getNorth(),
            ];
            
            // Check if viewport exceeds loaded bounds for current layer using ref
            const loaded = loadedBoundsRef.current[newLayer];
            if (!loaded) {
              // No data loaded for this layer yet, need to load
              console.log(`No data loaded for ${newLayer} after zoom, reloading...`);
              const newBounds = calculatePaddedBounds();
              setMapBounds(newBounds);
            } else {
              if (doesViewportExceedBounds(viewportBoundsArray, loaded)) {
                console.log(`Viewport exceeds loaded bounds for ${newLayer} after zoom, reloading...`);
                const newBounds = calculatePaddedBounds();
                setMapBounds(newBounds);
              } else {
                console.log(`Viewport still within loaded bounds for ${newLayer} after zoom, skipping reload`);
              }
            }
          }
          // Always update display zoom
          setCurrentZoom(zoom);
        }, ZOOM_DEBOUNCE_MS); // Debounce to avoid rapid updates
      });
      
      // Track zoom for immediate UI feedback and layer switching
      // Update activeLayer immediately when crossing thresholds to avoid delays
      map.on("zoom", () => {
        const zoom = map.getZoom();
        const newLayer = getLayerForZoom(zoom);
        const previousLayer = previousLayerRef.current;
        
        // If layer threshold crossed, update activeLayer immediately (not just on zoomend)
        // This ensures data loading switches layers during slow zooming
        if (newLayer !== previousLayer) {
          console.log(`Layer threshold crossed: ${previousLayer} → ${newLayer} at zoom ${zoom}`);
          previousLayerRef.current = newLayer;
          activeLayerRef.current = newLayer;
          setActiveLayer(newLayer); // This triggers data reload
          setCurrentLayer(newLayer);
          // Clear loaded bounds for the new layer to force reload
          setLoadedBounds((prev) => {
            const updated = { ...prev };
            delete updated[newLayer];
            loadedBoundsRef.current = updated; // Keep ref in sync
            return updated;
          });
          // Trigger bounds update to load new layer data
          const newBounds = calculatePaddedBounds();
          setMapBounds(newBounds);
        } else if (newLayer !== currentLayer) {
          // Layer didn't change but display layer is out of sync, just update display
          setCurrentLayer(newLayer);
        }
      });

      // Track map movement - load features as they pan into view
      map.on("move", () => {
        updateBoundsDuringPan();
      });

      // Also update on moveend (when user stops dragging/zooming)
      map.on("moveend", () => {
        // Clear any pending throttled updates
        if (throttleTimeoutRef.current) {
          clearTimeout(throttleTimeoutRef.current);
        }
        const zoom = map.getZoom();
        const newLayer = getLayerForZoom(zoom);
        setCurrentZoom(zoom);
        // Update layer tracking
        const previousLayer = previousLayerRef.current;
        previousLayerRef.current = newLayer;
        setCurrentLayer(newLayer);
        
        // Only update activeLayer if layer changed (to avoid unnecessary reloads)
        if (newLayer !== previousLayer) {
          activeLayerRef.current = newLayer; // Update ref immediately
          setActiveLayer(newLayer);
          // Clear loaded bounds for the new layer to force reload
          setLoadedBounds((prev) => {
            const updated = { ...prev };
            delete updated[newLayer];
            loadedBoundsRef.current = updated; // Keep ref in sync
            return updated;
          });
          const finalBounds = calculatePaddedBounds();
          setMapBounds(finalBounds);
        } else {
          // Layer didn't change - check if viewport exceeds loaded area
          const currentViewportBounds = map.getBounds();
          const viewportBoundsArray: [number, number, number, number] = [
            currentViewportBounds.getWest(),
            currentViewportBounds.getSouth(),
            currentViewportBounds.getEast(),
            currentViewportBounds.getNorth(),
          ];
          
          // Check if viewport exceeds loaded bounds for current layer using ref
          const loaded = loadedBoundsRef.current[newLayer];
          if (!loaded) {
            // No data loaded for this layer yet, need to load
            console.log(`No data loaded for ${newLayer} after move, reloading...`);
            const finalBounds = calculatePaddedBounds();
            setMapBounds(finalBounds);
          } else {
            if (doesViewportExceedBounds(viewportBoundsArray, loaded)) {
              console.log(`Viewport exceeds loaded bounds for ${newLayer} after move, reloading...`);
              const finalBounds = calculatePaddedBounds();
              setMapBounds(finalBounds);
            }
          }
        }
      });

      // Initial bounds and layer tracking
      const initialZoom = map.getZoom();
      const initialLayer = getLayerForZoom(initialZoom);
      previousLayerRef.current = initialLayer;
      activeLayerRef.current = initialLayer; // Update ref immediately
      setActiveLayer(initialLayer); // Set active layer to trigger initial data load
      setCurrentLayer(initialLayer);
      setCurrentZoom(initialZoom);
      const initialBounds = calculatePaddedBounds();
      setMapBounds(initialBounds);
      // Initialize ref
      loadedBoundsRef.current = {};

      setMapInitialized(true);
    });

    return () => {
      // Clear timeouts on unmount
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
      }
      if (zoomDebounceTimeoutRef.current) {
        clearTimeout(zoomDebounceTimeoutRef.current);
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapInitialized(false);
    };
  }, []); // Only run once on mount

  // Update displayed layer based on currentLayer (which only changes when layer threshold is crossed)
  // This effect watches geojsonByLayer and currentLayer, NOT currentZoom
  useEffect(() => {
    if (!mapRef.current || !mapInitialized) {
      return;
    }
    
    // Use currentLayer instead of calculating from currentZoom
    // currentLayer is only updated when the layer actually changes (county → vtd → block)
    const layerGeoJSON = geojsonByLayer[currentLayer];
    
    // Ensure the GeoJSON has the correct structure
    if (!layerGeoJSON || !layerGeoJSON.features || !Array.isArray(layerGeoJSON.features)) {
      return;
    }
    
    console.log(`Effect triggered: updating map with layer ${currentLayer}, ${layerGeoJSON.features.length} features`);

    const map = mapRef.current;
    let source = map.getSource("units") as maplibregl.GeoJSONSource;

    if (!source) {
      // Source doesn't exist yet, add it
      console.log("Adding source and layers to map");
      map.addSource("units", { 
        type: "geojson", 
        data: layerGeoJSON,
        promoteId: "id" // Use the 'id' property for feature identification
      });

      // Check if layers already exist before adding
      if (!map.getLayer("units-fill")) {
      map.addLayer({
        id: "units-fill",
        type: "fill",
        source: "units",
        paint: {
          "fill-color": ["case",
            ["has", "district"],
            ["get", "district_color"],
            "rgba(0,0,0,0)"
          ],
          "fill-opacity": 0.55
        },
      });
      }

      if (!map.getLayer("units-line")) {
      map.addLayer({
        id: "units-line",
        type: "line",
        source: "units",
        paint: { "line-width": 1, "line-color": "rgba(0,0,0,0.35)" },
      });
      }

      // Fit map to GeoJSON bounds (only on first load)
      // Check if this is the initial load by checking if we're at the initial zoom
      if (layerGeoJSON?.features?.length > 0 && map.getZoom() === DEFAULT_ZOOM) {
        let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
        layerGeoJSON.features.forEach((feature: any) => {
          if (feature.geometry?.coordinates) {
            const coords = feature.geometry.coordinates.flat(3);
            for (let i = 0; i < coords.length; i += 2) {
              const lon = coords[i];
              const lat = coords[i + 1];
              if (typeof lon === 'number' && typeof lat === 'number') {
                minLon = Math.min(minLon, lon);
                minLat = Math.min(minLat, lat);
                maxLon = Math.max(maxLon, lon);
                maxLat = Math.max(maxLat, lat);
              }
            }
          }
        });
        if (isFinite(minLon)) {
          map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 20 });
        }
      }
    } else {
      // Source exists, update the data with the appropriate layer
      console.log(`Updating map with ${layerGeoJSON.features.length} features for layer ${currentLayer}`);
      source.setData(layerGeoJSON);
    }
    
    // Always update geojson state to keep it in sync
    setGeojson(layerGeoJSON);
  }, [geojsonByLayer, mapInitialized, currentLayer]); // Removed currentZoom from deps - only update when layer or data changes

  // Set up map event handlers once
  useEffect(() => {
    if (!mapRef.current || !mapInitialized) return;

    const map = mapRef.current;

    // Remove existing listeners to avoid duplicates
    // Note: MapLibre's off() for layer events requires the listener function, so we'll just re-add them
    // The effect dependencies will handle cleanup

      // hover cursor
      map.on("mousemove", "units-fill", () => {
        map.getCanvas().style.cursor = paintMode ? "crosshair" : "pointer";
      });
      map.on("mouseleave", "units-fill", () => {
        map.getCanvas().style.cursor = "";
      });

      // paint on click
      map.on("click", "units-fill", (e) => {
        if (!paintMode) return;
        const f = e.features?.[0] as any;
      const id: FeatureId = String(f?.properties?.geo_id ?? f?.properties?.GEOID20 ?? f?.properties?.id ?? "");
        if (!id) return;

        setAssignments((prev) => ({ ...prev, [id]: activeDistrict }));
      });
  }, [paintMode, activeDistrict, mapInitialized]);

  // Update map source when assignments change (for manual painting only)
  // Uses feature IDs and hashes to only update changed features
  useEffect(() => {
    if (!geojson || !mapRef.current || !mapInitialized || updatingFromPlanRef.current) return;
    
    // Ensure geojson has features array
    if (!geojson.features || !Array.isArray(geojson.features)) {
      console.warn("GeoJSON missing features array:", geojson);
      return;
    }

    const src = mapRef.current.getSource("units") as maplibregl.GeoJSONSource;
    if (!src) return;

    // Build updated features with current assignments
    // MapLibre will use feature IDs to efficiently diff and update only changed features
    let changedCount = 0;
    const updatedFeatures = geojson.features.map((f: any) => {
      const featureId = String(f.id ?? f.properties?.geo_id ?? f.properties?.GEOID20 ?? "");
      const id = String(f.properties?.geo_id ?? f.properties?.GEOID20 ?? f.properties?.id ?? "");
      const d = assignments[id] ?? f.properties?.district ?? null;
      
      // Calculate new hash: geo_id:district
      const newHash = `${id}:${d ?? 0}`;
      const oldHash = featureHashesRef.current[featureId];
      
      // Track if this feature changed
      if (newHash !== oldHash) {
        changedCount++;
        featureHashesRef.current[featureId] = newHash;
      }
      
        return {
          ...f,
        id: featureId, // Ensure feature ID is set for MapLibre
          properties: {
            ...f.properties,
            district: d ?? null,
            district_color: d ? hashColor(d) : null,
          _hash: newHash,
        },
      };
    });

    // Update source - MapLibre will use feature IDs to efficiently update only changed features
    if (changedCount > 0) {
      console.log(`Updating ${changedCount} of ${geojson.features.length} features (hash-based diff)`);
    }
    
    src.setData({
      type: "FeatureCollection",
      features: updatedFeatures,
    });
  }, [assignments, geojson, mapInitialized]);

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
          onClick={() => setAssignments({})}
          style={{ width: "100%", marginBottom: 12 }}
        >
          Clear assignments
        </button>

        <h3 style={{ margin: "12px 0 6px 0" }}>Metrics (toy)</h3>
        <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 }}>
          {Object.keys(metrics).length === 0 && <div>(no assignments yet)</div>}
          {Object.entries(metrics)
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([d, c]) => (
              <div key={d}>
                D{d}: {c} units
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
        {(loadingPack || loadingLayer) && (
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

