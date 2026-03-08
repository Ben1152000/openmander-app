import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { Map } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useWasm } from '@/useWasm';
import { loadPackFromDirectory } from '@/loadPack';
import { loadAndCachePMTiles, setPMTilesBuffer } from '@/pmtilesCache';
import { SidePanel } from '@/app/components/SidePanel';
import { MapViewer } from '@/app/components/MapViewer';
import { MapToolbar, type DrawingTool } from '@/app/components/MapToolbar';
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
  demVotes: number;
  repVotes: number;
  whitePct: number;
  blackPct: number;
  hispanicPct: number;
  asianPct: number;
  nativePct: number;
  pacificPct: number;
}

const ETHNICITY_METRICS = ['white_pct', 'black_pct', 'hispanic_pct', 'asian_pct', 'native_pct', 'pacific_pct'] as const;
type EthnicityMetric = typeof ETHNICITY_METRICS[number];

const ETHNICITY_COLS: Record<EthnicityMetric, string> = {
  white_pct:    'T_20_CENS_White',
  black_pct:    'T_20_CENS_Black',
  hispanic_pct: 'T_20_CENS_Hispanic',
  asian_pct:    'T_20_CENS_Asian',
  native_pct:   'T_20_CENS_Native',
  pacific_pct:  'T_20_CENS_Pacific',
};

// [lightColor, darkColor, zeroGroupColor, zeroPopColor]
// lightColor → darkColor: concentration ramp (low → high)
// zeroGroupColor: unit has population but 0 of this group
// zeroPopColor: unit has no population at all
const ETHNICITY_COLOR_RANGE: Record<EthnicityMetric, [string, string, string, string]> = {
  white_pct:    ['#f0f7ff', '#003d99', '#ffffff', '#d8d8d8'],
  black_pct:    ['#f8f5ff', '#3d008f', '#ffffff', '#d8d8d8'],
  hispanic_pct: ['#fff8f0', '#e05000', '#ffffff', '#d8d8d8'],
  asian_pct:    ['#f2fbf7', '#006b40', '#ffffff', '#d8d8d8'],
  native_pct:   ['#fefef2', '#c49a00', '#ffffff', '#d8d8d8'],
  pacific_pct:  ['#fef3f0', '#b03020', '#ffffff', '#d8d8d8'],
};

const ETHNICITY_STAT_KEYS: Record<EthnicityMetric, keyof DistrictStat> = {
  white_pct:    'whitePct',
  black_pct:    'blackPct',
  hispanic_pct: 'hispanicPct',
  asian_pct:    'asianPct',
  native_pct:   'nativePct',
  pacific_pct:  'pacificPct',
};

