// Per-unit data for map coloring and tooltips, indexed by unit index (the PMTiles
// `index` feature property, which is also the WASM row index for each layer).
//
// Columns are fetched from the plan worker on demand (WasmMap already parsed the
// pack), so the main thread never parses CSVs or builds geoId-keyed objects.

import { ETHNICITY_COLS, ETHNICITY_METRICS, NON_WHITE_GROUPS, SCALAR_TRANSFORMS, ethCatFromPcts } from '@/app/constants/metrics';
import type { EthnicityMetric, ScalarMetric } from '@/app/constants/metrics';

/** layer → series → values (index-aligned with the layer's units). */
export type LayerColumns = Record<string, Record<string, Float64Array>>;

export type UnitDataStore = {
  /** layer → geo_id per unit index. */
  geoIds: Record<string, string[]>;
  /** layer → human-readable name per unit index. */
  names: Record<string, string[]>;
  /** parent layer → (block index → parent unit index, 0xFFFFFFFF if none). */
  blockParents: Record<string, Uint32Array>;
  /** Numeric series available in the pack (block layer). */
  seriesNames: string[];
  columns: LayerColumns;
  electionSeries: string;
  censusSeries: string;
};

export const NO_PARENT = 0xFFFFFFFF;

export function emptyUnitData(): UnitDataStore {
  return { geoIds: {}, names: {}, blockParents: {}, seriesNames: [], columns: {}, electionSeries: 'E_20_PRES', censusSeries: 'T_20_CENS' };
}

// ── Series naming ──────────────────────────────────────────────────────────────

export function electionSeriesLabel(series: string): string {
  const m = series.match(/^E_(\d\d)_(\w+)$/);
  if (!m) return series;
  const year = 2000 + parseInt(m[1]);
  const types: Record<string, string> = { PRES: 'Presidential', SEN: 'Senate', GOV: 'Governor', HOUSE: 'House' };
  return `${year} ${types[m[2]] ?? m[2]}`;
}

export function censusSeriesLabel(series: string): string {
  const m = series.match(/^T_(\d\d)_CENS$/);
  if (!m) return series;
  return `${2000 + parseInt(m[1])} Census`;
}

/** Election and census series detected from the pack's column names. */
export function availableSeries(seriesNames: string[]) {
  const elections = new Set<string>();
  const census = new Set<string>();
  for (const name of seriesNames) {
    const em = name.match(/^E_(\d\d)_(\w+)_Dem$/);
    if (em) elections.add(`E_${em[1]}_${em[2]}`);
    const cm = name.match(/^T_(\d\d)_CENS_Total$/);
    if (cm) census.add(`T_${cm[1]}_CENS`);
  }
  return {
    elections: [...elections].map(s => ({ series: s, label: electionSeriesLabel(s) })),
    census: [...census].map(s => ({ series: s, label: censusSeriesLabel(s) })),
  };
}

function vapColumn(censusSeries: string): string {
  const year = censusSeries.match(/^T_(\d\d)_CENS$/)?.[1] ?? '20';
  return `V_${year}_VAP_Total`;
}

function ethnicityColumn(metric: EthnicityMetric, censusSeries: string): string {
  return ETHNICITY_COLS[metric].replace('T_20_CENS', censusSeries);
}

/** Every column needed to color and describe units for the given series selection. */
export function columnsFor(electionSeries: string, censusSeries: string): string[] {
  return [
    `${electionSeries}_Dem`, `${electionSeries}_Rep`, `${electionSeries}_Total`,
    `${censusSeries}_Total`, ...ETHNICITY_METRICS.map(m => ethnicityColumn(m, censusSeries)),
    vapColumn(censusSeries), 'land_m2',
  ];
}

// ── Per-unit values ────────────────────────────────────────────────────────────

/** Raw per-unit values for the current series selection. `undefined` = column not in pack. */
export type UnitValues = {
  population?: number;
  dem?: number;
  rep?: number;
  /** All votes cast (falls back to dem + rep when the pack has no _Total column). */
  votes?: number;
  vap?: number;
  landKm2?: number;
  ethnicCounts: Partial<Record<EthnicityMetric, number>>;
};

export function unitValues(store: UnitDataStore, layer: string, index: number): UnitValues {
  const cols = store.columns[layer] ?? {};
  const get = (series: string) => cols[series]?.[index];
  const { electionSeries: e, censusSeries: c } = store;

  const dem = get(`${e}_Dem`);
  const rep = get(`${e}_Rep`);
  const land = get('land_m2');
  const ethnicCounts: Partial<Record<EthnicityMetric, number>> = {};
  for (const m of ETHNICITY_METRICS) {
    const v = get(ethnicityColumn(m, c));
    if (v !== undefined) ethnicCounts[m] = v;
  }
  return {
    population: get(`${c}_Total`),
    dem, rep,
    votes: get(`${e}_Total`) ?? (dem !== undefined && rep !== undefined ? dem + rep : undefined),
    vap: get(vapColumn(c)),
    landKm2: land !== undefined ? land / 1e6 : undefined,
    ethnicCounts,
  };
}

/** Two-party lean in [-1, 1]; -2 for zero-population units; undefined if no votes. */
export function partisanLean(v: UnitValues): number | undefined {
  if (v.population === 0) return -2;
  if (v.dem === undefined || v.rep === undefined) return undefined;
  const total = v.dem + v.rep;
  return total > 0 ? (v.dem - v.rep) / total : undefined;
}

/** Group share of population (0–1), or -1 for zero-population units. */
export function ethnicityPct(v: UnitValues, metric: EthnicityMetric): number | undefined {
  const count = v.ethnicCounts[metric];
  if (count === undefined || v.population === undefined) return undefined;
  return v.population > 0 ? count / v.population : -1;
}

export function ethnicityCategory(v: UnitValues): number {
  const pct = (m: EthnicityMetric) => ethnicityPct(v, m) ?? -1;
  return ethCatFromPcts(pct('white_pct'), NON_WHITE_GROUPS.map(({ key }) => pct(key)));
}

/** Transformed scalar metric value for coloring, or -1 when undefined for this unit. */
export function scalarValue(v: UnitValues, metric: ScalarMetric): number | undefined {
  if (v.population === undefined) return undefined;
  if (metric === 'population_density') {
    const pop = v.population, land = v.landKm2 ?? 0;
    return pop > 0 && land > 0 ? SCALAR_TRANSFORMS.population_density(pop / land) : -1;
  }
  const vap = v.vap ?? 0;
  return vap > 0 ? (v.votes ?? 0) / vap : -1;
}

// ── District assignment of coarser units ──────────────────────────────────────

/**
 * District of each unit in `layer`, taken from the first assigned block inside it
 * (0 = no assigned blocks). One O(numBlocks) pass over typed arrays.
 */
export function parentDistricts(store: UnitDataStore, layer: string, blockAssignments: Uint32Array): Uint32Array {
  const parents = store.blockParents[layer];
  const out = new Uint32Array(store.geoIds[layer]?.length ?? 0);
  if (!parents) return out;
  const n = Math.min(parents.length, blockAssignments.length);
  for (let b = 0; b < n; b++) {
    const district = blockAssignments[b];
    const p = parents[b];
    if (district && p !== NO_PARENT && out[p] === 0) out[p] = district;
  }
  return out;
}
