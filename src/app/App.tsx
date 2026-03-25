import { useEffect, useRef, useState } from 'react';
import maplibregl, { Map } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { Map as MapIcon, LayoutList } from 'lucide-react';
import { SidePanel } from '@/app/components/SidePanel';
import { MapViewer } from '@/app/components/MapViewer';
import { MapToolbar, type DrawingTool } from '@/app/components/MapToolbar';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  DEFAULT_ZOOM, DEFAULT_NUM_DISTRICTS, DEFAULT_LAYER, STATE_CONFIGS, getLayerForZoom,
} from './constants/config';
import type { EthnicityMetric, ScalarMetric } from './constants/metrics';
import { useSidebarResize } from './hooks/useSidebarResize';
import { usePackLoader } from './hooks/usePackLoader';
import { useMapMetrics } from './hooks/useMapMetrics';
import { useDistrictData } from './hooks/useDistrictData';
import { useMapLayers } from './hooks/useMapLayers';
import { usePaintHandlers } from './hooks/usePaintHandlers';
import { useVisualizationPaint } from './hooks/useVisualizationPaint';
import { useMetricFeatureState } from './hooks/useMetricFeatureState';
import { WorkerPlan } from '@/workerPlan';

// PMTiles protocol handler - set up once
let pmtilesProtocolSetup = false;
function setupPmtilesProtocol() {
  if (pmtilesProtocolSetup) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  pmtilesProtocolSetup = true;
}


