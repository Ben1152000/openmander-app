import { useEffect, useRef } from 'react';
import type { Map } from 'maplibre-gl';
import type { MutableRefObject } from 'react';
import {
  rampColor,
  partisanStepColor, ETHNICITY_COLOR_RANGE, SCALAR_COLOR_RAMPS, UNIT_GRAY_FILL,
  hexToRgb, ETH_COLORS,
} from '@/app/constants/colors';
import { ETHNICITY_METRICS, ETHNICITY_STAT_KEYS, SCALAR_METRICS, SCALAR_STAT_KEYS, SCALAR_TRANSFORMS, ethCatFromStat } from '@/app/constants/metrics';
import type { DistrictStat, EthnicityMetric, ScalarMetric, EthStatusMetric } from '@/app/constants/metrics';

type ColorMetric = 'default' | 'partisan' | ScalarMetric | EthnicityMetric | EthStatusMetric;
const ALL_LAYERS = ['state', 'county', 'tract', 'group', 'vtd', 'block'];

// Fixed fill-color expression for district polygons — never changes, so MapLibre
// never recompiles the shader when the metric switches. Colors are delivered by
// setFeatureState({ r, g, b }) instead, which is a hash-map lookup at render time.
const DISTRICT_FILL_COLOR_EXPR = [
  'case',
  ['!=', ['feature-state', 'r'], null],
  ['rgb', ['feature-state', 'r'], ['feature-state', 'g'], ['feature-state', 'b']],
  '#888888',
];

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

  // ── District overlay + base layer coloring ───────────────────────────────────
  // Declared first so the district-boundaries source is always added before the
  // feature-state effect below tries to call setFeatureState on it.
  useEffect(() => {
    visualizationModeRef.current = visualizationMode;

    if (!mapRef.current || !mapInitialized || sourcesVersion === 0) return;

    const map = mapRef.current;
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
          paint: { 'fill-color': DISTRICT_FILL_COLOR_EXPR as any, 'fill-opacity': 0.60 } });
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
        // Keep hover layers above district fills so the hover highlight isn't washed out.
        for (const name of ALL_LAYERS) {
          if (map.getLayer(`units-${name}-hover`)) map.moveLayer(`units-${name}-hover`);
        }
        districtLayersAddedRef.current = true;
        districtGeoJsonLoadedRef.current = districtGeoJson;
      } else if (districtGeoJsonLoadedRef.current !== districtGeoJson) {
        (map.getSource(districtSourceId) as any).setData(districtGeoJson);
        districtGeoJsonLoadedRef.current = districtGeoJson;
      }

      if (visualizationMode === 'districts') {
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
    // useMetricFeatureState owns fill-color for non-default metrics; skip here.
    if (districtColorMetric !== 'default') return;
    // District view: gray fills. Map view: transparent (no district colors shown).
    const paint = visualizationMode === 'districts' ? UNIT_GRAY_FILL : 'rgba(0,0,0,0)';
    for (const name of ALL_LAYERS) {
      if (map.getLayer(`units-${name}-fill`)) map.setPaintProperty(`units-${name}-fill`, 'fill-color', paint);
      if (map.getLayer(`units-${name}-line`)) {
        map.setPaintProperty(`units-${name}-line`, 'line-opacity', name === activeLayerRef.current ? 0.5 : 0);
      }
    }
  }, [visualizationMode, districtColorMetric, mapInitialized, districtGeoJson, sourcesVersion, currentLayer]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── District feature-state colors ────────────────────────────────────────────
  // Declared after the overlay effect so the district-boundaries source is guaranteed
  // to exist when this runs. Calls setFeatureState for each district (never
  // setPaintProperty), so MapLibre evaluates the change as a hash-map lookup at
  // render time — same mechanism as unit feature states.
  useEffect(() => {
    if (!mapRef.current || !mapInitialized || sourcesVersion === 0) return;
    if (!districtGeoJson?.features.length) return;
    const map = mapRef.current;
    if (!map.getSource('district-boundaries')) return;

    const statsMap = new Map(districtStats?.map(d => [d.district, d]) ?? []);

    for (const feature of districtGeoJson.features) {
      const district = feature.properties!.district as number;
      let hex: string;

      if (districtColorMetric === 'partisan') {
        hex = partisanStepColor(feature.properties!.partisanLean as number);
      } else if (ETHNICITY_METRICS.includes(districtColorMetric as EthnicityMetric)) {
        const stat = statsMap.get(district);
        if (stat) {
          const metric = districtColorMetric as EthnicityMetric;
          const [stops, zeroGroupColor] = ETHNICITY_COLOR_RANGE[metric];
          const pct = (stat[ETHNICITY_STAT_KEYS[metric]] as number) / 100;
          hex = pct === 0 ? zeroGroupColor : rampColor(pct, stops);
        } else hex = '#888888';
      } else if (SCALAR_METRICS.includes(districtColorMetric as ScalarMetric)) {
        const stat = statsMap.get(district);
        if (stat) {
          const metric = districtColorMetric as ScalarMetric;
          hex = rampColor(SCALAR_TRANSFORMS[metric](stat[SCALAR_STAT_KEYS[metric]] as number), SCALAR_COLOR_RAMPS[metric]);
        } else hex = '#888888';
      } else if (districtColorMetric === 'ethnicity') {
        const stat = statsMap.get(district);
        hex = stat ? ETH_COLORS[ethCatFromStat(stat)] : '#888888';
      } else {
        hex = feature.properties!.color as string;
      }

      const [r, g, b] = hexToRgb(hex);
      map.setFeatureState({ source: 'district-boundaries', id: district }, { r, g, b });
    }
  }, [mapInitialized, sourcesVersion, districtColorMetric, districtGeoJson, districtStats]); // eslint-disable-line react-hooks/exhaustive-deps
}
