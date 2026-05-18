// One-shot worker: receives packFiles, parses CSV metrics, posts result and exits.
//
// Messages in:
//   { type: 'parse', packFiles: Record<string, Uint8Array>, electionSeries?: string, censusSeries?: string }
//
// Messages out:
//   { type: 'metrics', partisanLean, geoIdByIndex, scalarData, ethnicityData, ...,
//     availableElections, availableCensus }

import { ETHNICITY_METRICS, ETHNICITY_COLS, SCALAR_METRICS, SCALAR_TRANSFORMS } from '../app/constants/metrics';
import type { EthnicityMetric, ScalarMetric } from '../app/constants/metrics';

/** Parse a single CSV line, respecting RFC 4180 double-quote escaping. */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } // escaped quote
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function electionSeriesLabel(series: string): string {
  const m = series.match(/^E_(\d\d)_(\w+)$/);
  if (!m) return series;
  const year = 2000 + parseInt(m[1]);
  const types: Record<string, string> = { PRES: 'Presidential', SEN: 'Senate', GOV: 'Governor', HOUSE: 'House' };
  return `${year} ${types[m[2]] ?? m[2]}`;
}

function censusSeriesLabel(series: string): string {
  const m = series.match(/^T_(\d\d)_CENS$/);
  if (!m) return series;
  return `${2000 + parseInt(m[1])} Census`;
}

