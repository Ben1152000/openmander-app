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
import { ETHNICITY_METRICS } from '@/app/constants/metrics';
import type { EthnicityMetric, ScalarMetric, EthStatusMetric } from '@/app/constants/metrics';
import {
  unitValues, partisanLean, ethnicityPct, ethnicityCategory, scalarValue, parentDistricts,
  type UnitDataStore,
} from '@/app/lib/unitData';

type ColorMetric = 'partisan' | ScalarMetric | EthnicityMetric | EthStatusMetric;

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
  unitDataRef: MutableRefObject<UnitDataStore>;
  hasVtd: boolean;
  showOutlinesRef: MutableRefObject<boolean>;
  /** Ref to receive a direct-call trigger. Set by this hook; caller invokes it after assignments change. */
  updateTriggerRef?: MutableRefObject<(() => void) | null>;
}) {
  const {
    mapRef, mapInitialized, sourcesVersion, visualizationMode, districtColorMetric, currentLayer,
    blockAssignmentsRef, unitDataRef, hasVtd, showOutlinesRef, updateTriggerRef,
  } = params;

  const isDistrictView = visualizationMode === 'districts';
  const isBlockLayer = currentLayer === 'block';

  useEffect(() => {
    if (!mapRef.current || !mapInitialized || sourcesVersion === 0) return;
    const map = mapRef.current;
    const sourceId = 'units-all';
    const fillLayerId = `units-${currentLayer}-fill`;
    if (!map.getLayer(fillLayerId)) return;

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

    // Metric feature-state value for one unit (omitted when the data is unavailable).
    const setMetricState = (stateUpdate: Record<string, number>, layer: string, index: number) => {
      const v = unitValues(unitDataRef.current, layer, index);
      let value: number | undefined;
      if (districtColorMetric === 'partisan') value = partisanLean(v);
      else if (ETHNICITY_METRICS.includes(districtColorMetric as EthnicityMetric)) value = ethnicityPct(v, districtColorMetric as EthnicityMetric);
      else if (districtColorMetric === 'ethnicity') value = ethnicityCategory(v);
      else value = scalarValue(v, districtColorMetric as ScalarMetric);
      if (value !== undefined) stateUpdate[metricStateKey] = value;
    };

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
        const count = unitDataRef.current.geoIds[layerName]?.length ?? 0;
        const districts = isDistrictView && data ? parentDistricts(unitDataRef.current, layerName, data) : null;
        for (let featureIndex = 0; featureIndex < count; featureIndex++) {
          const stateUpdate: Record<string, number> = { district: districts?.[featureIndex] ?? 0 };
          setMetricState(stateUpdate, layerName, featureIndex);
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
      const count = unitDataRef.current.geoIds['block']?.length ?? 0;
      const features = map.queryRenderedFeatures({ layers: [fillLayerId] });
      for (const feature of features) {
        const featureIndex = parseInt(feature.properties?.index);
        if (!(featureIndex >= 0 && featureIndex < count)) continue;
        const district = data ? (data[featureIndex] ?? 0) : 0;
        const stateUpdate: Record<string, number> = { district };
        setMetricState(stateUpdate, 'block', featureIndex);
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
