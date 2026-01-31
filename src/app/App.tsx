import { useEffect, useRef, useState } from 'react';
import maplibregl, { Map } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { useWasm } from '@/useWasm';
import { loadPackFromDirectory } from '@/loadPack';
import { SidePanel } from '@/app/components/SidePanel';
import { MapViewer } from '@/app/components/MapViewer';
import '@/App.css';
import 'maplibre-gl/dist/maplibre-gl.css';

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
const DEFAULT_NUM_DISTRICTS = 4;
const DEFAULT_LAYER = 'county';

export default function App() {
  // Resize state
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const isResizing = useRef(false);

  // WASM and map state
  const { wasm, loading: wasmLoading, error: wasmError } = useWasm();
  const mapRef = useRef<Map | null>(null);
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  
  const [plan, setPlan] = useState<any>(null);
  const [mapData, setMapData] = useState<{ wasmMap?: any; wasmMapProxy?: any; packFiles?: Record<string, Uint8Array> } | null>(null);
  const [numDistricts, setNumDistricts] = useState(DEFAULT_NUM_DISTRICTS);
  const [mapInitialized, setMapInitialized] = useState(false);
  const [planUpdateTrigger, setPlanUpdateTrigger] = useState(0);
  
  // Loading states
  const [loadingPack, setLoadingPack] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>('');
  
  // Level-of-detail: track current layer
  const [currentZoom, setCurrentZoom] = useState<number>(DEFAULT_ZOOM);
  const [activeLayer, setActiveLayer] = useState<string>(DEFAULT_LAYER);
  const [currentLayer, setCurrentLayer] = useState<string>(DEFAULT_LAYER);
  const previousLayerRef = useRef<string>(DEFAULT_LAYER);
  const featureHashesRef = useRef<Record<string, string>>({});
  const activeLayerRef = useRef<string>(DEFAULT_LAYER);
  const loadedSourcesRef = useRef<Set<string>>(new Set());

  // Assignments and painting
  const assignmentsRef = useRef<Record<string, number>>({});
  const [activeDistrict, setActiveDistrict] = useState<number>(1);
  const [paintMode, setPaintMode] = useState(false);
  const [districtCounts, setDistrictCounts] = useState<Record<number, number>>({});
  
  // Visualization mode
  const [visualizationMode, setVisualizationMode] = useState<'districts' | 'partisan'>('districts');
  const partisanLeanRef = useRef<Record<string, number>>({});
  const geoIdByIndexRef = useRef<Record<string, Record<number, string>>>({});

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

  // Load Illinois pmtiles pack data
  useEffect(() => {
    if (!wasm) return;

    const loadIllinoisPack = async () => {
      setLoadingPack(true);
      setLoadingStatus('Loading pack files...');
      try {
        const packPath = '/packs/IL_2020_webpack';
        const packFiles = await loadPackFromDirectory(packPath, (current, total, fileName) => {
          if (fileName) {
            setLoadingStatus(`Loading pack files... (${current}/${total}) - ${fileName}`);
          } else {
            setLoadingStatus(`Loading pack files... (${current}/${total})`);
          }
        });

        setLoadingStatus('Initializing map...');

        await new Promise(resolve => {
          requestAnimationFrame(() => {
            requestAnimationFrame(resolve);
          });
        });
        
        const { WasmMap } = wasm as any;
        const wasmMap = new WasmMap(packFiles);

        setMapData({ wasmMap, packFiles });
      } catch (err) {
        console.error('Failed to load Illinois pmtiles pack:', err);
        setLoadingStatus('Error loading pack');
      } finally {
        setLoadingPack(false);
        setLoadingStatus('');
      }
    };

    loadIllinoisPack();
  }, [wasm]);
  
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
          console.log(`Loaded ${layerName}: ${Object.keys(indexToGeoId).length} features`);
        }
        
        partisanLeanRef.current = leanData;
        geoIdByIndexRef.current = indexMaps;
        console.log(`Total partisan lean data: ${Object.keys(leanData).length} features`);
      } catch (err) {
        console.error('Failed to load partisan data:', err);
      }
    };
    
    loadPartisanData();
  }, [mapData]);

  // Create plan from WASM when mapData and numDistricts are available
  useEffect(() => {
    if (!wasm || !mapData?.wasmMap || !numDistricts) return;

    setLoadingStatus('Creating plan...');
    try {
      const { WasmPlan } = wasm as any;
      const newPlan = new WasmPlan(mapData.wasmMap, numDistricts);
      newPlan.randomize();
      setPlan(newPlan);
      setLoadingStatus('');
    } catch (err) {
      console.error('Failed to create plan:', err);
      setLoadingStatus('Error creating plan');
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
    try {
      plan.randomize();
      setPlanUpdateTrigger((prev) => prev + 1);
    } catch (err) {
      console.error('Failed to randomize plan:', err);
    }
  };

  const handleOptimize = () => {
    if (!plan) return;
    try {
      plan.tabu_balance('TOTPOP', 100, 10, 0.5, 50);
      setPlanUpdateTrigger((prev) => prev + 1);
    } catch (err) {
      console.error('Failed to optimize plan:', err);
    }
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

    setupPmtilesProtocol();

    const map = new maplibregl.Map({
      container: mapDivRef.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [-89.0, 40.0],
      zoom: DEFAULT_ZOOM,
      antialias: true,
      fadeDuration: 0,
      pixelRatio: window.devicePixelRatio || 1,
    } as any);
    mapRef.current = map;

    map.on('load', () => {
      map.on('zoomend', () => {
        const zoom = map.getZoom();
        const newLayer = getLayerForZoom(zoom);
        const previousLayer = previousLayerRef.current;
        
        if (newLayer !== previousLayer) {
          console.log(`Layer changed from ${previousLayer} to ${newLayer} at zoom ${zoom}`);
          previousLayerRef.current = newLayer;
          activeLayerRef.current = newLayer;
          
          const allLayers = ['state', 'county', 'tract', 'group', 'vtd', 'block'];
          for (const layerName of allLayers) {
            const fillLayerId = `units-${layerName}-fill`;
            const lineLayerId = `units-${layerName}-line`;
            const visibility = layerName === newLayer ? 'visible' : 'none';
            
            if (map.getLayer(fillLayerId)) {
              map.setLayoutProperty(fillLayerId, 'visibility', visibility);
            }
            if (map.getLayer(lineLayerId)) {
              map.setLayoutProperty(lineLayerId, 'visibility', visibility);
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
    if (!mapRef.current || !mapInitialized) return;
    
    const map = mapRef.current;
    const sourceId = 'units-all';

    if (!loadedSourcesRef.current.has('all')) {
      const pmtilesPath = `/packs/IL_2020_webpack/geom/geometries.pmtiles`;
      console.log(`Loading multi-layer PMTiles source`);
      setLoadingStatus(`Loading geometry layers...`);
      
      try {
        map.addSource(sourceId, {
          type: 'vector',
          url: `pmtiles://${pmtilesPath}`,
          scheme: 'xyz',
          bounds: [-91.5, 36.9, -87.0, 42.5],
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
          'fill-opacity': 0.7,
          'fill-antialias': true,
        };

        const linePaint: any = {
          'line-width': 1.5,
          'line-color': 'rgba(0,0,0,0.4)',
          'line-gap-width': 0,
          'line-blur': 0.5
        };

        const lineLayout: any = {
          'line-cap': 'round',
          'line-join': 'round'
        };

        const allLayers = ['state', 'county', 'tract', 'group', 'vtd', 'block'];
        for (const layerName of allLayers) {
          const fillLayerId = `units-${layerName}-fill`;
          const lineLayerId = `units-${layerName}-line`;

          map.addLayer({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            'source-layer': layerName,
            paint: fillPaint,
            layout: {
              visibility: 'none'
            }
          });

          map.addLayer({
            id: lineLayerId,
            type: 'line',
            source: sourceId,
            'source-layer': layerName,
            paint: linePaint,
            layout: {
              ...lineLayout,
              visibility: 'none'
            }
          });
        }

        loadedSourcesRef.current.add('all');

        const source = map.getSource(sourceId) as any;
        source.on('error', (e: any) => {
          console.error(`PMTiles source error:`, e);
          setLoadingStatus(`Error loading geometry layers`);
        });

        source.on('data', (e: any) => {
          if (e.dataType === 'source' && e.isSourceLoaded) {
            console.log(`Multi-layer PMTiles source loaded - all layers ready`);
            setLoadingStatus('');
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
    if (!mapRef.current || !mapInitialized || !loadedSourcesRef.current.has('all')) return;

    const map = mapRef.current;
    const allLayers = ['state', 'county', 'tract', 'group', 'vtd', 'block'];

    for (const layerName of allLayers) {
      const fillLayerId = `units-${layerName}-fill`;
      const lineLayerId = `units-${layerName}-line`;
      
      const fillLayer = map.getLayer(fillLayerId);
      const lineLayer = map.getLayer(lineLayerId);
      
      const visibility = layerName === currentLayer ? 'visible' : 'none';
      
      if (fillLayer) {
        map.setLayoutProperty(fillLayerId, 'visibility', visibility);
      }
      if (lineLayer) {
        map.setLayoutProperty(lineLayerId, 'visibility', visibility);
      }
    }
  }, [currentLayer, mapInitialized]);

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
          activeDistrict={activeDistrict}
          onActiveDistrictChange={setActiveDistrict}
          paintMode={paintMode}
          onPaintModeChange={setPaintMode}
          visualizationMode={visualizationMode}
          onVisualizationModeChange={(mode) => setVisualizationMode(mode as 'districts' | 'partisan')}
          districtCounts={districtCounts}
          onRandomize={handleRandomize}
          onOptimize={handleOptimize}
          onClearAssignments={handleClearAssignments}
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
