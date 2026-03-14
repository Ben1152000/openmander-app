import { useEffect, useRef, useState } from 'react';
import maplibregl, { Map } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { SidePanel } from '@/app/components/SidePanel';
import { MapViewer } from '@/app/components/MapViewer';
import { MapToolbar, type DrawingTool } from '@/app/components/MapToolbar';
import '@/App.css';
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

  // Worker ready state (replaces wasmLoading/wasmError)
  const [workerReady, setWorkerReady] = useState(false);
  const mapRef = useRef<Map | null>(null);
  const mapDivRef = useRef<HTMLDivElement | null>(null);

  const [numDistricts, setNumDistricts] = useState(DEFAULT_NUM_DISTRICTS);
  const [loadedState, setLoadedState] = useState('illinois');
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
  const featureHashesRef = useRef<Record<string, string>>({});
  const [activeDistrict, setActiveDistrict] = useState<number>(1);
  const [drawingTool, setDrawingTool] = useState<DrawingTool>('pan');
  const [districtCounts, setDistrictCounts] = useState<Record<number, number>>({});

  // Visualization mode
  const [visualizationMode, setVisualizationMode] = useState<'districts' | 'partisan'>('districts');
  const visualizationModeRef = useRef<'districts' | 'partisan'>('districts');

  // District table color metric
  const [districtColorMetric, setDistrictColorMetric] = useState<'default' | 'partisan' | ScalarMetric | EthnicityMetric>('default');

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
  const applyMetricsRef = useRef<((pl: any, gi: any, sd: any, ed: any) => void) | null>(null);

  // Pack loading (fetches pack files, PMTiles buffer)
  const { mapData, loadingPack, pmtilesBufferReady, resetPmtilesBuffer } = usePackLoader(
    loadedState,
    setLoadingStatus,
    () => { setDistrictGeoJson(null); },
  );

  // CSV metric data (refs, populated via worker 'metrics' message)
  const { partisanLeanRef, ethnicityDataRef, scalarDataRef, geoIdByIndexRef, clearMetrics, applyMetrics } = useMapMetrics();

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

  // Spawn plan worker eagerly so WASM compilation overlaps with pack fetching.
  useEffect(() => {
    const worker = new Worker(new URL('../planWorker.ts', import.meta.url), { type: 'module' });
    planRef.current = new WorkerPlan(worker, {
      onLog: (message) => console.log(message),
      onAssignments: (data, done) => {
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
    setLoadingStatus('Initializing plan engine...');

    planRef.current.init(mapData.packFiles, numDistricts).then(() => {
      workerReadyRef.current = true;
      setWorkerReady(true);
      setLoadingStatus('');
    });

    // Metrics worker: CSV parsing (~2.5s), runs in parallel with WasmMap (~7s)
    metricsWorkerRef.current?.terminate();
    const mw = new Worker(new URL('../metricsWorker.ts', import.meta.url), { type: 'module' });
    mw.onmessage = (e) => {
      applyMetricsRef.current?.(e.data.partisanLean, e.data.geoIdByIndex, e.data.scalarData, e.data.ethnicityData);
      mw.terminate();
    };
    mw.onerror = (e) => console.error('[MetricsWorker] Error:', e.message, e);
    metricsWorkerRef.current = mw;
    mw.postMessage({ packFiles: mapData.packFiles });
  }, [mapData, numDistricts]); // eslint-disable-line react-hooks/exhaustive-deps

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
      center: STATE_CONFIGS['illinois'].center,
      zoom: STATE_CONFIGS['illinois'].zoom,
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
              const lineOpacity = !isActive || visualizationModeRef.current === 'partisan' ? 0 : 0.5;
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

  const handleLoadMap = (state: string, districts: number) => {
    assignmentsRef.current = {};
    setDistrictCounts({});
    resetDistrictData();
    if (state !== loadedState) resetPmtilesBuffer();
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

  return (
    <div className="h-screen w-screen flex overflow-hidden">
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
          paintMode={drawingTool === 'paint'}
          onPaintModeChange={(enabled) => setDrawingTool(enabled ? 'paint' : 'pan')}
          visualizationMode={visualizationMode}
          onVisualizationModeChange={(mode) => setVisualizationMode(mode as 'districts' | 'partisan')}
          districtCounts={districtCounts}
          onRefreshDistricts={handleRefreshDistricts}
          onClearAssignments={handleClearAssignments}
          districtColorMetric={districtColorMetric}
          onDistrictColorMetricChange={(m) => setDistrictColorMetric(m as any)}
          districtStats={districtStats}
          regionStats={regionStats}
          districtSwatchColors={districtSwatchColors}
          workerReady={workerReady}
          currentZoom={currentZoom}
          currentLayer={currentLayer}
          loadingStatus={loadingStatus}
          algorithm={algorithm}
          onAlgorithmChange={setAlgorithm}
          popTolerance={popTolerance}
          onPopToleranceChange={setPopTolerance}
          popIterations={popIterations}
          onPopIterationsChange={setPopIterations}
          automationRunning={automationRunning}
          onRunAutomation={handleRunAutomation}
        />
      </div>

      <div
        onMouseDown={handleMouseDown}
        className="w-1 bg-border hover:bg-primary cursor-col-resize flex-shrink-0 transition-colors"
      />

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