function lerpColor(t: number, light: string, dark: string): string {
  const lr = parseInt(light.slice(1, 3), 16), lg = parseInt(light.slice(3, 5), 16), lb = parseInt(light.slice(5, 7), 16);
  const dr = parseInt(dark.slice(1, 3), 16),  dg = parseInt(dark.slice(3, 5), 16),  db = parseInt(dark.slice(5, 7), 16);
  const r = Math.round(lr + (dr - lr) * t).toString(16).padStart(2, '0');
  const g = Math.round(lg + (dg - lg) * t).toString(16).padStart(2, '0');
  const b = Math.round(lb + (db - lb) * t).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

const PARTISAN_STEPS: [number, string][] = [
  [-1.00, '#ff4040'], [-0.50, '#fa9595'], [-0.30, '#f4b4b4'], [-0.20, '#f0c4c4'],
  [-0.15, '#eecccc'], [-0.12, '#edd2d2'], [-0.09, '#ebd8d8'], [-0.06, '#eadede'],
  [-0.04, '#e9e2e2'], [-0.02, '#e8e6e6'], [ 0.00, '#e6e6e8'], [ 0.02, '#e2e2e9'],
  [ 0.04, '#dedeea'], [ 0.06, '#d8d8eb'], [ 0.09, '#d2d2ed'], [ 0.12, '#ccccee'],
  [ 0.15, '#c4c4f0'], [ 0.20, '#b4b4f4'], [ 0.30, '#9595fa'], [ 0.50, '#4040ff'],
];
function partisanStepColor(lean: number): string {
  for (let i = PARTISAN_STEPS.length - 1; i >= 0; i--) {
    if (lean >= PARTISAN_STEPS[i][0]) return PARTISAN_STEPS[i][1];
  }
  return '#ff4040';
}

const GOLDEN_ANGLE = 137.50776405;
function districtColor(index: number): string {
  const hue = (index * GOLDEN_ANGLE) % 360;
  return `hsl(${hue.toFixed(1)} 65% 52%)`;
}

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
  const [drawingTool, setDrawingTool] = useState<DrawingTool>('pan');
  const paintMode = drawingTool === 'paint';
  const [districtCounts, setDistrictCounts] = useState<Record<number, number>>({});
  
  // Visualization mode
  const [visualizationMode, setVisualizationMode] = useState<'districts' | 'partisan'>('districts');
  const visualizationModeRef = useRef<'districts' | 'partisan'>('districts');
  const partisanLeanRef = useRef<Record<string, number>>({});
  const ethnicityDataRef = useRef<Partial<Record<EthnicityMetric, Record<string, number>>>>({});
  const geoIdByIndexRef = useRef<Record<string, Record<number, string>>>({});
  const districtLayersAddedRef = useRef<boolean>(false);
  const districtGeoJsonLoadedRef = useRef<GeoJSON.FeatureCollection | null>(null);

  // Cached district geometries and stats
  const [districtGeoJson, setDistrictGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [_computingDistricts, setComputingDistricts] = useState(false);
  const computingDistrictsRef = useRef(false);
  const pendingComputeRef = useRef(false);
  const [districtStats, setDistrictStats] = useState<DistrictStat[] | null>(null);

  // District table color metric (also controls district overlay color on map)
  const [districtColorMetric, setDistrictColorMetric] = useState<'default' | 'partisan' | 'dem_pct' | 'rep_pct' | 'dem_votes' | 'rep_votes' | 'white_pct' | 'black_pct' | 'hispanic_pct' | 'asian_pct' | 'native_pct' | 'pacific_pct'>('default');

  // Swatch colors for the districts table — matches district view colors
  const districtSwatchColors = useMemo((): Record<number, string> => {
    if (!districtStats) return {};
    const result: Record<number, string> = {};
    for (const d of districtStats) {
      if (ETHNICITY_METRICS.includes(districtColorMetric as EthnicityMetric)) {
        const metric = districtColorMetric as EthnicityMetric;
        const [lightColor, darkColor, zeroGroupColor] = ETHNICITY_COLOR_RANGE[metric];
        const pct = (d[ETHNICITY_STAT_KEYS[metric]] as number) / 100;
        result[d.district] = pct === 0 ? zeroGroupColor : lerpColor(pct, lightColor, darkColor);
      } else if (districtColorMetric === 'partisan') {
        const total = d.demVotes + d.repVotes;
        const lean = total > 0 ? (d.demVotes - d.repVotes) / total : 0;
        result[d.district] = partisanStepColor(lean);
      } else {
        result[d.district] = d.color;
      }
    }
    return result;
  }, [districtStats, districtColorMetric]);

  // Tab state
  const [activeTab, setActiveTab] = useState<'summary' | 'districts' | 'automation' | 'analysis' | 'debug'>('summary');

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
          const censTotalIdx = headers.indexOf('T_20_CENS_Total');
          const ethnicColIdxs = Object.fromEntries(
            ETHNICITY_METRICS.map(m => [m, headers.indexOf(ETHNICITY_COLS[m])])
          ) as Record<EthnicityMetric, number>;

          if (idxIdx === -1 || geoIdIdx === -1) {
            console.warn(`Required columns not found in ${layerName} CSV`);
            continue;
          }

          const ethnicLayerData: Partial<Record<EthnicityMetric, Record<string, number>>> = {};
          for (const m of ETHNICITY_METRICS) {
            if (ethnicColIdxs[m] !== -1 && censTotalIdx !== -1) {
              ethnicLayerData[m] = {};
            }
          }

          const indexToGeoId: Record<number, string> = {};

          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const cols = line.split(',');
            const idx = parseInt(cols[idxIdx]);
            const geoId = cols[geoIdIdx];

            indexToGeoId[idx] = geoId;

            const censTotal = censTotalIdx !== -1 ? (parseFloat(cols[censTotalIdx]) || 0) : -1;
            if (censTotal === 0) {
              leanData[geoId] = -2; // sentinel: zero population
            } else if (demIdx !== -1 && repIdx !== -1) {
              const dem = parseFloat(cols[demIdx]) || 0;
              const rep = parseFloat(cols[repIdx]) || 0;
              const total = dem + rep;
              if (total > 0) leanData[geoId] = (dem - rep) / total;
            }

            if (censTotalIdx !== -1) {
              const censTotal = parseFloat(cols[censTotalIdx]) || 0;
              for (const m of ETHNICITY_METRICS) {
                const colIdx = ethnicColIdxs[m];
                if (colIdx !== -1 && ethnicLayerData[m]) {
                  ethnicLayerData[m]![geoId] = censTotal > 0
                    ? (parseFloat(cols[colIdx]) || 0) / censTotal
                    : -1; // sentinel: zero population
                }
              }
            }
          }

          for (const m of ETHNICITY_METRICS) {
            if (ethnicLayerData[m]) {
              if (!ethnicityDataRef.current[m]) ethnicityDataRef.current[m] = {};
              Object.assign(ethnicityDataRef.current[m]!, ethnicLayerData[m]);
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

      // Pre-compute partisan lean per district for the overlay
      const available: string[] = plan.series();
      const demTotals: number[] | null = available.includes('E_20_PRES_Dem')
        ? Array.from(plan.district_totals('E_20_PRES_Dem'))
        : null;
      const repTotals: number[] | null = available.includes('E_20_PRES_Rep')
        ? Array.from(plan.district_totals('E_20_PRES_Rep'))
        : null;

      for (const { district, wkb } of geometries) {
        const multiPolygon = parseWkbMultiPolygon(wkb);
        if (multiPolygon && multiPolygon.coordinates.length > 0) {
          const dem = demTotals?.[district - 1] ?? 0;
          const rep = repTotals?.[district - 1] ?? 0;
          const total = dem + rep;
          const partisanLean = total > 0 ? (dem - rep) / total : 0;
          features.push({
            type: 'Feature',
            properties: {
              district,
              color: districtColor(district - 1),
              partisanLean,
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

      const ethnicCols = ['White', 'Black', 'Hispanic', 'Asian', 'Native', 'Pacific'] as const;
      const ethnicTotals: Record<string, number[] | null> = {};
      for (const group of ethnicCols) {
        const col = `T_20_CENS_${group}`;
        ethnicTotals[group] = available.includes(col)
          ? Array.from(plan.district_totals(col))
          : null;
      }

      setDistrictStats(populations.map((pop, i) => {
        const pct = (arr: number[] | null) =>
          arr && pop > 0 ? (arr[i] / pop) * 100 : 0;
        return {
          district: i + 1,
          color: districtColor(i),
          population: pop,
          deviation: ideal > 0 ? ((pop - ideal) / ideal) * 100 : 0,
          demVotes: demVotes?.[i] ?? 0,
          repVotes: repVotes?.[i] ?? 0,
          whitePct: pct(ethnicTotals['White']),
          blackPct: pct(ethnicTotals['Black']),
          hispanicPct: pct(ethnicTotals['Hispanic']),
          asianPct: pct(ethnicTotals['Asian']),
          nativePct: pct(ethnicTotals['Native']),
          pacificPct: pct(ethnicTotals['Pacific']),
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
      districtGeoJsonLoadedRef.current = null;
    };

    // --- District overlay: add once, update data/paint on change ---
    if (districtGeoJson && districtGeoJson.features.length > 0) {
      if (!map.getSource(districtSourceId)) {
        map.addSource(districtSourceId, { type: 'geojson', data: districtGeoJson });
        map.addLayer({
          id: 'district-boundaries-fill',
          type: 'fill',
          source: districtSourceId,
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.70 },
        });
        map.addLayer({
          id: 'district-boundaries-line',
          type: 'line',
          source: districtSourceId,
          paint: { 'line-color': '#333333', 'line-width': 1.5, 'line-opacity': 1.0 },
        });
        districtLayersAddedRef.current = true;
        districtGeoJsonLoadedRef.current = districtGeoJson;
      } else if (districtGeoJsonLoadedRef.current !== districtGeoJson) {
        (map.getSource(districtSourceId) as any).setData(districtGeoJson);
        districtGeoJsonLoadedRef.current = districtGeoJson;
      }

      if (visualizationMode === 'districts') {
        // Step expression using backend breakpoint intervals, colors sampled from
        // the frontend red↔gray↔blue ramp at each interval's midpoint.
        const fillColor: any = districtColorMetric === 'partisan'
          ? ['step', ['get', 'partisanLean'],
              '#ff4040',          // default (< -1.0)
              -1.00, '#ff4040',   // [-1.00, -0.50)  mid=-0.75
              -0.50, '#fa9595',   // [-0.50, -0.30)  mid=-0.40
              -0.30, '#f4b4b4',   // [-0.30, -0.20)  mid=-0.25
              -0.20, '#f0c4c4',   // [-0.20, -0.15)  mid=-0.175
              -0.15, '#eecccc',   // [-0.15, -0.12)  mid=-0.135
              -0.12, '#edd2d2',   // [-0.12, -0.09)  mid=-0.105
              -0.09, '#ebd8d8',   // [-0.09, -0.06)  mid=-0.075
              -0.06, '#eadede',   // [-0.06, -0.04)  mid=-0.05
              -0.04, '#e9e2e2',   // [-0.04, -0.02)  mid=-0.03
              -0.02, '#e8e6e6',   // [-0.02,  0.00)  mid=-0.01
               0.00, '#e6e6e8',   // [ 0.00,  0.02)  mid= 0.01
               0.02, '#e2e2e9',   // [ 0.02,  0.04)  mid= 0.03
               0.04, '#dedeea',   // [ 0.04,  0.06)  mid= 0.05
               0.06, '#d8d8eb',   // [ 0.06,  0.09)  mid= 0.075
               0.09, '#d2d2ed',   // [ 0.09,  0.12)  mid= 0.105
               0.12, '#ccccee',   // [ 0.12,  0.15)  mid= 0.135
               0.15, '#c4c4f0',   // [ 0.15,  0.20)  mid= 0.175
               0.20, '#b4b4f4',   // [ 0.20,  0.30)  mid= 0.25
               0.30, '#9595fa',   // [ 0.30,  0.50)  mid= 0.40
               0.50, '#4040ff']   // [ 0.50,  1.00]  mid= 0.75
          : (() => {
            const isEthnic = ETHNICITY_METRICS.includes(districtColorMetric as EthnicityMetric);
            if (isEthnic && districtStats && districtStats.length > 0) {
              const metric = districtColorMetric as EthnicityMetric;
              const [lightColor, darkColor, zeroGroupColor] = ETHNICITY_COLOR_RANGE[metric];
              const statKey = ETHNICITY_STAT_KEYS[metric];
              return [
                'match', ['get', 'district'],
                ...districtStats.flatMap(d => {
                  const pct = (d[statKey] as number) / 100;
                  const color = pct === 0 ? zeroGroupColor : lerpColor(pct, lightColor, darkColor);
                  return [d.district, color];
                }),
                '#888888',
              ];
            }
            return ['get', 'color'];
          })();
        map.setPaintProperty('district-boundaries-fill', 'fill-color', fillColor);
        map.setPaintProperty('district-boundaries-fill', 'fill-opacity', 0.70);
      } else {
        map.setPaintProperty('district-boundaries-fill', 'fill-opacity', 0);
      }
    } else {
      removeDistrictOverlay();
    }

    // --- Base layer coloring ---
    // Metric-based coloring (partisan/ethnicity) applies in both District and Map view.
    // Default coloring falls back to visualizationMode.
    if (districtColorMetric === 'partisan' && visualizationMode !== 'districts') {
        const partisanPaint: any = [
          'case',
          ['!=', ['feature-state', 'partisanLean'], null],
          [
            'case',
            ['<', ['feature-state', 'partisanLean'], -1.5], '#d8d8d8',
            ['interpolate', ['linear'], ['feature-state', 'partisanLean'],
              -1, '#ff0000', -0.5, '#ff8080', 0, '#e8e8e8', 0.5, '#8080ff', 1, '#0000ff'],
          ],
          '#e8e8e8'
        ];
        for (const layerName of allLayers) {
          const fillLayerId = `units-${layerName}-fill`;
          const lineLayerId = `units-${layerName}-line`;
          if (map.getLayer(fillLayerId)) map.setPaintProperty(fillLayerId, 'fill-color', partisanPaint);
          if (map.getLayer(lineLayerId)) map.setPaintProperty(lineLayerId, 'line-opacity', 0);
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
          if (e.sourceId === sourceId && e.isSourceLoaded) updatePartisanStates();
        };
        map.on('moveend', updatePartisanStates);
        map.on('sourcedata', handleSourceData);
        return () => {
          map.off('moveend', updatePartisanStates);
          map.off('sourcedata', handleSourceData);
        };
      } else if (ETHNICITY_METRICS.includes(districtColorMetric as EthnicityMetric) && visualizationMode !== 'districts') {
        const metric = districtColorMetric as EthnicityMetric;
        const stateKey = `conc_${metric.replace('_pct', '')}`;
        const [lightColor, darkColor, zeroGroupColor, zeroPopColor] = ETHNICITY_COLOR_RANGE[metric];
        const ethnicPaint: any = [
          'case',
          ['!=', ['feature-state', stateKey], null],
          [
            'case',
            ['<', ['feature-state', stateKey], 0], zeroPopColor,
            ['==', ['feature-state', stateKey], 0], zeroGroupColor,
            ['interpolate', ['linear'], ['feature-state', stateKey], 0, lightColor, 1, darkColor],
          ],
          lightColor,
        ];
        for (const layerName of allLayers) {
          const fillLayerId = `units-${layerName}-fill`;
          const lineLayerId = `units-${layerName}-line`;
          if (map.getLayer(fillLayerId)) map.setPaintProperty(fillLayerId, 'fill-color', ethnicPaint);
          if (map.getLayer(lineLayerId)) map.setPaintProperty(lineLayerId, 'line-opacity', 0);
        }

        const updateEthnicityStates = () => {
          const metricData = ethnicityDataRef.current[metric];
          if (!metricData) return;
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
              const concentration = metricData[String(geoId)];
              if (concentration !== undefined) {
                map.setFeatureState(
                  { source: sourceId, sourceLayer: layerName, id: featureId },
                  { [stateKey]: concentration }
                );
              }
            }
          }
        };
        updateEthnicityStates();
        const handleSourceData = (e: any) => {
          if (e.sourceId === sourceId && e.isSourceLoaded) updateEthnicityStates();
        };
        map.on('moveend', updateEthnicityStates);
        map.on('sourcedata', handleSourceData);
        return () => {
          map.off('moveend', updateEthnicityStates);
          map.off('sourcedata', handleSourceData);
        };
      } else {
        // Default metric: gray in District View, district colors in Map View
        const grayFill = 'rgba(230, 230, 230, 0.5)';
        const paint = visualizationMode === 'districts'
          ? grayFill
          : ['match', ['feature-state', 'district'],
              ...Array.from({ length: 50 }, (_, i) => [i + 1, districtColor(i)]).flat(),
              grayFill];
        for (const layerName of allLayers) {
          const fillLayerId = `units-${layerName}-fill`;
          const lineLayerId = `units-${layerName}-line`;
          if (map.getLayer(fillLayerId)) map.setPaintProperty(fillLayerId, 'fill-color', paint);
          if (map.getLayer(lineLayerId)) {
            const lineOpacity = layerName === activeLayerRef.current ? 0.5 : 0;
            map.setPaintProperty(lineLayerId, 'line-opacity', lineOpacity);
          }
        }
      }
  }, [visualizationMode, districtColorMetric, mapInitialized, districtGeoJson, sourcesVersion, districtStats, currentLayer]);

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
              ...Array.from({ length: 50 }, (_, i) => [i + 1, districtColor(i)]).flat(),
              'rgba(0,0,0,0)'
            ]
          ],
          'fill-opacity': 0,
          'fill-opacity-transition': { duration: 0 },
          'fill-antialias': true,
        };

        const linePaint: any = {
          'line-width': 1.0,
          'line-color': 'rgba(0,0,0,0.7)',
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

        map.jumpTo({ center: config.center, zoom: config.zoom });

        // Clear loading status once MapLibre has finished all pending work.
        // 'idle' is more reliable than 'sourcedata' — the latter can fire before
        // the source is fully ready or be missed if the source loads synchronously.
        map.once('idle', () => setLoadingStatus(''));
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
      if (drawingTool === 'paint') map.getCanvas().style.cursor = 'crosshair';
      else if (drawingTool === 'erase') map.getCanvas().style.cursor = 'cell';
      else map.getCanvas().style.cursor = 'pointer';
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = '';
    };

    const handleClick = (e: any) => {
      if (drawingTool === 'pan') return;
      const f = e.features?.[0] as any;
      const id: string = String(f?.properties?.geo_id ?? '');
      if (!id) return;

      const sourceId = 'units-all';

      if (drawingTool === 'erase') {
        const prevDistrict = assignmentsRef.current[id];
        if (prevDistrict == null) return;
        delete assignmentsRef.current[id];
        setDistrictCounts((c) => {
          const next = { ...c };
          next[prevDistrict] = (next[prevDistrict] ?? 1) - 1;
          if (next[prevDistrict] <= 0) delete next[prevDistrict];
          return next;
        });
        map.setFeatureState(
          { source: sourceId, sourceLayer: currentLayer, id },
          { district: null }
        );
        delete featureHashesRef.current[id];
        return;
      }

      // paint
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
      map.setFeatureState(
        { source: sourceId, sourceLayer: currentLayer, id },
        { district: activeDistrict }
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
  }, [drawingTool, activeDistrict, mapInitialized, currentLayer]);

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
          onPaintModeChange={(enabled) => setDrawingTool(enabled ? 'paint' : 'pan')}
          visualizationMode={visualizationMode}
          onVisualizationModeChange={(mode) => setVisualizationMode(mode as 'districts' | 'partisan')}
          districtCounts={districtCounts}
          onRandomize={handleRandomize}
          onOptimize={handleOptimize}
          onRefreshDistricts={computeDistrictGeometries}
          onClearAssignments={handleClearAssignments}
          districtColorMetric={districtColorMetric}
          onDistrictColorMetricChange={setDistrictColorMetric}
          districtStats={districtStats}
          districtSwatchColors={districtSwatchColors}
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
        >
          <MapToolbar
            drawingTool={drawingTool}
            onDrawingToolChange={setDrawingTool}
            visualizationMode={visualizationMode}
            onVisualizationModeChange={(mode) => setVisualizationMode(mode as 'districts' | 'partisan')}
            visible={mapInitialized && !loadingPack && !loadingStatus}
          />
        </MapViewer>
      </div>
    </div>
  );
}
