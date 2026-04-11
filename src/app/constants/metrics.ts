// Data model types and constants for demographic/election metrics.

export interface DistrictStat {
  district: number;
  color: string;
  population: number;
  deviation: number; // % deviation from ideal
  demVotes: number;
  repVotes: number;
  areaSqKm: number;
  populationDensity: number; // people per km²
  turnout: number;           // fraction 0–1: total pres votes / VAP
  vap: number;               // voting age population
  votesCast: number;         // E_20_PRES_Total (all pres votes including third party)
  whitePct: number;
  blackPct: number;
  hispanicPct: number;
  asianPct: number;
  nativePct: number;
  pacificPct: number;
}

export type ScalarMetric = 'population_density' | 'turnout';
export const SCALAR_METRICS: ScalarMetric[] = ['population_density', 'turnout'];

export const SCALAR_STAT_KEYS: Record<ScalarMetric, keyof DistrictStat> = {
  population_density: 'populationDensity',
  turnout: 'turnout',
};

// Value transform applied before color ramp lookup. population_density uses log
// scale to compress its wide dynamic range; turnout is already a clean 0–1 fraction.
export const SCALAR_TRANSFORMS: Record<ScalarMetric, (v: number) => number> = {
  population_density: Math.log1p,
  turnout: (v: number) => v,
};

export const ETHNICITY_METRICS = [
  'white_pct', 'black_pct', 'hispanic_pct', 'asian_pct', 'native_pct', 'pacific_pct',
] as const;
export type EthnicityMetric = typeof ETHNICITY_METRICS[number];

// Maps each ethnicity metric key to its CSV column name in the pack data files.
export const ETHNICITY_COLS: Record<EthnicityMetric, string> = {
  white_pct:    'T_20_CENS_White',
  black_pct:    'T_20_CENS_Black',
  hispanic_pct: 'T_20_CENS_Hispanic',
  asian_pct:    'T_20_CENS_Asian',
  native_pct:   'T_20_CENS_Native',
  pacific_pct:  'T_20_CENS_Pacific',
};

// Maps each ethnicity metric key to its corresponding field on DistrictStat.
export const ETHNICITY_STAT_KEYS: Record<EthnicityMetric, keyof DistrictStat> = {
  white_pct:    'whitePct',
  black_pct:    'blackPct',
  hispanic_pct: 'hispanicPct',
  asian_pct:    'asianPct',
  native_pct:   'nativePct',
  pacific_pct:  'pacificPct',
};

// Ethnicity metric — single combined view with priority ordering:
//   1. Single group dominant  (one non-white group ≥75%)         → darkest group color   (eth_cat 1–6)
//   2. Single group majority  (one non-white group 50–75%)       → saturated group color (eth_cat 7–12)
//   3. Single group plurality (one non-white group is largest)   → pastel group color    (eth_cat 13–18)
//   4. White plurality        (no NW plurality, combined NW ≥50%) → pastel blue          (eth_cat 18)
//   5. White majority (50–75%)                                   → medium blue           (eth_cat 12)
//   6. White dominant (≥75%)                                     → dark blue             (eth_cat 6)
//   0. Zero population                                           → gray
export type EthStatusMetric = 'ethnicity';
export const ETH_STATUS_METRICS: EthStatusMetric[] = ['ethnicity'];

/** Compute eth_cat integer from per-unit pct values (0–1 fractions, -1 = no data). */
export function ethCatFromPcts(white: number, nwPcts: number[]): number {
  if (white < 0 && Math.max(...nwPcts) < 0) return 0;
  let maxNW = -1, maxIdx = -1;
  for (let i = 0; i < nwPcts.length; i++) {
    if (nwPcts[i] > maxNW) { maxNW = nwPcts[i]; maxIdx = i; }
  }
  if (maxNW >= 0.75) return maxIdx + 1;                // NW dom  (1–5)
  if (maxNW >= 0.5)  return maxIdx + 7;                // NW maj  (7–11)
  if (maxNW >= 0 && maxNW > white) return maxIdx + 13; // NW plu  (13–17)
  const total = nwPcts.reduce((a, b) => a + Math.max(0, b), 0);
  if (total >= 0.5) return 18;                          // white plu (= minority coalition)
  if (white >= 0.75) return 6;                          // white dom
  return 12;                                            // white maj
}

/** Compute eth_cat from a DistrictStat (percentages are 0–100). */
export function ethCatFromStat(d: DistrictStat): number {
  if (d.population === 0) return 0;
  return ethCatFromPcts(
    d.whitePct / 100,
    [d.blackPct, d.hispanicPct, d.asianPct, d.nativePct, d.pacificPct].map(v => v / 100),
  );
}

/** Human-readable label for an eth_cat value. */
export const ETH_CAT_LABELS: Record<number, string> = {
  0:  '—',
  1:  'Black Dom.',  2:  'Hispanic Dom.', 3:  'Asian Dom.',  4:  'Native Dom.',  5:  'Pacific Dom.',  6:  'White Dom.',
  7:  'Black Maj.',  8:  'Hispanic Maj.', 9:  'Asian Maj.',  10: 'Native Maj.',  11: 'Pacific Maj.',  12: 'White Maj.',
  13: 'Black Plu.',  14: 'Hispanic Plu.', 15: 'Asian Plu.',  16: 'Native Plu.',  17: 'Pacific Plu.',  18: 'White Plu.',
};

// Non-white groups in order (index i → eth_cat i+1 for dominant, i+7 for majority, i+13 for plurality).
export const NON_WHITE_GROUPS: { key: EthnicityMetric; label: string }[] = [
  { key: 'black_pct',    label: 'Black'    },
  { key: 'hispanic_pct', label: 'Hispanic' },
  { key: 'asian_pct',    label: 'Asian'    },
  { key: 'native_pct',   label: 'Native'   },
  { key: 'pacific_pct',  label: 'Pacific'  },
];
