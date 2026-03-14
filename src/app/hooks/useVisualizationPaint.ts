import { useEffect, useRef } from 'react';
import type { Map } from 'maplibre-gl';
import type { MutableRefObject } from 'react';
import {
  districtColor, rampColor,
  PARTISAN_STEPS, ETHNICITY_COLOR_RANGE, SCALAR_COLOR_RAMPS, UNIT_GRAY_FILL,
} from '@/app/constants/colors';
import { ETHNICITY_METRICS, ETHNICITY_STAT_KEYS, SCALAR_METRICS, SCALAR_STAT_KEYS } from '@/app/constants/metrics';
import type { DistrictStat, EthnicityMetric, ScalarMetric } from '@/app/constants/metrics';

type ColorMetric = 'default' | 'partisan' | ScalarMetric | EthnicityMetric;
const ALL_LAYERS = ['state', 'county', 'tract', 'group', 'vtd', 'block'];

export function useVisualizationPaint(params: {
  mapRef: MutableRefObject<Map | null>;
  mapInitialized: boolean;
  sourcesVersion: number;
  visualizationMode: 'districts' | 'map';
  visualizationModeRef: MutableRefObject<'districts' | 'map'>;
  districtColorMetric: ColorMetric;
  districtGeoJson: GeoJSON.FeatureCollection | null;
  districtStats: DistrictStat[] | null;
  currentLayer: string;
  activeLayerRef: MutableRefObject<string>;
  geoIdByIndexRef: MutableRefObject<Record<string, Record<number, string>>>;
  partisanLeanRef: MutableRefObject<Record<string, number>>;
  ethnicityDataRef: MutableRefObject<Partial<Record<EthnicityMetric, Record<string, number>>>>;
  scalarDataRef: MutableRefObject<Partial<Record<ScalarMetric, Record<string, number>>>>;
}) {
  const {
    mapRef, mapInitialized, sourcesVersion,
    visualizationMode, visualizationModeRef, districtColorMetric,
    districtGeoJson, districtStats, currentLayer,
    activeLayerRef, geoIdByIndexRef, partisanLeanRef, ethnicityDataRef, scalarDataRef,
  } = params;

  // Stable refs for district layers, managed entirely within this effect
  const districtLayersAddedRef = useRef(false);
  const districtGeoJsonLoadedRef = useRef<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    visualizationModeRef.current = visualizationMode;

    if (!mapRef.current || !mapInitialized || sourcesVersion === 0) return;

    const map = mapRef.current;
    const sourceId = 'units-all';
    const districtSourceId = 'district-boundaries';

    const removeDistrictOverlay = () => {
      if (map.getLayer('district-labels')) map.removeLayer('district-labels');
      if (map.getLayer('district-boundaries-fill')) map.removeLayer('district-boundaries-fill');
      if (map.getLayer('district-boundaries-line')) map.removeLayer('district-boundaries-line');
      if (map.getSource(districtSourceId)) map.removeSource(districtSourceId);
      districtLayersAddedRef.current = false;
      districtGeoJsonLoadedRef.current = null;
    };

    // --- District overlay ---
    if (districtGeoJson && districtGeoJson.features.length > 0) {
      if (!map.getSource(districtSourceId)) {
        map.addSource(districtSourceId, { type: 'geojson', data: districtGeoJson });
        map.addLayer({ id: 'district-boundaries-fill', type: 'fill', source: districtSourceId,
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.60 } });
        map.addLayer({ id: 'district-boundaries-line', type: 'line', source: districtSourceId,
          paint: { 'line-color': '#333333', 'line-width': 1.5, 'line-opacity': 1.0 } });
        map.addLayer({ id: 'district-labels', type: 'symbol', source: districtSourceId,
          layout: {
            'text-field': ['to-string', ['get', 'district']], 'text-size': 14,
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-allow-overlap': false,
            'visibility': visualizationMode === 'districts' ? 'visible' : 'none',
          },
          paint: { 'text-color': '#111111', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
        });
        districtLayersAddedRef.current = true;
        districtGeoJsonLoadedRef.current = districtGeoJson;
      } else if (districtGeoJsonLoadedRef.current !== districtGeoJson) {
        (map.getSource(districtSourceId) as any).setData(districtGeoJson);
        districtGeoJsonLoadedRef.current = districtGeoJson;
      }

      if (visualizationMode === 'districts') {
        const fillColor: any = districtColorMetric === 'partisan'
          ? ['step', ['get', 'partisanLean'],
              PARTISAN_STEPS[0][1],
              ...PARTISAN_STEPS.flatMap(([val, color]) => [val, color])]
          : (() => {
              if (ETHNICITY_METRICS.includes(districtColorMetric as EthnicityMetric) && districtStats?.length) {
                const metric = districtColorMetric as EthnicityMetric;
                const [stops, zeroGroupColor] = ETHNICITY_COLOR_RANGE[metric];
                const statKey = ETHNICITY_STAT_KEYS[metric];
                return ['match', ['get', 'district'],
                  ...districtStats.flatMap(d => {
                    const pct = (d[statKey] as number) / 100;
                    return [d.district, pct === 0 ? zeroGroupColor : rampColor(pct, stops)];
                  }), '#888888'];
              }
              if (SCALAR_METRICS.includes(districtColorMetric as ScalarMetric) && districtStats?.length) {
                const metric = districtColorMetric as ScalarMetric;
                const statKey = SCALAR_STAT_KEYS[metric];
                return ['match', ['get', 'district'],
                  ...districtStats.flatMap(d => [d.district, rampColor(Math.log1p(d[statKey] as number), SCALAR_COLOR_RAMPS[metric])]),
                  '#888888'];
              }
              return ['get', 'color'];
            })();

        map.setPaintProperty('district-boundaries-fill', 'fill-color', fillColor);
        map.setPaintProperty('district-boundaries-fill', 'fill-opacity', 0.60);
        if (map.getLayer('district-labels')) map.setLayoutProperty('district-labels', 'visibility', 'visible');
      } else {
        map.setPaintProperty('district-boundaries-fill', 'fill-opacity', 0);
        if (map.getLayer('district-labels')) map.setLayoutProperty('district-labels', 'visibility', 'none');
      }
    } else {
      removeDistrictOverlay();
    }

    // --- Base layer coloring ---
    if (districtColorMetric === 'partisan' && visualizationMode !== 'districts') {
      const partisanPaint: any = ['case', ['!=', ['feature-state', 'partisanLean'], null],
        ['case',
          ['<', ['feature-state', 'partisanLean'], -1.5], '#d8d8d8',
          ['interpolate', ['linear'], ['feature-state', 'partisanLean'],
            -1, '#990000', -0.5, '#ff4040', 0, '#e8e8e8', 0.5, '#4040ff', 1, '#000099']],
        '#e8e8e8'];
      for (const name of ALL_LAYERS) {
        if (map.getLayer(`units-${name}-fill`)) map.setPaintProperty(`units-${name}-fill`, 'fill-color', partisanPaint);
        if (map.getLayer(`units-${name}-line`)) map.setPaintProperty(`units-${name}-line`, 'line-opacity', 0);
      }
      const updatePartisanStates = () => {
        for (const name of ALL_LAYERS) {
          const fillLayerId = `units-${name}-fill`;
          if (!map.getLayer(fillLayerId)) continue;
          const features = map.queryRenderedFeatures({ layers: [fillLayerId] });
          const indexMap = geoIdByIndexRef.current[name];
          if (!indexMap) continue;
          for (const feature of features) {
            const geoId = indexMap[parseInt(feature.properties?.index)];
            if (!geoId) continue;
            const lean = partisanLeanRef.current[String(geoId)];
            if (lean !== undefined) map.setFeatureState({ source: sourceId, sourceLayer: name, id: feature.id }, { partisanLean: lean });
          }
        }
      };
      updatePartisanStates();
      const handleSourceData = (e: any) => { if (e.sourceId === sourceId && e.isSourceLoaded) updatePartisanStates(); };
      map.on('moveend', updatePartisanStates);
      map.on('sourcedata', handleSourceData);
      return () => { map.off('moveend', updatePartisanStates); map.off('sourcedata', handleSourceData); };

    } else if (ETHNICITY_METRICS.includes(districtColorMetric as EthnicityMetric) && visualizationMode !== 'districts') {
      const metric = districtColorMetric as EthnicityMetric;
      const stateKey = `conc_${metric.replace('_pct', '')}`;
      const [stops, zeroGroupColor, zeroPopColor] = ETHNICITY_COLOR_RANGE[metric];
      const ethnicPaint: any = ['case', ['!=', ['feature-state', stateKey], null],
        ['case',
          ['<', ['feature-state', stateKey], 0], zeroPopColor,
          ['==', ['feature-state', stateKey], 0], zeroGroupColor,
          ['interpolate', ['linear'], ['feature-state', stateKey], ...stops.flat()]],
        stops[0][1]];
      for (const name of ALL_LAYERS) {
        if (map.getLayer(`units-${name}-fill`)) map.setPaintProperty(`units-${name}-fill`, 'fill-color', ethnicPaint);
        if (map.getLayer(`units-${name}-line`)) map.setPaintProperty(`units-${name}-line`, 'line-opacity', 0);
      }
      const updateEthnicityStates = () => {
        const metricData = ethnicityDataRef.current[metric];
        if (!metricData) return;
        for (const name of ALL_LAYERS) {
          const fillLayerId = `units-${name}-fill`;
          if (!map.getLayer(fillLayerId)) continue;
          const features = map.queryRenderedFeatures({ layers: [fillLayerId] });
          const indexMap = geoIdByIndexRef.current[name];
          if (!indexMap) continue;
          for (const feature of features) {
            const geoId = indexMap[parseInt(feature.properties?.index)];
            if (!geoId) continue;
            const v = metricData[String(geoId)];
            if (v !== undefined) map.setFeatureState({ source: sourceId, sourceLayer: name, id: feature.id }, { [stateKey]: v });
          }
        }
      };
      updateEthnicityStates();
      const handleSourceData = (e: any) => { if (e.sourceId === sourceId && e.isSourceLoaded) updateEthnicityStates(); };
      map.on('moveend', updateEthnicityStates);
      map.on('sourcedata', handleSourceData);
      return () => { map.off('moveend', updateEthnicityStates); map.off('sourcedata', handleSourceData); };

    } else if (SCALAR_METRICS.includes(districtColorMetric as ScalarMetric) && visualizationMode !== 'districts') {
      const metric = districtColorMetric as ScalarMetric;
      const stateKey = `scalar_${metric}`;
      const ramp = SCALAR_COLOR_RAMPS[metric];
      const scalarPaint: any = ['case', ['!=', ['feature-state', stateKey], null],
        ['case',
          ['<', ['feature-state', stateKey], 0], '#d8d8d8',
          ['interpolate', ['linear'], ['feature-state', stateKey], ...ramp.flat()]],
        '#ffffff'];
      for (const name of ALL_LAYERS) {
        if (map.getLayer(`units-${name}-fill`)) map.setPaintProperty(`units-${name}-fill`, 'fill-color', scalarPaint);
        if (map.getLayer(`units-${name}-line`)) map.setPaintProperty(`units-${name}-line`, 'line-opacity', 0);
      }
      const updateScalarStates = () => {
        const metricData = scalarDataRef.current[metric];
        if (!metricData) return;
        for (const name of ALL_LAYERS) {
          const fillLayerId = `units-${name}-fill`;
          if (!map.getLayer(fillLayerId)) continue;
          const features = map.queryRenderedFeatures({ layers: [fillLayerId] });
          const indexMap = geoIdByIndexRef.current[name];
          if (!indexMap) continue;
          for (const feature of features) {
            const geoId = indexMap[parseInt(feature.properties?.index)];
            if (!geoId) continue;
            const v = metricData[String(geoId)];
            if (v !== undefined) map.setFeatureState({ source: sourceId, sourceLayer: name, id: feature.id }, { [stateKey]: v });
          }
        }
      };
      updateScalarStates();
      const handleSourceData = (e: any) => { if (e.sourceId === sourceId && e.isSourceLoaded) updateScalarStates(); };
      map.on('moveend', updateScalarStates);
      map.on('sourcedata', handleSourceData);
      return () => { map.off('moveend', updateScalarStates); map.off('sourcedata', handleSourceData); };

    } else {
      // Default: gray in district view, district colors in map view
      const paint = visualizationMode === 'districts'
        ? UNIT_GRAY_FILL
        : ['match', ['feature-state', 'district'],
            ...Array.from({ length: 50 }, (_, i) => [i + 1, districtColor(i)]).flat(),
            UNIT_GRAY_FILL];
      for (const name of ALL_LAYERS) {
        if (map.getLayer(`units-${name}-fill`)) map.setPaintProperty(`units-${name}-fill`, 'fill-color', paint);
        if (map.getLayer(`units-${name}-line`)) {
          map.setPaintProperty(`units-${name}-line`, 'line-opacity', name === activeLayerRef.current ? 0.5 : 0);
        }
      }
    }
  }, [visualizationMode, districtColorMetric, mapInitialized, districtGeoJson, sourcesVersion, districtStats, currentLayer]); // eslint-disable-line react-hooks/exhaustive-deps
}
