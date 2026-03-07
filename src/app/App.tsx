import { useEffect, useRef, useState } from 'react';
import maplibregl, { Map } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useWasm } from '@/useWasm';
import { loadPackFromDirectory } from '@/loadPack';
import { loadAndCachePMTiles, setPMTilesBuffer } from '@/pmtilesCache';
import { SidePanel } from '@/app/components/SidePanel';
import { MapViewer } from '@/app/components/MapViewer';
import '@/App.css';
import 'maplibre-gl/dist/maplibre-gl.css';

// WKB to GeoJSON parser for MultiPolygon
function parseWkbMultiPolygon(wkb: Uint8Array): GeoJSON.MultiPolygon | null {
  if (wkb.length < 9) return null;

  const view = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
  let offset = 0;

  // Byte order (1 = little endian)
  const byteOrder = wkb[offset++];
  const isLittleEndian = byteOrder === 1;

  const readUint32 = () => {
    const val = isLittleEndian ? view.getUint32(offset, true) : view.getUint32(offset, false);
    offset += 4;
    return val;
  };

  const readFloat64 = () => {
    const val = isLittleEndian ? view.getFloat64(offset, true) : view.getFloat64(offset, false);
    offset += 8;
    return val;
  };

  // Geometry type (6 = MultiPolygon)
  const geomType = readUint32();
  if (geomType !== 6) return null;

  // Number of polygons
  const numPolygons = readUint32();
  const polygons: GeoJSON.Position[][][] = [];

  for (let p = 0; p < numPolygons; p++) {
    // Each polygon has its own header
    offset++; // byte order
    const polyType = readUint32();
    if (polyType !== 3) continue; // Not a polygon

    const numRings = readUint32();
    const rings: GeoJSON.Position[][] = [];

    for (let r = 0; r < numRings; r++) {
      const numPoints = readUint32();
      const ring: GeoJSON.Position[] = [];

      for (let i = 0; i < numPoints; i++) {
        const x = readFloat64();
        const y = readFloat64();
        ring.push([x, y]);
      }

      rings.push(ring);
    }

    polygons.push(rings);
  }

  return {
    type: 'MultiPolygon',
    coordinates: polygons
  };
}

export interface DistrictStat {
  district: number;
  color: string;
  population: number;
  deviation: number; // % deviation from ideal
  partisanLean: number | null; // (dem - rep) / (dem + rep), positive = more dem
}

const DISTRICT_COLORS = [
  'hsl(57 70% 50%)',
  'hsl(114 70% 50%)',
  'hsl(171 70% 50%)',
  'hsl(228 70% 50%)',
  'hsl(285 70% 50%)',
  'hsl(342 70% 50%)',
  'hsl(39 70% 50%)',
  'hsl(96 70% 50%)',
  'hsl(153 70% 50%)',
  'hsl(210 70% 50%)',
];

// PMTiles protocol handler - set up once
let pmtilesProtocolSetup = false;

function setupPmtilesProtocol() {
  if (pmtilesProtocolSetup) return;

  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);

  pmtilesProtocolSetup = true;
}

// Constants
const ZOOM_THRESHOLD_COUNTY_TO_VTD = 8;
const ZOOM_THRESHOLD_VTD_TO_BLOCK = 12;
const DEFAULT_ZOOM = 6;
const DEFAULT_NUM_DISTRICTS = 17; // Illinois congressional districts
const DEFAULT_LAYER = 'county';

interface StateConfig {
  packDir: string;
  pmtilesBounds: [number, number, number, number]; // [west, south, east, north]
  center: [number, number];
  zoom: number;
}

const STATE_CONFIGS: Record<string, StateConfig> = {
  illinois: {
    packDir: 'IL_2020_webpack',
    pmtilesBounds: [-91.5, 36.9, -87.0, 42.5],
    center: [-89.2, 40.0],
    zoom: 6,
  },
  iowa: {
    packDir: 'IA_2020_webpack',
    pmtilesBounds: [-96.7, 40.3, -90.1, 43.6],
    center: [-93.5, 42.0],
    zoom: 6.5,
  },
};