self.onmessage = (e: MessageEvent) => {
  const { packFiles, electionSeries: inputElection, censusSeries: inputCensus } =
    e.data as { packFiles: Record<string, Uint8Array>; electionSeries?: string; censusSeries?: string };

  const electionSeries = inputElection ?? 'E_20_PRES';
  const censusSeries   = inputCensus  ?? 'T_20_CENS';

  const allLayers = ['state', 'county', 'tract', 'group', 'vtd', 'block'];
  const partisanLean: Record<string, number> = {};
  const geoIdByIndex: Record<string, Record<number, string>> = {};
  const scalarData: Partial<Record<ScalarMetric, Record<string, number>>> = {};
  const ethnicityData: Partial<Record<EthnicityMetric, Record<string, number>>> = {};
  // Maps each block geoId → its parent geoId at each coarser layer.
  const blockToParents: Record<string, { county: string; vtd: string; tract: string; group: string }> = {};
  // Maps each coarser layer → parentGeoId → all block indices belonging to that parent.
  const parentBlockIndices: Record<string, Record<string, number[]>> = { county: {}, vtd: {}, tract: {}, group: {} };
  // Human-readable unit names (layer → geoId → name) for the pointer tool tooltip.
  const unitNames: Record<string, Record<string, string>> = {};
  // Raw census population (geoId → count).
  const unitPopulation: Record<string, number> = {};
  // Raw election vote counts (geoId → { dem, rep, total }).
  const unitElectionVotes: Record<string, { dem: number; rep: number; total: number }> = {};
  // Raw ethnic counts per metric (same shape as ethnicityData but raw counts, not fractions).
  const unitEthnicCounts: Partial<Record<EthnicityMetric, Record<string, number>>> = {};
  // Land area in km² per geoId.
  const unitLandKm2: Record<string, number> = {};
  // Voting age population per geoId.
  const unitVap: Record<string, number> = {};
  // Human-readable election/census names.
  let electionName = '';
  let censusName = '';

  // Available series detected from headers (populated on first layer).
  let availableElections: { series: string; label: string }[] = [];
  let availableCensus: { series: string; label: string }[] = [];
  let seriesDetected = false;

  for (const m of SCALAR_METRICS) scalarData[m] = {};
  for (const m of ETHNICITY_METRICS) { ethnicityData[m] = {}; unitEthnicCounts[m] = {}; }

  // Derive column names from selected series.
  const electionDemCol   = `${electionSeries}_Dem`;
  const electionRepCol   = `${electionSeries}_Rep`;
  const electionTotalCol = `${electionSeries}_Total`;
  const censTotalCol     = `${censusSeries}_Total`;
  const vapYear = censusSeries.match(/^T_(\d\d)_CENS$/)?.[1] ?? '20';
  const vapCol  = `V_${vapYear}_VAP_Total`;

  for (const layerName of allLayers) {
    const csvFile = packFiles[`data/${layerName}.csv`];
    if (!csvFile) continue;

    const lines = new TextDecoder().decode(csvFile).split('\n');
    const headers = lines[0].split(','); // header row has no quoted fields
    const col = (name: string) => headers.indexOf(name);

    // Detect available series from headers (once, on first layer).
    if (!seriesDetected) {
      seriesDetected = true;
      const elSet = new Set<string>();
      const cSet  = new Set<string>();
      for (const h of headers) {
        const em = h.match(/^E_(\d\d)_(\w+)_Dem$/);
        if (em) elSet.add(`E_${em[1]}_${em[2]}`);
        const cm = h.match(/^T_(\d\d)_CENS_Total$/);
        if (cm) cSet.add(`T_${cm[1]}_CENS`);
      }
      availableElections = [...elSet].map(s => ({ series: s, label: electionSeriesLabel(s) }));
      availableCensus    = [...cSet].map(s => ({ series: s, label: censusSeriesLabel(s) }));
    }

    const idxIdx = col('idx'), geoIdIdx = col('geo_id');
    if (geoIdIdx === -1) continue;
    const useRowAsIdx = idxIdx === -1; // packs without an explicit idx column use row position

    const demIdx       = col(electionDemCol);
    const repIdx       = col(electionRepCol);
    const presTotalIdx = col(electionTotalCol);
    const vapIdx       = col(vapCol);
    const censTotalIdx = col(censTotalCol);
    const landM2Idx    = col('land_m2');
    const nameIdx      = col('name');

    if (!electionName && demIdx !== -1) electionName = electionSeriesLabel(electionSeries);
    if (!censusName) censusName = censusSeriesLabel(censusSeries);

    unitNames[layerName] = {};

    // Build ethnicity column indices using the selected census series.
    const ethnicColIdxs = Object.fromEntries(
      ETHNICITY_METRICS.map(m => {
        const colName = ETHNICITY_COLS[m].replace('T_20_CENS', censusSeries);
        return [m, col(colName)];
      })
    ) as Record<EthnicityMetric, number>;

    // Parent geoId columns — only present on the block layer
    const parentCountyIdx = col('parent_county');
    const parentVtdIdx    = col('parent_vtd');
    const parentTractIdx  = col('parent_tract');
    const parentGroupIdx  = col('parent_group');
    const isBlockLayer = layerName === 'block';

    const indexToGeoId: Record<number, string> = {};

    let rowIdx = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = parseCSVLine(line);
      const idx = useRowAsIdx ? rowIdx++ : parseInt(cols[idxIdx]);
      const geoId = cols[geoIdIdx];
      indexToGeoId[idx] = geoId;
      if (nameIdx !== -1 && cols[nameIdx]) unitNames[layerName][geoId] = cols[nameIdx];

      if (isBlockLayer && parentCountyIdx !== -1) {
        blockToParents[geoId] = {
          county: cols[parentCountyIdx] ?? '',
          vtd:    parentVtdIdx   !== -1 ? (cols[parentVtdIdx]   ?? '') : '',
          tract:  parentTractIdx !== -1 ? (cols[parentTractIdx]  ?? '') : '',
          group:  parentGroupIdx !== -1 ? (cols[parentGroupIdx]  ?? '') : '',
        };
        const blockIdx = idx;
        for (const layer of ['county', 'vtd', 'tract', 'group'] as const) {
          const parentGeoId = blockToParents[geoId][layer];
          if (parentGeoId) {
            if (!parentBlockIndices[layer][parentGeoId]) parentBlockIndices[layer][parentGeoId] = [];
            parentBlockIndices[layer][parentGeoId].push(blockIdx);
          }
        }
      }

      const censTotal = censTotalIdx !== -1 ? (parseFloat(cols[censTotalIdx]) || 0) : -1;
      if (censTotalIdx !== -1) unitPopulation[geoId] = censTotal >= 0 ? censTotal : 0;

      let presTotal = 0;
      if (censTotal === 0) {
        partisanLean[geoId] = -2;
      } else if (demIdx !== -1 && repIdx !== -1) {
        const dem = parseFloat(cols[demIdx]) || 0;
        const rep = parseFloat(cols[repIdx]) || 0;
        const total = dem + rep;
        if (total > 0) partisanLean[geoId] = (dem - rep) / total;
        presTotal = presTotalIdx !== -1 ? (parseFloat(cols[presTotalIdx]) || 0) : dem + rep;
        unitElectionVotes[geoId] = { dem, rep, total: presTotal };
      }

      if (censTotalIdx !== -1) {
        const pop = parseFloat(cols[censTotalIdx]) || 0;
        const landM2 = landM2Idx !== -1 ? (parseFloat(cols[landM2Idx]) || 0) : 0;
        const landKm2 = landM2 / 1e6;
        if (landM2Idx !== -1) unitLandKm2[geoId] = landKm2;
        scalarData['population_density']![geoId] = pop > 0 && landKm2 > 0
          ? SCALAR_TRANSFORMS['population_density'](pop / landKm2) : -1;
        const vap = vapIdx !== -1 ? (parseFloat(cols[vapIdx]) || 0) : 0;
        scalarData['turnout']![geoId] = vap > 0 ? presTotal / vap : -1;
        if (vapIdx !== -1) unitVap[geoId] = vap;
        for (const m of ETHNICITY_METRICS) {
          const ci = ethnicColIdxs[m];
          if (ci !== -1) {
            const count = parseFloat(cols[ci]) || 0;
            ethnicityData[m]![geoId] = pop > 0 ? count / pop : -1;
            unitEthnicCounts[m]![geoId] = count;
          }
        }
      }
    }
    geoIdByIndex[layerName] = indexToGeoId;
  }

  (self as any).postMessage({
    type: 'metrics',
    partisanLean, geoIdByIndex, scalarData, ethnicityData,
    blockToParents, parentBlockIndices,
    unitNames, unitPopulation, unitElectionVotes, unitEthnicCounts, unitLandKm2, unitVap,
    electionName, censusName,
    availableElections, availableCensus,
  });
};
