import { useEffect, useRef } from 'react';
import { ETHNICITY_METRICS, ETHNICITY_COLS, SCALAR_METRICS } from '@/app/constants/metrics';
import type { EthnicityMetric, ScalarMetric } from '@/app/constants/metrics';

export function useMapMetrics(packFiles: Record<string, Uint8Array> | undefined) {
  const partisanLeanRef = useRef<Record<string, number>>({});
  const ethnicityDataRef = useRef<Partial<Record<EthnicityMetric, Record<string, number>>>>({});
  const scalarDataRef = useRef<Partial<Record<ScalarMetric, Record<string, number>>>>({});
  const geoIdByIndexRef = useRef<Record<string, Record<number, string>>>({});

  useEffect(() => {
    if (!packFiles) return;

    const allLayers = ['state', 'county', 'tract', 'group', 'vtd', 'block'];
    const leanData: Record<string, number> = {};
    const indexMaps: Record<string, Record<number, string>> = {};
    const scalarRawAll: Record<ScalarMetric, Record<string, number>> = { population_density: {} };

    // Reset ethnicity data
    ethnicityDataRef.current = {};

    for (const layerName of allLayers) {
      const csvFile = packFiles[`data/${layerName}.csv`];
      if (!csvFile) { console.warn(`${layerName} CSV not found`); continue; }

      const lines = new TextDecoder().decode(csvFile).split('\n');
      const headers = lines[0].split(',');

      const col = (name: string) => headers.indexOf(name);
      const idxIdx = col('idx'), geoIdIdx = col('geo_id');
      if (idxIdx === -1 || geoIdIdx === -1) { console.warn(`Required columns missing in ${layerName} CSV`); continue; }

      const demIdx = col('E_20_PRES_Dem'), repIdx = col('E_20_PRES_Rep');
      const censTotalIdx = col('T_20_CENS_Total'), landM2Idx = col('land_m2');
      const ethnicColIdxs = Object.fromEntries(
        ETHNICITY_METRICS.map(m => [m, col(ETHNICITY_COLS[m])])
      ) as Record<EthnicityMetric, number>;

      const ethnicLayerData: Partial<Record<EthnicityMetric, Record<string, number>>> = {};
      for (const m of ETHNICITY_METRICS) {
        if (ethnicColIdxs[m] !== -1 && censTotalIdx !== -1) ethnicLayerData[m] = {};
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
          const pop = parseFloat(cols[censTotalIdx]) || 0;
          const land = landM2Idx !== -1 ? (parseFloat(cols[landM2Idx]) || 0) : 0;
          scalarRawAll.population_density[geoId] = pop > 0 && land > 0 ? pop / (land / 1e6) : -1;
          for (const m of ETHNICITY_METRICS) {
            const ci = ethnicColIdxs[m];
            if (ci !== -1 && ethnicLayerData[m]) {
              ethnicLayerData[m]![geoId] = pop > 0 ? (parseFloat(cols[ci]) || 0) / pop : -1;
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

    for (const m of SCALAR_METRICS) {
      scalarDataRef.current[m] = {};
      for (const [geoId, v] of Object.entries(scalarRawAll[m])) {
        scalarDataRef.current[m]![geoId] = v < 0 ? -1 : Math.log1p(v);
      }
    }

    partisanLeanRef.current = leanData;
    geoIdByIndexRef.current = indexMaps;
  }, [packFiles]);

  return { partisanLeanRef, ethnicityDataRef, scalarDataRef, geoIdByIndexRef };
}