export default function App() {
  // Resize state
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const isResizing = useRef(false);

  // WASM and map state
  const { wasm, loading: wasmLoading, error: wasmError } = useWasm();
  const mapRef = useRef<Map | null>(null);
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  
  const [plan, setPlan] = useState<any>(null);
  const planRef = useRef<any>(null);
  const [mapData, setMapData] = useState<{ wasmMap?: any; wasmMapProxy?: any; packFiles?: Record<string, Uint8Array> } | null>(null);
  const wasmMapRef = useRef<any>(null);
  const [numDistricts, setNumDistricts] = useState(DEFAULT_NUM_DISTRICTS);
  const [loadedState, setLoadedState] = useState('illinois');
  const [mapInitialized, setMapInitialized] = useState(false);
  const [planUpdateTrigger, setPlanUpdateTrigger] = useState(0);
  
  // Loading states
  const [loadingPack, setLoadingPack] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>('');
  const [pmtilesBufferReady, setPmtilesBufferReady] = useState(false);
  
  // Level-of-detail: track current layer
  const [currentZoom, setCurrentZoom] = useState<number>(DEFAULT_ZOOM);
  const [activeLayer, setActiveLayer] = useState<string>(DEFAULT_LAYER);
  const [currentLayer, setCurrentLayer] = useState<string>(DEFAULT_LAYER);
  const previousLayerRef = useRef<string>(DEFAULT_LAYER);
  const featureHashesRef = useRef<Record<string, string>>({});
  const activeLayerRef = useRef<string>(DEFAULT_LAYER);
  const loadedSourcesRef = useRef<Set<string>>(new Set());
  const [sourcesVersion, setSourcesVersion] = useState(0);

  // Assignments and painting
  const assignmentsRef = useRef<Record<string, number>>({});
  const [activeDistrict, setActiveDistrict] = useState<number>(1);
  const [paintMode, setPaintMode] = useState(false);
  const [districtCounts, setDistrictCounts] = useState<Record<number, number>>({});
  
  // Visualization mode
  const [visualizationMode, setVisualizationMode] = useState<'districts' | 'partisan'>('districts');
  const visualizationModeRef = useRef<'districts' | 'partisan'>('districts');
  const partisanLeanRef = useRef<Record<string, number>>({});
  const geoIdByIndexRef = useRef<Record<string, Record<number, string>>>({});
  const districtLayersAddedRef = useRef<boolean>(false);

  // Cached district geometries and stats
  const [districtGeoJson, setDistrictGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [_computingDistricts, setComputingDistricts] = useState(false);
  const computingDistrictsRef = useRef(false);
  const pendingComputeRef = useRef(false);
  const [districtStats, setDistrictStats] = useState<DistrictStat[] | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<'summary' | 'districts' | 'automation' | 'debug'>('summary');

  // Resize handlers
  const handleMouseDown = () => {
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing.current) return;
    const newWidth = e.clientX;
    if (newWidth >= 300 && newWidth <= 600) {
      setSidebarWidth(newWidth);
    }
  };

  const handleMouseUp = () => {
    isResizing.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  // Add event listeners for resize
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Determine which layer to show based on zoom level
  const getLayerForZoom = (zoom: number): string => {
    if (zoom < ZOOM_THRESHOLD_COUNTY_TO_VTD) return 'county';
    if (zoom < ZOOM_THRESHOLD_VTD_TO_BLOCK) return 'vtd';
    return 'block';
  };

  // Load pack data for the current state
  useEffect(() => {
    if (!wasm) return;

    const config = STATE_CONFIGS[loadedState];
    if (!config) return;

    const controller = new AbortController();
    const { signal } = controller;

    const loadPack = async () => {
      // Free old WASM objects before loading new state, to release WASM heap memory
      // immediately rather than waiting for JS garbage collection.
      if (planRef.current) {
        planRef.current.free?.();
        planRef.current = null;
        setPlan(null);
      }
      if (wasmMapRef.current) {
        wasmMapRef.current.free?.();
        wasmMapRef.current = null;
      }

      setPmtilesBufferReady(false);
      setMapData(null);
      setLoadingPack(true);
      setLoadingStatus('Loading pack files...');
      try {
        const packPath = `/packs/${config.packDir}`;
        const packFiles = await loadPackFromDirectory(packPath, (current, total, fileName) => {
          if (fileName) {
            setLoadingStatus(`Loading pack files... (${current}/${total}) - ${fileName}`);
          } else {
            setLoadingStatus(`Loading pack files... (${current}/${total})`);
          }
        }, signal);

        if (signal.aborted) return;

        setLoadingStatus('Downloading geometry tiles...');
        const pmtilesBuffer = await loadAndCachePMTiles(
          `${packPath}/geom/geometries.pmtiles`,
          (loaded, total) => {
            const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
            setLoadingStatus(`Downloading geometry tiles... ${percent}%`);
          },
          signal,
        );

        if (signal.aborted) return;

        setPMTilesBuffer(pmtilesBuffer);
        setPmtilesBufferReady(true);

        setLoadingStatus('Initializing map...');
        await new Promise(resolve => {
          requestAnimationFrame(() => { requestAnimationFrame(resolve); });
        });

        if (signal.aborted) return;

        const { WasmMap } = wasm as any;
        const wasmMap = new WasmMap(packFiles);
        wasmMapRef.current = wasmMap;
        setMapData({ wasmMap, packFiles });
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error(`Failed to load ${loadedState} pack:`, err);
        setLoadingStatus('Error loading pack');
      } finally {
        if (!signal.aborted) {
          setLoadingPack(false);
          setLoadingStatus('');
        }
      }
    };

    loadPack();
    return () => controller.abort();
  }, [wasm, loadedState]);
  
  // Load partisan lean data from CSV files
  useEffect(() => {
    if (!mapData?.packFiles) return;
    
    const loadPartisanData = async () => {
      const packFiles = mapData.packFiles;
      if (!packFiles) return;
      
      try {
        const allLayers = ['state', 'county', 'tract', 'group', 'vtd', 'block'];
        const leanData: Record<string, number> = {};
        const indexMaps: Record<string, Record<number, string>> = {};
        
        for (const layerName of allLayers) {
          const csvFile = packFiles[`data/${layerName}.csv`];
          if (!csvFile) {
            console.warn(`${layerName} CSV file not found`);
            continue;
          }
          
          const csvText = new TextDecoder().decode(csvFile);
          const lines = csvText.split('\n');
          const headers = lines[0].split(',');
          
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
            
            indexToGeoId[idx] = geoId;
            
            if (demIdx !== -1 && repIdx !== -1) {
              const dem = parseFloat(cols[demIdx]) || 0;
              const rep = parseFloat(cols[repIdx]) || 0;
              const total = dem + rep;
              
              if (total > 0) {
                leanData[geoId] = (dem - rep) / total;
              }
            }
          }
          
          indexMaps[layerName] = indexToGeoId;
        }
        
        partisanLeanRef.current = leanData;
        geoIdByIndexRef.current = indexMaps;
      } catch (err) {
        console.error('Failed to load partisan data:', err);
      }
    };
    
    loadPartisanData();
  }, [mapData]);

  // Compute district geometries when explicitly requested (not automatically)
  const computeDistrictGeometries = async () => {
    if (!plan) return;

    // Use a ref for the guard so rapid clicks see the up-to-date value
    // rather than stale React state.
    if (computingDistrictsRef.current) {
      pendingComputeRef.current = true;
      return;
    }

    computingDistrictsRef.current = true;
    setComputingDistricts(true);

    try {
      const geometries = plan.district_geometries_wkb();
      const features: GeoJSON.Feature[] = [];

      for (const { district, wkb } of geometries) {
        const multiPolygon = parseWkbMultiPolygon(wkb);
        if (multiPolygon && multiPolygon.coordinates.length > 0) {
          features.push({
            type: 'Feature',
            properties: {
              district: district,
              color: DISTRICT_COLORS[(district - 1) % DISTRICT_COLORS.length]
            },
            geometry: multiPolygon
          });
        }
      }

      setDistrictGeoJson({ type: 'FeatureCollection', features });
    } catch (err) {
      console.error('Failed to compute district geometries:', err);
      setDistrictGeoJson(null);
    } finally {
      computingDistrictsRef.current = false;
      const hasPending = pendingComputeRef.current;
      pendingComputeRef.current = false;

      if (hasPending) {
        // Another randomize ran while we were computing — recompute with latest plan
        computeDistrictGeometries();
      } else {
        setComputingDistricts(false);
        setLoadingStatus('');
      }
    }
  };


  // Compute per-district stats when plan changes
  useEffect(() => {
    if (!plan) {
      setDistrictStats(null);
      return;
    }
    try {
      const available: string[] = plan.series();
      const populations: number[] = available.includes('T_20_CENS_Total')
        ? Array.from(plan.district_totals('T_20_CENS_Total'))
        : [];

      const total = populations.reduce((a, b) => a + b, 0);
      const ideal = populations.length > 0 ? total / populations.length : 0;

      const demVotes: number[] | null = available.includes('E_20_PRES_Dem')
        ? Array.from(plan.district_totals('E_20_PRES_Dem'))
        : null;
      const repVotes: number[] | null = available.includes('E_20_PRES_Rep')
        ? Array.from(plan.district_totals('E_20_PRES_Rep'))
        : null;

      setDistrictStats(populations.map((pop, i) => {
        const dem = demVotes?.[i] ?? 0;
        const rep = repVotes?.[i] ?? 0;
        const twoParty = dem + rep;
        return {
          district: i + 1,
          color: DISTRICT_COLORS[i % DISTRICT_COLORS.length],
          population: pop,
          deviation: ideal > 0 ? ((pop - ideal) / ideal) * 100 : 0,
          partisanLean: twoParty > 0 ? (dem - rep) / twoParty : null,
        };
      }));
    } catch (err) {
      console.error('Failed to compute district stats:', err);
      setDistrictStats(null);
    }
  }, [planUpdateTrigger, plan]);

  // Handle visualization mode changes
  useEffect(() => {
    visualizationModeRef.current = visualizationMode;

    if (!mapRef.current || !mapInitialized || sourcesVersion === 0) {
      return;
    }

    const map = mapRef.current;
    const sourceId = 'units-all';
    const allLayers = ['state', 'county', 'tract', 'group', 'vtd', 'block'];
    const districtSourceId = 'district-boundaries';

    // Helper to remove district overlay layers
    const removeDistrictOverlay = () => {
      if (map.getLayer('district-boundaries-fill')) {
        map.removeLayer('district-boundaries-fill');
      }
      if (map.getLayer('district-boundaries-line')) {
        map.removeLayer('district-boundaries-line');
      }
      if (map.getSource(districtSourceId)) {
        map.removeSource(districtSourceId);
      }
      districtLayersAddedRef.current = false;
    };

    if (visualizationMode === 'districts') {
      // Districts mode: show district WKB geometries as overlay
      // First set base layers to light transparent
      for (const layerName of allLayers) {
        const fillLayerId = `units-${layerName}-fill`;
        const lineLayerId = `units-${layerName}-line`;
        if (map.getLayer(fillLayerId)) {
          map.setPaintProperty(fillLayerId, 'fill-color', 'rgba(200, 200, 200, 0.2)');
        }
        if (map.getLayer(lineLayerId)) {
          const lineOpacity = layerName === activeLayerRef.current ? 0.5 : 0;
          map.setPaintProperty(lineLayerId, 'line-opacity', lineOpacity);
        }
      }

      // Add district overlay using cached geometries
      if (districtGeoJson && districtGeoJson.features.length > 0) {
        removeDistrictOverlay();

        // Add new source and layers
        map.addSource(districtSourceId, {
          type: 'geojson',
          data: districtGeoJson
        });

        map.addLayer({
          id: 'district-boundaries-fill',
          type: 'fill',
          source: districtSourceId,
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': 0.3
          }
        });

        map.addLayer({
          id: 'district-boundaries-line',
          type: 'line',
          source: districtSourceId,
          paint: {
            'line-color': '#333333',
            'line-width': 1.5,
            'line-opacity': 1.0
          }
        });

        districtLayersAddedRef.current = true;
      } else {
        removeDistrictOverlay();
      }
    } else if (visualizationMode === 'partisan') {
      // Partisan mode: remove district overlay and show partisan lean colors
      removeDistrictOverlay();

      const partisanPaint: any = [
        'case',
        ['!=', ['feature-state', 'partisanLean'], null],
        [
          'interpolate',
          ['linear'],
          ['feature-state', 'partisanLean'],
          -1, '#ff0000',
          -0.5, '#ff8080',
          0, '#e8e8e8',
          0.5, '#8080ff',
          1, '#0000ff'
        ],
        '#e8e8e8'
      ];

      for (const layerName of allLayers) {
        const fillLayerId = `units-${layerName}-fill`;
        const lineLayerId = `units-${layerName}-line`;
        if (map.getLayer(fillLayerId)) {
          map.setPaintProperty(fillLayerId, 'fill-color', partisanPaint);
        }
        if (map.getLayer(lineLayerId)) {
          map.setPaintProperty(lineLayerId, 'line-opacity', 0);
        }
      }

      const updatePartisanStates = () => {
        for (const layerName of allLayers) {
          const fillLayerId = `units-${layerName}-fill`;
          if (!map.getLayer(fillLayerId)) continue;

          const features = map.queryRenderedFeatures({ layers: [fillLayerId] });
          const indexMap = geoIdByIndexRef.current[layerName];
          if (!indexMap) continue;

          for (const feature of features) {
            const featureId = feature.id;
            const index = feature.properties?.index;
            if (!index) continue;

            const geoId = indexMap[parseInt(index)];
            if (!geoId) continue;

            const lean = partisanLeanRef.current[String(geoId)];
            if (lean !== undefined) {
              map.setFeatureState(
                { source: sourceId, sourceLayer: layerName, id: featureId },
                { partisanLean: lean }
              );
            }
          }
        }
      };

      updatePartisanStates();

      const handleSourceData = (e: any) => {
        if (e.sourceId === sourceId && e.isSourceLoaded) {
          updatePartisanStates();
        }
      };

      map.on('moveend', updatePartisanStates);
      map.on('sourcedata', handleSourceData);

      return () => {
        map.off('moveend', updatePartisanStates);
        map.off('sourcedata', handleSourceData);
      };
    }
  }, [visualizationMode, mapInitialized, districtGeoJson, sourcesVersion]);

  // Create plan from WASM when mapData and numDistricts are available
  useEffect(() => {
    if (!wasm || !mapData?.wasmMap || !numDistricts) return;

    try {
      // Free old plan before creating a new one (numDistricts change)
      if (planRef.current) {
        planRef.current.free?.();
        planRef.current = null;
      }
      const { WasmPlan } = wasm as any;
      const newPlan = new WasmPlan(mapData.wasmMap, numDistricts);
      planRef.current = newPlan;
      setPlan(newPlan);
      setDistrictGeoJson(null);
      setPlanUpdateTrigger((prev) => prev + 1);
    } catch (err) {
      console.error('Failed to create plan:', err);
    }
  }, [wasm, mapData, numDistricts]);

  // Update assignments ref when plan changes
  useEffect(() => {
    if (!plan || activeLayer !== 'block') return;

    try {
      const assignmentsObj = plan.assignments_dict();
      if (assignmentsObj && typeof assignmentsObj === 'object') {
        const assignmentsDict = assignmentsObj as Record<string, number>;
        assignmentsRef.current = assignmentsDict;
        
        const counts: Record<number, number> = {};
        for (const district of Object.values(assignmentsDict)) {
          counts[district] = (counts[district] ?? 0) + 1;
        }
        setDistrictCounts(counts);
      }
    } catch (err) {
      console.error('Failed to get assignments from plan:', err);
    }
  }, [planUpdateTrigger, plan, activeLayer]);

  const handleRandomize = () => {
    if (!plan) return;
    setLoadingStatus('Creating plan...');
    setDistrictGeoJson(null);
    setTimeout(() => {
      try {
        plan.randomize();
        setPlanUpdateTrigger((prev) => prev + 1);
        computeDistrictGeometries();
      } catch (err) {
        console.error('Failed to randomize plan:', err);
        setLoadingStatus('');
      }
    }, 0);
  };

  const handleOptimize = () => {
    if (!plan) return;
    setLoadingStatus('Creating plan...');
    setDistrictGeoJson(null);
    setTimeout(() => {
      try {
        plan.tabu_balance('TOTPOP', 100, 10, 0.5, 50);
        setPlanUpdateTrigger((prev) => prev + 1);
        computeDistrictGeometries();
      } catch (err) {
        console.error('Failed to optimize plan:', err);
        setLoadingStatus('');
      }
    }, 0);
  };

  const handleLoadMap = (state: string, districts: number) => {
    if (state === loadedState && districts === numDistricts) return;
    assignmentsRef.current = {};
    setDistrictCounts({});
    setDistrictGeoJson(null);
    if (state !== loadedState) {
      // Reset pmtilesBufferReady in the same render as loadedState so the map
      // source effect sees pmtilesBufferReady=false immediately and doesn't try
      // to load the new state's tiles with the old state's cached buffer.
      setPmtilesBufferReady(false);
    }
    setLoadedState(state);
    setNumDistricts(districts);
  };

  const handleClearAssignments = () => {
    assignmentsRef.current = {};
    setDistrictCounts({});
    if (mapRef.current && currentLayer === 'block') {
      const sourceId = 'units-all';
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
  };

  // Initialize map only once
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;

    // Set up PMTiles protocol handler FIRST, before creating the map
    setupPmtilesProtocol();

    const map = new maplibregl.Map({
      container: mapDivRef.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: STATE_CONFIGS['illinois'].center,
      zoom: STATE_CONFIGS['illinois'].zoom,
      minZoom: 4.0,
      antialias: true,
      fadeDuration: 0,
      pixelRatio: window.devicePixelRatio || 1,
    } as any);
    mapRef.current = map;

    map.on('load', () => {
      // Use 'zoom' event (fires during zoom) instead of 'zoomend' (fires after)
      // This makes layer transitions instant when crossing thresholds
      map.on('zoom', () => {
        const zoom = map.getZoom();
        const newLayer = getLayerForZoom(zoom);
        const previousLayer = previousLayerRef.current;

        if (newLayer !== previousLayer) {
          previousLayerRef.current = newLayer;
          activeLayerRef.current = newLayer;

          const allLayers = ['state', 'county', 'tract', 'group', 'vtd', 'block'];

          for (const layerName of allLayers) {
            const fillLayerId = `units-${layerName}-fill`;
            const lineLayerId = `units-${layerName}-line`;
            const isActive = layerName === newLayer;

            if (map.getLayer(fillLayerId)) {
              map.setPaintProperty(fillLayerId, 'fill-opacity', isActive ? 0.7 : 0);
            }
            if (map.getLayer(lineLayerId)) {
              const lineOpacity = !isActive || visualizationModeRef.current === 'partisan' ? 0 : 0.5;
              map.setPaintProperty(lineLayerId, 'line-opacity', lineOpacity);
            }
          }

          setActiveLayer(newLayer);
          setCurrentLayer(newLayer);
        }
        setCurrentZoom(zoom);
      });

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
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapInitialized(false);
    };
  }, []);

  // Set up PMTiles vector tile source
  useEffect(() => {
    if (!mapRef.current || !mapInitialized || !pmtilesBufferReady) return;

    const config = STATE_CONFIGS[loadedState];
    if (!config) return;

    const map = mapRef.current;
    const sourceId = 'units-all';
    const allLayerNames = ['state', 'county', 'tract', 'group', 'vtd', 'block'];

    // Remove existing layers and source before re-adding for new state
    for (const layerName of allLayerNames) {
      if (map.getLayer(`units-${layerName}-fill`)) map.removeLayer(`units-${layerName}-fill`);
      if (map.getLayer(`units-${layerName}-line`)) map.removeLayer(`units-${layerName}-line`);
    }
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    loadedSourcesRef.current.delete('all');

    {
      const pmtilesUrl = `pmtiles:///packs/${config.packDir}/geom/geometries.pmtiles`;
      setLoadingStatus(`Loading geometry layers...`);

      try {
        map.addSource(sourceId, {
          type: 'vector',
          url: pmtilesUrl,
          scheme: 'xyz',
          bounds: config.pmtilesBounds,
        } as any);

        const fillPaint: any = {
          'fill-color': [
            'case',
            ['!=', ['feature-state', 'partisanLean'], null],
            [
              'interpolate',
              ['linear'],
              ['feature-state', 'partisanLean'],
              -1, '#ff0000',
              -0.5, '#ff8080',
              0, '#e8e8e8',
              0.5, '#8080ff',
              1, '#0000ff'
            ],
            [
              'match',
              ['feature-state', 'district'],
              1, 'hsl(57 70% 50%)',
              2, 'hsl(114 70% 50%)',
              3, 'hsl(171 70% 50%)',
              4, 'hsl(228 70% 50%)',
              5, 'hsl(285 70% 50%)',
              6, 'hsl(342 70% 50%)',
              7, 'hsl(39 70% 50%)',
              8, 'hsl(96 70% 50%)',
              9, 'hsl(153 70% 50%)',
              10, 'hsl(210 70% 50%)',
              'rgba(0,0,0,0)'
            ]
          ],
          'fill-opacity': 0,
          'fill-opacity-transition': { duration: 0 },
          'fill-antialias': true,
        };

        const linePaint: any = {
          'line-width': 1.5,
          'line-color': 'rgba(0,0,0,0.3)',
          'line-opacity': 0,
          'line-opacity-transition': { duration: 0 },
          'line-gap-width': 0,
          'line-blur': 0.5
        };

        const lineLayout: any = {
          'line-cap': 'round',
          'line-join': 'round'
        };

        // Determine initial active layer
        const initialLayer = getLayerForZoom(map.getZoom());

        const allLayers = ['state', 'county', 'tract', 'group', 'vtd', 'block'];
        for (const layerName of allLayers) {
          const fillLayerId = `units-${layerName}-fill`;
          const lineLayerId = `units-${layerName}-line`;
          const isActive = layerName === initialLayer;

          map.addLayer({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            'source-layer': layerName,
            paint: {
              ...fillPaint,
              'fill-opacity': isActive ? 0.7 : 0,
            },
          });

          map.addLayer({
            id: lineLayerId,
            type: 'line',
            source: sourceId,
            'source-layer': layerName,
            paint: {
              ...linePaint,
              'line-opacity': isActive ? 1 : 0,
            },
            layout: lineLayout,
          });
        }

        loadedSourcesRef.current.add('all');
        setSourcesVersion(v => v + 1);

        const source = map.getSource(sourceId) as any;

        source.on('error', () => {
          setLoadingStatus(`Error loading geometry layers`);
        });

        source.on('data', (e: any) => {
          if (e.dataType === 'source' && e.isSourceLoaded) {
            setLoadingStatus('');
          }
        });
        map.jumpTo({ center: config.center, zoom: config.zoom });
      } catch (err) {
        console.error('Failed to add PMTiles source:', err);
        setLoadingStatus(`Error: Failed to load geometry layers`);
      }
    }
  }, [mapInitialized, pmtilesBufferReady, loadedState]);


  // Set up map event handlers for paint mode
  useEffect(() => {
    if (!mapRef.current || !mapInitialized) return;

    const map = mapRef.current;
    const fillLayerId = `units-${currentLayer}-fill`;

    if (!map.getLayer(fillLayerId)) return;

    const handleMouseMove = () => {
      map.getCanvas().style.cursor = paintMode ? 'crosshair' : 'pointer';
    };
    
    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = '';
    };

    const handleClick = (e: any) => {
      if (!paintMode) return;
      const f = e.features?.[0] as any;
      const id: string = String(f?.properties?.geo_id ?? '');
      if (!id) return;

      const prevDistrict = assignmentsRef.current[id];
      assignmentsRef.current[id] = activeDistrict;
      
      setDistrictCounts((c) => {
        const next = { ...c };
        if (prevDistrict != null) {
          next[prevDistrict] = (next[prevDistrict] ?? 1) - 1;
        }
        next[activeDistrict] = (next[activeDistrict] ?? 0) + 1;
        return next;
      });
      
      const sourceId = 'units-all';
      map.setFeatureState(
        {
          source: sourceId,
          sourceLayer: currentLayer,
          id: id
        },
        {
          district: activeDistrict
        }
      );
      
      featureHashesRef.current[id] = `${id}:${activeDistrict}`;
    };

    map.on('mousemove', fillLayerId, handleMouseMove);
    map.on('mouseleave', fillLayerId, handleMouseLeave);
    map.on('click', fillLayerId, handleClick);

    return () => {
      map.off('mousemove', fillLayerId, handleMouseMove);
      map.off('mouseleave', fillLayerId, handleMouseLeave);
      map.off('click', fillLayerId, handleClick);
    };
  }, [paintMode, activeDistrict, mapInitialized, currentLayer]);

  return (
    <div className="h-screen w-screen flex overflow-hidden">
      {/* Side Panel */}
      <div className="flex-shrink-0" style={{ width: `${sidebarWidth}px` }}>
        <SidePanel
          activeTab={activeTab}
          onTabChange={setActiveTab}
          numDistricts={numDistricts}
          onNumDistrictsChange={setNumDistricts}
          loadedState={loadedState}
          onLoadMap={handleLoadMap}
          activeDistrict={activeDistrict}
          onActiveDistrictChange={setActiveDistrict}
          paintMode={paintMode}
          onPaintModeChange={setPaintMode}
          visualizationMode={visualizationMode}
          onVisualizationModeChange={(mode) => setVisualizationMode(mode as 'districts' | 'partisan')}
          districtCounts={districtCounts}
          onRandomize={handleRandomize}
          onOptimize={handleOptimize}
          onRefreshDistricts={computeDistrictGeometries}
          onClearAssignments={handleClearAssignments}
          districtStats={districtStats}
          wasmLoading={wasmLoading}
          wasmError={wasmError}
          currentZoom={currentZoom}
          currentLayer={currentLayer}
          loadingStatus={loadingStatus}
        />
      </div>
      
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        className="w-1 bg-border hover:bg-primary cursor-col-resize flex-shrink-0 transition-colors"
      />
      
      {/* Map */}
      <div className="flex-1">
        <MapViewer
          mapRef={mapRef}
          mapDivRef={mapDivRef}
          onMapInitialized={() => setMapInitialized(true)}
          loadingPack={loadingPack}
          loadingStatus={loadingStatus}
          activeLayer={activeLayer}
        />
      </div>
    </div>
  );
}
