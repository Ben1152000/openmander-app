// Data model types and constants for demographic/election metrics.

export interface DistrictStat {
  district: number;
  color: string;
  population: number;
  deviation: number; // % deviation from ideal
  demVotes: number;
  repVotes: number;
  whitePct: number;
  blackPct: number;
  hispanicPct: number;
  asianPct: number;
  nativePct: number;
  pacificPct: number;
}

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
