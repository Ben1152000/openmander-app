import { useEffect } from 'react';
import type { Map } from 'maplibre-gl';
import type { MutableRefObject } from 'react';
import { STATE_CONFIGS, getLayerForZoom } from '@/app/constants/config';
import { districtColor } from '@/app/constants/colors';

const ALL_LAYERS = ['state', 'county', 'tract', 'group', 'vtd', 'block'];

export function useMapLayers(params: {
  mapRef: MutableRefObject<Map | null>;
  mapInitialized: boolean;
  pmtilesBufferReady: boolean;
  loadedState: string;
  setLoadingStatus: (s: string) => void;
  setSourcesVersion: React.Dispatch<React.SetStateAction<number>>;
  loadedSourcesRef: MutableRefObject<Set<string>>;
  workerReadyRef: MutableRefObject<boolean>;
}) {
  const { mapRef, mapInitialized, pmtilesBufferReady, loadedState, setLoadingStatus, setSourcesVersion, loadedSourcesRef, workerReadyRef } = params;

  // Immediately clear layers and pan to the new state when loadedState changes.
  useEffect(() => {
    if (!mapRef.current || !mapInitialized) return;
    const config = STATE_CONFIGS[loadedState];
    if (!config) return;

    const map = mapRef.current;
    const sourceId = 'units-all';

    if (map.getLayer('state-outline')) map.removeLayer('state-outline');
    for (const name of ALL_LAYERS) {
      if (map.getLayer(`units-${name}-hover`)) map.removeLayer(`units-${name}-hover`);
      if (map.getLayer(`units-${name}-fill`)) map.removeLayer(`units-${name}-fill`);
      if (map.getLayer(`units-${name}-line`)) map.removeLayer(`units-${name}-line`);
    }
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    loadedSourcesRef.current.delete('all');

    map.fitBounds(config.bounds, { animate: false, padding: 40 });
  }, [mapInitialized, loadedState]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mapRef.current || !mapInitialized || !pmtilesBufferReady) return;
    const config = STATE_CONFIGS[loadedState];
    if (!config) return;

    const map = mapRef.current;
    const sourceId = 'units-all';

    const pmtilesUrl = `pmtiles:///packs/${config.packDir}/geom/geometries.pmtiles`;
    setLoadingStatus('Loading geometry layers...');

    try {
      map.addSource(sourceId, {
        type: 'vector',
        url: pmtilesUrl,
        scheme: 'xyz',
      } as any);

      const fillPaint: any = {
        'fill-color': [
          'case',
          ['!=', ['feature-state', 'partisanLean'], null],
          ['interpolate', ['linear'], ['feature-state', 'partisanLean'],
            -1, '#ff0000', -0.5, '#ff8080', 0, '#e8e8e8', 0.5, '#8080ff', 1, '#0000ff'],
          ['match', ['feature-state', 'district'],
            ...Array.from({ length: 50 }, (_, i) => [i + 1, districtColor(i)]).flat(),
            'rgba(0,0,0,0)'],
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
        'line-blur': 0.5,
      };

      const lineLayout: any = { 'line-cap': 'round', 'line-join': 'round' };
      const initialLayer = getLayerForZoom(map.getZoom());

      for (const name of ALL_LAYERS) {
        const isActive = name === initialLayer;
        map.addLayer({ id: `units-${name}-fill`, type: 'fill', source: sourceId, 'source-layer': name,
          paint: { ...fillPaint, 'fill-opacity': isActive ? 0.7 : 0 } });
        map.addLayer({ id: `units-${name}-line`, type: 'line', source: sourceId, 'source-layer': name,
          paint: { ...linePaint, 'line-opacity': isActive ? 1 : 0 }, layout: lineLayout });
        map.addLayer({ id: `units-${name}-hover`, type: 'fill', source: sourceId, 'source-layer': name,
          paint: {
            'fill-color': '#000000',
            'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.25, 0] as any,
            'fill-opacity-transition': { duration: 0 },
          },
        });
      }

      // Permanent state outline — always visible, transparent fill
      map.addLayer({ id: 'state-outline', type: 'line', source: sourceId, 'source-layer': 'state',
        paint: { 'line-width': 1.0, 'line-color': 'rgba(0,0,0,0.7)', 'line-blur': 0.5 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });

      loadedSourcesRef.current.add('all');
      setSourcesVersion(v => v + 1);

      (map.getSource(sourceId) as any).on('error', () => setLoadingStatus('Error loading geometry layers'));
      map.once('idle', () => { if (workerReadyRef.current) setLoadingStatus(''); });
    } catch (err) {
      console.error('Failed to add PMTiles source:', err);
      setLoadingStatus('Error: Failed to load geometry layers');
    }
  }, [mapInitialized, pmtilesBufferReady, loadedState]); // eslint-disable-line react-hooks/exhaustive-deps
}
