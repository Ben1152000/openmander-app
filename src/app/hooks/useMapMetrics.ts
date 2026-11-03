import { useCallback, useRef } from 'react';
import { emptyUnitData, type LayerColumns, type UnitDataStore } from '@/app/lib/unitData';
import type { ReadyPayload } from '@/workers/workerPlan';

/**
 * Holds per-unit data (geo_ids, names, block→parent indices, data columns) received
 * from the plan worker. Everything is indexed by unit index, matching the PMTiles
 * `index` feature property.
 */
export function useMapMetrics() {
  const unitDataRef = useRef<UnitDataStore>(emptyUnitData());
  // Kept as its own ref because painting only needs the geo_id lookup.
  const geoIdByIndexRef = useRef<Record<string, string[]>>({});

  const clearMetrics = useCallback(() => {
    unitDataRef.current = emptyUnitData();
    geoIdByIndexRef.current = {};
  }, []);

  /** Store unit identity data from the worker's 'ready' message. */
  const applyReady = useCallback((payload: ReadyPayload) => {
    unitDataRef.current = {
      ...emptyUnitData(),
      geoIds: payload.geoIdIndex,
      names: payload.unitNames,
      blockParents: payload.blockParents,
      seriesNames: payload.seriesNames,
    };
    geoIdByIndexRef.current = payload.geoIdIndex;
  }, []);

  /** Merge fetched columns and set the active series selection. */
  const applyColumns = useCallback((columns: LayerColumns, electionSeries: string, censusSeries: string) => {
    const store = unitDataRef.current;
    const merged: LayerColumns = { ...store.columns };
    for (const [layer, cols] of Object.entries(columns)) merged[layer] = { ...merged[layer], ...cols };
    unitDataRef.current = { ...store, columns: merged, electionSeries, censusSeries };
  }, []);

  return { unitDataRef, geoIdByIndexRef, clearMetrics, applyReady, applyColumns };
}
