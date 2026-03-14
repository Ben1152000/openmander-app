// One-shot worker: receives packFiles, parses CSV metrics, posts result and exits.
//
// Messages in:
//   { type: 'parse', packFiles: Record<string, Uint8Array> }
//
// Messages out:
//   { type: 'metrics', partisanLean, geoIdByIndex, scalarData, ethnicityData }

import { ETHNICITY_METRICS, ETHNICITY_COLS, SCALAR_METRICS } from './app/constants/metrics';
import type { EthnicityMetric, ScalarMetric } from './app/constants/metrics';

self.onmessage = (e: MessageEvent) => {
  const { packFiles } = e.data as { packFiles: Record<string, Uint8Array> };

  const allLayers = ['state', 'county', 'tract', 'group', 'vtd', 'block'];
  const partisanLean: Record<string, number> = {};
  const geoIdByIndex: Record<string, Record<number, string>> = {};
  const scalarData: Partial<Record<ScalarMetric, Record<string, number>>> = {};
  const ethnicityData: Partial<Record<EthnicityMetric, Record<string, number>>> = {};

  for (const m of SCALAR_METRICS) scalarData[m] = {};
  for (const m of ETHNICITY_METRICS) ethnicityData[m] = {};

  for (const layerName of allLayers) {
    const csvFile = packFiles[`data/${layerName}.csv`];
    if (!csvFile) continue;

    const lines = new TextDecoder().decode(csvFile).split('\n');
    const headers = lines[0].split(',');
    const col = (name: string) => headers.indexOf(name);

    const idxIdx = col('idx'), geoIdIdx = col('geo_id');
    if (idxIdx === -1 || geoIdIdx === -1) continue;

    const demIdx = col('E_20_PRES_Dem'), repIdx = col('E_20_PRES_Rep');
    const censTotalIdx = col('T_20_CENS_Total'), landM2Idx = col('land_m2');
    const ethnicColIdxs = Object.fromEntries(
      ETHNICITY_METRICS.map(m => [m, col(ETHNICITY_COLS[m])])
    ) as Record<EthnicityMetric, number>;

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
        partisanLean[geoId] = -2;
      } else if (demIdx !== -1 && repIdx !== -1) {
        const dem = parseFloat(cols[demIdx]) || 0;
        const rep = parseFloat(cols[repIdx]) || 0;
        const total = dem + rep;
        if (total > 0) partisanLean[geoId] = (dem - rep) / total;
      }

      if (censTotalIdx !== -1) {
        const pop = parseFloat(cols[censTotalIdx]) || 0;
        const land = landM2Idx !== -1 ? (parseFloat(cols[landM2Idx]) || 0) : 0;
        scalarData['population_density']![geoId] = pop > 0 && land > 0 ? Math.log1p(pop / (land / 1e6)) : -1;
        for (const m of ETHNICITY_METRICS) {
          const ci = ethnicColIdxs[m];
          if (ci !== -1) ethnicityData[m]![geoId] = pop > 0 ? (parseFloat(cols[ci]) || 0) / pop : -1;
        }
      }
    }
    geoIdByIndex[layerName] = indexToGeoId;
  }

  (self as any).postMessage({ type: 'metrics', partisanLean, geoIdByIndex, scalarData, ethnicityData });
};
