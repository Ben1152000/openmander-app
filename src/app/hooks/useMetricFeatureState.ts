/**
 * useMetricFeatureState — native MapLibre feature-state visualization.
 *
 * Both rendering strategies share the same feature-state based fill expression:
 *
 * Non-block layers (county, VTD, etc.):
 *   Calls setFeatureState for every feature in the layer upfront (county: ~100,
 *   VTD: ~thousands). promoteId: 'index' ensures states persist across tile
 *   eviction/reload, so panning to new areas picks them up automatically — no
 *   event listeners or queryRenderedFeatures needed.
 *
 * Block layer:
 *   Too many features to set all states upfront, so uses queryRenderedFeatures
 *   for visible features and listens on 'idle' (fires once MapLibre fully settles)
 *   to re-apply states after panning loads new tiles.
 */

import { useEffect } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import type { MutableRefObject } from 'react';
import {
  PARTISAN_UNIT_RAMP, ETHNICITY_COLOR_RANGE, SCALAR_COLOR_RAMPS,
  ETH_COLOR_EXPR, OUTLINE_OPACITY,
} from '@/app/constants/colors';
import { midZoomLayer } from '@/app/constants/config';
import { ETHNICITY_METRICS, SCALAR_METRICS, NON_WHITE_GROUPS, ethCatFromPcts } from '@/app/constants/metrics';
import type { EthnicityMetric, ScalarMetric, EthStatusMetric } from '@/app/constants/metrics';

type ColorMetric = 'partisan' | ScalarMetric | EthnicityMetric | EthStatusMetric;

function ethCatFor(geoId: string, ed: Partial<Record<EthnicityMetric, Record<string, number>>>): number {
  const white = ed['white_pct']?.[geoId] ?? -1;
  const nwPcts = NON_WHITE_GROUPS.map(({ key }) => ed[key]?.[geoId] ?? -1);
  return ethCatFromPcts(white, nwPcts);
}

const ALL_LAYERS = ['state', 'county', 'tract', 'group', 'vtd', 'block'];

// ─────────────────────────────────────────────────────────────────────────────