export default function App() {
  const { sidebarWidth, handleMouseDown } = useSidebarResize(400);

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [mobileTab, setMobileTab] = useState<'map' | 'panel'>('map');

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    setTimeout(() => mapRef.current?.resize(), 0);
  }, [isMobile]);

  const handleMobileTabChange = (tab: 'map' | 'panel') => {
    setMobileTab(tab);
    if (tab === 'map') {
      // setTimeout ensures the div is visible and has real dimensions before resize()
      setTimeout(() => mapRef.current?.resize(), 0);
    }
  };

  // Worker ready state (replaces wasmLoading/wasmError)
  const [workerReady, setWorkerReady] = useState(false);
  const mapRef = useRef<Map | null>(null);
  const mapDivRef = useRef<HTMLDivElement | null>(null);

  const [numDistricts, setNumDistricts] = useState(DEFAULT_NUM_DISTRICTS);
  const [loadedState, setLoadedState] = useState('');
  const [mapInitialized, setMapInitialized] = useState(false);

  // Loading state (shared across hooks via setLoadingStatus)
  const [loadingStatus, setLoadingStatus] = useState('');

  // Level-of-detail: track current layer
  const [currentZoom, setCurrentZoom] = useState<number>(DEFAULT_ZOOM);
  const [activeLayer, setActiveLayer] = useState<string>(DEFAULT_LAYER);
  const [currentLayer, setCurrentLayer] = useState<string>(DEFAULT_LAYER);
  const previousLayerRef = useRef<string>(DEFAULT_LAYER);
  const activeLayerRef = useRef<string>(DEFAULT_LAYER);
  const loadedSourcesRef = useRef<Set<string>>(new Set());
  const [sourcesVersion, setSourcesVersion] = useState(0);

  // Assignments and painting
  const assignmentsRef = useRef<Record<string, number>>({});
  // Authoritative block-level assignments from WASM (index → district).
  // Updated after every assignment-changing worker operation; used by useMetricFeatureState.
  const blockAssignmentsRef = useRef<Uint32Array | null>(null);
  // Called by useMetricFeatureState; invoke after any assignment change for immediate color update.
  const metricStateUpdateRef = useRef<(() => void) | null>(null);
  const featureHashesRef = useRef<Record<string, string>>({});
  const [activeDistrict, setActiveDistrict] = useState<number>(1);
  const [drawingTool, setDrawingTool] = useState<DrawingTool>('pan');

  useEffect(() => {
    if (activeDistrict === 0 && drawingTool === 'paint') setDrawingTool('erase');
    if (activeDistrict !== 0 && drawingTool === 'erase') setDrawingTool('paint');
  }, [activeDistrict]);
  const [, setDistrictCounts] = useState<Record<number, number>>({});

  // Visualization mode
  const [visualizationMode, setVisualizationMode] = useState<'districts' | 'map'>('districts');
  const visualizationModeRef = useRef<'districts' | 'map'>('districts');

  // District table color metric
  const [districtColorMetric, setDistrictColorMetric] = useState<'default' | 'partisan' | ScalarMetric | EthnicityMetric>('default');
  const districtColorMetricRef = useRef<string>('default');
  districtColorMetricRef.current = districtColorMetric;

  // Automation settings
  const [automationRunning, setAutomationRunning] = useState(false);
  const [algorithm, setAlgorithm] = useState<'random-initialization' | 'pop-balance'>('random-initialization');
  const [popTolerance, setPopTolerance] = useState(0.0001);
  const [popIterations, setPopIterations] = useState(300);

  // Tab state
  const [activeTab, setActiveTab] = useState<'summary' | 'districts' | 'automation' | 'analysis' | 'debug'>('summary');

  // Plan worker for background optimization
  const planRef = useRef<WorkerPlan | null>(null);
  const metricsWorkerRef = useRef<Worker | null>(null);
  const workerReadyRef = useRef(false);
  // Refs so WorkerPlan callbacks always call the latest hook-provided functions.
  const applyWorkerGeometriesRef = useRef<((items: any[], dem: number[] | null, rep: number[] | null) => void) | null>(null);
  const applyWorkerStatsRef = useRef<((ds: any[], rs: any) => void) | null>(null);
  const applyMetricsRef = useRef<((pl: any, gi: any, sd: any, ed: any, bp: any, prb: any) => void) | null>(null);

  // Pack loading (fetches pack files, PMTiles buffer)
  const { mapData, loadingPack, pmtilesBufferReady, resetPmtilesBuffer } = usePackLoader(
    loadedState,
    setLoadingStatus,
    () => { setDistrictGeoJson(null); },
  );

  // CSV metric data (refs, populated via worker 'metrics' message)
  const { partisanLeanRef, ethnicityDataRef, scalarDataRef, geoIdByIndexRef, blockToParentsRef, parentBlockIndicesRef, clearMetrics, applyMetrics } = useMapMetrics();

  // District geometries, stats, swatch colors
  const { districtGeoJson, setDistrictGeoJson, districtStats, regionStats, districtSwatchColors, applyWorkerGeometries, applyWorkerStats, resetDistrictData } =
    useDistrictData(districtColorMetric);

  // Keep the refs current so the stable worker handler always calls the latest version.
  applyWorkerGeometriesRef.current = applyWorkerGeometries;
  applyWorkerStatsRef.current = applyWorkerStats;
  applyMetricsRef.current = applyMetrics;

  // Map layers (PMTiles vector tile source setup)
  useMapLayers({ mapRef, mapInitialized, pmtilesBufferReady, loadedState, setLoadingStatus, setSourcesVersion, loadedSourcesRef, workerReadyRef });

  // Paint/erase click handlers
  usePaintHandlers({
    mapRef, mapInitialized, currentLayer, drawingTool, activeDistrict, assignmentsRef, setDistrictCounts, featureHashesRef,
    geoIdByIndexRef, automationRunning,
    onAssignUnit: (layer, geoId, district) => { planRef.current?.assignUnit(layer, geoId, district); },
  });

  // Visualization paint (district overlay + base layer coloring)
  useVisualizationPaint({
    mapRef, mapInitialized, sourcesVersion,
    visualizationMode, visualizationModeRef, districtColorMetric,
    districtGeoJson, districtStats, currentLayer,
    activeLayerRef, geoIdByIndexRef, partisanLeanRef, ethnicityDataRef, scalarDataRef,
  });

  useMetricFeatureState({
    mapRef,
    mapInitialized: mapInitialized && districtColorMetric !== 'default',
    sourcesVersion,
    visualizationMode,
    districtColorMetric: districtColorMetric as any,
    currentLayer,
    blockAssignmentsRef,
    geoIdByIndexRef,
    parentBlockIndicesRef,
    partisanLeanRef,
    ethnicityDataRef,
    scalarDataRef,
    updateTriggerRef: metricStateUpdateRef,
  });

  // Spawn plan worker eagerly so WASM compilation overlaps with pack fetching.
  useEffect(() => {
    const worker = new Worker(new URL('../planWorker.ts', import.meta.url), { type: 'module' });
    planRef.current = new WorkerPlan(worker, {
      onLog: (message) => console.log(message),
      onAssignments: (data, done) => {
        // Always update the authoritative block-level array (source of truth for feature states).
        blockAssignmentsRef.current = data;
        // Immediately refresh metric feature states (painting, automation, import).
        metricStateUpdateRef.current?.();
        if (done) {
          const blockMap = geoIdByIndexRef.current['block'];
          if (blockMap) {
            const dict: Record<string, number> = {};
            const counts: Record<number, number> = {};
            for (let i = 0; i < data.length; i++) {
              const d = data[i];
              if (d > 0) { const g = blockMap[i]; if (g) { dict[g] = d; counts[d] = (counts[d] ?? 0) + 1; } }
            }
            assignmentsRef.current = dict;
            setDistrictCounts(counts);
          }
          setLoadingStatus('');
        }
      },
      onGeometries: (items, dem, rep) => applyWorkerGeometriesRef.current?.(items, dem, rep),
      onStats: (ds, rs) => applyWorkerStatsRef.current?.(ds, rs),
    });
    return () => { planRef.current?.terminate(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When pack files arrive, initialise the plan worker and metrics worker in parallel.
  useEffect(() => {
    if (!mapData?.packFiles || !numDistricts || !planRef.current) return;

    workerReadyRef.current = false;
    setWorkerReady(false);
    setDistrictGeoJson(null);
    clearMetrics();
    setLoadingStatus((Math.random() < 0.01 ? 'Imbibing redistricting eggnog...' : 'Initializing redistricting engine...'));

    planRef.current.init(mapData.packFiles, numDistricts).then(() => {
      workerReadyRef.current = true;
      setWorkerReady(true);
      setLoadingStatus('');
    });

    // Metrics worker: CSV parsing (~2.5s), runs in parallel with WasmMap (~7s)
    metricsWorkerRef.current?.terminate();
    const mw = new Worker(new URL('../metricsWorker.ts', import.meta.url), { type: 'module' });
    mw.onmessage = (e) => {
      applyMetricsRef.current?.(e.data.partisanLean, e.data.geoIdByIndex, e.data.scalarData, e.data.ethnicityData, e.data.blockToParents ?? {}, e.data.parentBlockIndices ?? {});
      metricStateUpdateRef.current?.();
      mw.terminate();
    };
    mw.onerror = (e) => console.error('[MetricsWorker] Error:', e.message, e);
    metricsWorkerRef.current = mw;
    mw.postMessage({ packFiles: mapData.packFiles });
  }, [mapData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize map only once
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;

    setupPmtilesProtocol();

    // Suppress noisy MapLibre WebGL texture warnings (harmless deprecation notices)
    const origWarn = console.warn.bind(console);
    console.warn = (...args: any[]) => {
      if (typeof args[0] === 'string' && args[0].includes('Alpha-premult')) return;
      origWarn(...args);
    };

    const map = new maplibregl.Map({
      container: mapDivRef.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      bounds: STATE_CONFIGS['illinois'].bounds,
      fitBoundsOptions: { padding: 40 },
      minZoom: 4.0,
      antialias: true,
      fadeDuration: 0,
      pixelRatio: window.devicePixelRatio || 1,
    } as any);
    mapRef.current = map;

    map.on('load', () => {
      map.on('zoom', () => {
        const zoom = map.getZoom();
        const newLayer = getLayerForZoom(zoom);
        const previousLayer = previousLayerRef.current;

        if (newLayer !== previousLayer) {
          previousLayerRef.current = newLayer;
          activeLayerRef.current = newLayer;

          const allLayers = ['state', 'county', 'tract', 'group', 'vtd', 'block'];
          for (const name of allLayers) {
            const isActive = name === newLayer;
            if (map.getLayer(`units-${name}-fill`))
              map.setPaintProperty(`units-${name}-fill`, 'fill-opacity', isActive ? 0.7 : 0);
            if (map.getLayer(`units-${name}-line`)) {
              const lineOpacity = !isActive || visualizationModeRef.current === 'map' || districtColorMetricRef.current !== 'default' ? 0 : 0.5;
              map.setPaintProperty(`units-${name}-line`, 'line-opacity', lineOpacity);
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
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      setMapInitialized(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunAutomation = () => {
    if (!workerReadyRef.current || !planRef.current) return;
    setLoadingStatus('Creating plan...');
    setAutomationRunning(true);
    const done = () => setAutomationRunning(false);
    if (algorithm === 'random-initialization') {
      planRef.current.randomize().then(done, done);
    } else if (algorithm === 'pop-balance') {
      planRef.current.equalize('T_20_CENS_Total', popTolerance, popIterations).then(done, done);
    }
  };

  const handleRefreshDistricts = () => {
    planRef.current?.computeGeometries();
  };

  const handleExportPlan = () => {
    const rows = ['GEOID20,District'];
    for (const [geoId, district] of Object.entries(assignmentsRef.current)) {
      if (district > 0) rows.push(`${geoId},${district}`);
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${loadedState}-plan.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportPlan = (file: File) => {
    const blockMap = geoIdByIndexRef.current['block'];
    if (!blockMap) { window.alert('Error: Map data not loaded yet.'); return; }
    const geoIdToIndex: Record<string, number> = {};
    for (const [idx, geoId] of Object.entries(blockMap)) geoIdToIndex[geoId] = parseInt(idx);
    const size = Object.keys(blockMap).length;

    file.text().then(text => {
      const arr = new Uint32Array(size);
      const newAssignments: Record<string, number> = {};
      const lines = text.split('\n');
      const headers = lines[0].trim().split(',').map(h => h.toLowerCase());
      const geoCol = headers.findIndex(h => h === 'geoid20' || h === 'geo_id');
      const distCol = headers.findIndex(h => h === 'district');
      if (geoCol === -1 || distCol === -1) {
        window.alert('Error: CSV must have a GEOID20 (or geo_id) column and a District column.');
        return;
      }
      let matched = 0, unmatched = 0;
      for (const line of lines.slice(1)) {
        const cols = line.trim().split(',');
        const [geoId, districtStr] = [cols[geoCol], cols[distCol]];
        if (!geoId || !districtStr) continue;
        const district = parseInt(districtStr);
        const idx = geoIdToIndex[geoId];
        if (idx != null && district > 0) {
          arr[idx] = district;
          newAssignments[geoId] = district;
          matched++;
        } else if (geoId) {
          unmatched++;
        }
      }
      if (matched === 0) {
        window.alert(`Error: No blocks matched the loaded state. Make sure the CSV is for ${loadedState}.`);
        return;
      }
      const maxDistrict = Object.values(newAssignments).reduce((m, v) => v > m ? v : m, 0);
      if (maxDistrict > numDistricts) {
        window.alert(`Error: CSV contains district ${maxDistrict} but the current plan only has ${numDistricts} district${numDistricts === 1 ? '' : 's'}. Recreate the map with the correct number of districts and try again.`);
        return;
      }
      assignmentsRef.current = newAssignments;
      setDistrictCounts(
        Object.values(newAssignments).reduce<Record<number, number>>((acc, d) => {
          acc[d] = (acc[d] ?? 0) + 1; return acc;
        }, {})
      );
      planRef.current?.setAssignments(arr);
      if (unmatched > 0) {
        window.alert(`Imported ${matched.toLocaleString()} blocks. Warning: ${unmatched.toLocaleString()} rows did not match any block in the loaded state.`);
      } else {
        window.alert(`Successfully imported ${matched.toLocaleString()} block assignments.`);
      }
    });
  };

  const handleLoadMap = (state: string, districts: number) => {
    assignmentsRef.current = {};
    setDistrictCounts({});
    resetDistrictData();
    if (state !== loadedState) {
      resetPmtilesBuffer();
    } else if (mapData?.packFiles && planRef.current) {
      // Same state — mapData/numDistricts won't change so the init effect won't re-run; call init directly.
      workerReadyRef.current = false;
      setWorkerReady(false);
      setLoadingStatus((Math.random() < 1/50 ? 'Imbibing redistricting eggnog...' : 'Initializing redistricting engine...'));
      planRef.current.init(mapData.packFiles, districts).then(() => {
        workerReadyRef.current = true;
        setWorkerReady(true);
        setLoadingStatus('');
      });
    }
    setLoadedState(state);
    setNumDistricts(districts);
  };

  const handleClearAssignments = () => {
    assignmentsRef.current = {};
    setDistrictCounts({});
    if (mapRef.current && currentLayer === 'block') {
      const fillLayerId = `units-${currentLayer}-fill`;
      const features = mapRef.current.queryRenderedFeatures({ layers: [fillLayerId] });
      for (const feature of features) {
        const geoId = feature.properties?.geo_id;
        if (geoId) mapRef.current.setFeatureState({ source: 'units-all', sourceLayer: currentLayer, id: geoId }, { district: null });
      }
    }
  };

  const sidePanelProps = {
    activeTab,
    onTabChange: setActiveTab,
    numDistricts,
    onNumDistrictsChange: setNumDistricts,
    loadedState,
    onLoadMap: handleLoadMap,
    onPendingStateChange: (state: string) => {
      if (loadedState) return;
      const config = STATE_CONFIGS[state];
      if (config && mapRef.current) mapRef.current.fitBounds(config.bounds, { animate: true, padding: 40 });
    },
    activeDistrict,
    onActiveDistrictChange: setActiveDistrict,
    paintMode: drawingTool === 'paint',
    onPaintModeChange: (enabled: boolean) => setDrawingTool(enabled ? 'paint' : 'pan'),
    visualizationMode,
    onVisualizationModeChange: (mode: string) => setVisualizationMode(mode as 'districts' | 'map'),
    onRefreshDistricts: handleRefreshDistricts,
    onClearAssignments: handleClearAssignments,
    districtColorMetric,
    onDistrictColorMetricChange: (m: string) => setDistrictColorMetric(m as any),
    districtStats,
    regionStats,
    districtSwatchColors,
    workerReady,
    currentZoom,
    currentLayer,
    loadingStatus,
    algorithm,
    onAlgorithmChange: setAlgorithm,
    popTolerance,
    onPopToleranceChange: setPopTolerance,
    popIterations,
    onPopIterationsChange: setPopIterations,
    automationRunning,
    onRunAutomation: handleRunAutomation,
    onExportPlan: handleExportPlan,
    onImportPlan: handleImportPlan,
  };

  const mapViewer = (
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
        onVisualizationModeChange={(mode) => setVisualizationMode(mode as 'districts' | 'map')}
        districtColorMetric={districtColorMetric}
        onDistrictColorMetricChange={(m) => setDistrictColorMetric(m as any)}
        visible={mapInitialized && !loadingPack && pmtilesBufferReady}
        workerReady={workerReady}
        activeDistrict={activeDistrict}
      />
    </MapViewer>
  );

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      {/* Main content row (desktop) / stack (mobile) */}
      <div className="flex-1 flex overflow-hidden" style={{ flexDirection: isMobile ? 'column' : 'row' }}>
        {/* Sidebar */}
        <div
          className={isMobile && mobileTab !== 'panel' ? 'hidden' : 'overflow-hidden'}
          style={isMobile ? { flex: 1 } : { width: `${sidebarWidth}px`, flexShrink: 0 }}
        >
          <SidePanel {...sidePanelProps} />
        </div>

        {/* Resize handle — always rendered so sibling order stays constant */}
        <div
          onMouseDown={!isMobile ? handleMouseDown : undefined}
          className={isMobile ? 'hidden' : 'w-1 bg-border hover:bg-primary cursor-col-resize flex-shrink-0 transition-colors'}
        />

        {/* Map — always rendered, hidden on mobile when panel tab is active */}
        <div
          className={isMobile && mobileTab !== 'map' ? 'hidden' : 'overflow-hidden'}
          style={{ flex: 1 }}
        >
          {mapViewer}
        </div>
      </div>

      {/* Mobile tab bar — always rendered so sibling order stays constant */}
      <div className={`border-t bg-background shrink-0 ${isMobile ? 'flex' : 'hidden'}`}>
        <button
          onClick={() => handleMobileTabChange('panel')}
          className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-medium transition-colors ${mobileTab === 'panel' ? 'text-primary' : 'text-muted-foreground'}`}
        >
          <LayoutList className="w-5 h-5" />
          Menu
        </button>
        <button
          onClick={() => handleMobileTabChange('map')}
          className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-medium transition-colors ${mobileTab === 'map' ? 'text-primary' : 'text-muted-foreground'}`}
        >
          <MapIcon className="w-5 h-5" />
          Map
        </button>
      </div>
    </div>
  );
}