export function useMetricFeatureState(params: {
  mapRef: MutableRefObject<MaplibreMap | null>;
  mapInitialized: boolean;
  sourcesVersion: number;
  visualizationMode: 'districts' | 'map';
  districtColorMetric: ColorMetric;
  currentLayer: string;
  blockAssignmentsRef: MutableRefObject<Uint32Array | null>;
  geoIdByIndexRef: MutableRefObject<Record<string, Record<number, string>>>;
  parentBlockIndicesRef: MutableRefObject<Record<string, Record<string, number[]>>>;
  partisanLeanRef: MutableRefObject<Record<string, number>>;
  ethnicityDataRef: MutableRefObject<Partial<Record<EthnicityMetric, Record<string, number>>>>;
  scalarDataRef: MutableRefObject<Partial<Record<ScalarMetric, Record<string, number>>>>;
  hasVtd: boolean;
  showOutlinesRef: MutableRefObject<boolean>;
  /** Ref to receive a direct-call trigger. Set by this hook; caller invokes it after assignments change. */
  updateTriggerRef?: MutableRefObject<(() => void) | null>;
}) {
  const {
    mapRef, mapInitialized, sourcesVersion, visualizationMode, districtColorMetric, currentLayer,
    blockAssignmentsRef, geoIdByIndexRef, parentBlockIndicesRef,
    partisanLeanRef, ethnicityDataRef, scalarDataRef, hasVtd, showOutlinesRef, updateTriggerRef,
  } = params;

  const isDistrictView = visualizationMode === 'districts';
  const isBlockLayer = currentLayer === 'block';

  useEffect(() => {
    if (!mapRef.current || !mapInitialized || sourcesVersion === 0) return;
    const map = mapRef.current;
    const sourceId = 'units-all';
    const fillLayerId = `units-${currentLayer}-fill`;
    if (!map.getLayer(fillLayerId)) return;

    // ── Build parent district map for coarser layers ──────────────────────────
    // O(numParentFeatures): looks up one representative block index per parent
    // unit (precomputed in metricsWorker) rather than iterating all blocks.

    const buildParentMap = (data: Uint32Array, layer: string): Map<string, number> => {
      const allBlocks = parentBlockIndicesRef.current[layer];
      if (!allBlocks) return new Map();
      const newMap = new Map<string, number>();
      for (const [parentGeoId, blockIndices] of Object.entries(allBlocks)) {
        for (const blockIdx of blockIndices) {
          const district = data[blockIdx];
          if (district) { newMap.set(parentGeoId, district); break; }
        }
      }
      return newMap;
    };

    // Layers that are always preloaded (visibility:visible, opacity:0 when inactive).
    // Keep their fill expressions and feature states in sync even when not active,
    // so there's no flash when auto-switching to them.
    const ALWAYS_PRELOADED = ['county', midZoomLayer(hasVtd)];

    // ── Shared: feature-state fill expression ─────────────────────────────────

    let metricStateKey: string;
    let metricExpr: any;

    if (districtColorMetric === 'partisan') {
      metricStateKey = 'partisanLean';
      metricExpr = [
        'case',
        ['==', ['feature-state', 'partisanLean'], null], '#e8e8e8',
        ['<',  ['feature-state', 'partisanLean'], -1.5], '#d8d8d8',
        ['interpolate', ['linear'], ['feature-state', 'partisanLean'],
          ...PARTISAN_UNIT_RAMP.flatMap(([val, color]) => [val, color])],
      ];
    } else if (ETHNICITY_METRICS.includes(districtColorMetric as EthnicityMetric)) {
      const metric = districtColorMetric as EthnicityMetric;
      metricStateKey = `conc_${metric.replace('_pct', '')}`;
      const [stops, zeroGroupColor, zeroPopColor] = ETHNICITY_COLOR_RANGE[metric];
      metricExpr = [
        'case', ['!=', ['feature-state', metricStateKey], null],
        ['case',
          ['<',  ['feature-state', metricStateKey], 0], zeroPopColor,
          ['==', ['feature-state', metricStateKey], 0], zeroGroupColor,
          ['interpolate', ['linear'], ['feature-state', metricStateKey], ...stops.flat()]],
        stops[0][1],
      ];
    } else if (districtColorMetric === 'ethnicity') {
      metricStateKey = 'eth_cat';
      metricExpr = ETH_COLOR_EXPR;
    } else {
      const metric = districtColorMetric as ScalarMetric;
      metricStateKey = `scalar_${metric}`;
      const ramp = SCALAR_COLOR_RAMPS[metric];
      metricExpr = [
        'case', ['!=', ['feature-state', metricStateKey], null],
        ['case',
          ['<', ['feature-state', metricStateKey], 0], '#d8d8d8',
          ['interpolate', ['linear'], ['feature-state', metricStateKey], ...ramp.flat()]],
        '#ffffff',
      ];
    }

    const fillColor = isDistrictView
      ? ['case', ['>', ['coalesce', ['feature-state', 'district'], 0], 0], 'rgba(0,0,0,0)', metricExpr]
      : metricExpr;

    // ── Non-block: set states for all features upfront ────────────────────────
    // Feature count is small (county: ~100, VTD: ~thousands). promoteId ensures
    // states persist across tile eviction so no sourcedata listener is needed.
    // Both updateStates and applyFill run synchronously (no RAF) so transitions
    // are instantaneous — states are written before the expression switches,
    // eliminating any flash of default colors between metric/view changes.

    if (!isBlockLayer) {
      const applyFill = () => {
        // Update fill expression for active layer + all always-preloaded layers so
        // switching back to them never shows a stale expression for one frame.
        const layersToSync = new Set([currentLayer, ...ALWAYS_PRELOADED]);
        for (const name of layersToSync) {
          if (map.getLayer(`units-${name}-fill`)) map.setPaintProperty(`units-${name}-fill`, 'fill-color', fillColor);
        }
        for (const name of ALL_LAYERS) {
          if (map.getLayer(`units-${name}-line`)) {
            const opacity = name === currentLayer && showOutlinesRef.current ? OUTLINE_OPACITY : 0;
            map.setPaintProperty(`units-${name}-line`, 'line-opacity', opacity);
          }
        }
      };

      const updateLayerStates = (layerName: string) => {
        const data = blockAssignmentsRef.current;
        const indexMap = geoIdByIndexRef.current[layerName] ?? {};
        const parentMap = isDistrictView && data ? buildParentMap(data, layerName) : new Map<string, number>();
        for (const [indexStr, geoId] of Object.entries(indexMap)) {
          if (!geoId) continue;
          const featureIndex = parseInt(indexStr);
          const district = parentMap.get(geoId) ?? 0;
          const stateUpdate: Record<string, number> = { district };
          if (districtColorMetric === 'partisan') {
            const lean = partisanLeanRef.current[geoId];
            if (lean !== undefined) stateUpdate[metricStateKey] = lean;
          } else if (ETHNICITY_METRICS.includes(districtColorMetric as EthnicityMetric)) {
            const v = ethnicityDataRef.current[districtColorMetric as EthnicityMetric]?.[geoId];
            if (v !== undefined) stateUpdate[metricStateKey] = v;
          } else if (districtColorMetric === 'ethnicity') {
            stateUpdate[metricStateKey] = ethCatFor(geoId, ethnicityDataRef.current);
          } else if (SCALAR_METRICS.includes(districtColorMetric as ScalarMetric)) {
            const v = scalarDataRef.current[districtColorMetric as ScalarMetric]?.[geoId];
            if (v !== undefined) stateUpdate[metricStateKey] = v;
          }
          map.setFeatureState({ source: sourceId, sourceLayer: layerName, id: featureIndex }, stateUpdate);
        }
      };

      const updateStates = () => {
        const layersToSync = new Set([currentLayer, ...ALWAYS_PRELOADED]);
        for (const layer of layersToSync) updateLayerStates(layer);
      };

      // States before expression: the new fill expression lands on already-correct data.
      updateStates();
      applyFill();

      // The trigger ref is called from painting (not from this effect). Defer to the next
      // animation frame so rapid paint events don't block the main thread. Multiple calls
      // before the frame fires are coalesced into a single update.
      let pendingRaf: number | null = null;
      if (updateTriggerRef) {
        updateTriggerRef.current = () => {
          if (pendingRaf !== null) cancelAnimationFrame(pendingRaf);
          pendingRaf = requestAnimationFrame(() => { pendingRaf = null; updateStates(); });
        };
      }

      return () => {
        if (pendingRaf !== null) cancelAnimationFrame(pendingRaf);
        if (updateTriggerRef) updateTriggerRef.current = null;
      };
    }

    // ── Block layer: queryRenderedFeatures (too many blocks to set all upfront) ──

    const applyFill = () => {
      for (const name of ALL_LAYERS) {
        if (map.getLayer(`units-${name}-fill`)) map.setPaintProperty(`units-${name}-fill`, 'fill-color', fillColor);
        if (map.getLayer(`units-${name}-line`)) {
          const opacity = name === currentLayer && showOutlinesRef.current ? OUTLINE_OPACITY : 0;
          map.setPaintProperty(`units-${name}-line`, 'line-opacity', opacity);
        }
      }
    };

    const updateStates = () => {
      if (!map.getLayer(fillLayerId)) return;
      const data = blockAssignmentsRef.current;
      const indexMap = geoIdByIndexRef.current['block'] ?? {};
      const features = map.queryRenderedFeatures({ layers: [fillLayerId] });
      for (const feature of features) {
        const featureIndex = parseInt(feature.properties?.index);
        const geoId = indexMap[featureIndex];
        if (!geoId) continue;
        const district = data ? (data[featureIndex] ?? 0) : 0;
        const stateUpdate: Record<string, number> = { district };
        if (districtColorMetric === 'partisan') {
          const lean = partisanLeanRef.current[geoId];
          if (lean !== undefined) stateUpdate[metricStateKey] = lean;
        } else if (ETHNICITY_METRICS.includes(districtColorMetric as EthnicityMetric)) {
          const v = ethnicityDataRef.current[districtColorMetric as EthnicityMetric]?.[geoId];
          if (v !== undefined) stateUpdate[metricStateKey] = v;
        } else if (districtColorMetric === 'ethnicity') {
          stateUpdate[metricStateKey] = ethCatFor(geoId, ethnicityDataRef.current);
        } else if (SCALAR_METRICS.includes(districtColorMetric as ScalarMetric)) {
          const v = scalarDataRef.current[districtColorMetric as ScalarMetric]?.[geoId];
          if (v !== undefined) stateUpdate[metricStateKey] = v;
        }
        map.setFeatureState({ source: sourceId, sourceLayer: 'block', id: featureIndex }, stateUpdate);
      }
    };

    updateStates();
    applyFill();

    let pendingRaf: number | null = null;
    if (updateTriggerRef) {
      updateTriggerRef.current = () => {
        if (pendingRaf !== null) cancelAnimationFrame(pendingRaf);
        pendingRaf = requestAnimationFrame(() => { pendingRaf = null; updateStates(); });
      };
    }

    map.on('idle', updateStates);

    return () => {
      map.off('idle', updateStates);
      if (pendingRaf !== null) cancelAnimationFrame(pendingRaf);
      if (updateTriggerRef) updateTriggerRef.current = null;
    };
  }, [mapInitialized, sourcesVersion, visualizationMode, districtColorMetric, currentLayer]); // eslint-disable-line react-hooks/exhaustive-deps
}
