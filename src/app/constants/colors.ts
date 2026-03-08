import type { EthnicityMetric } from './metrics';

// --- District colors ---

const GOLDEN_ANGLE = 137.50776405;

export function districtColor(index: number): string {
  const hue = (index * GOLDEN_ANGLE) % 360;
  return `hsl(${hue.toFixed(1)} 65% 52%)`;
}

// --- Unit fill ---

// Default gray shown for unassigned units in both District View and Map View.
export const UNIT_GRAY_FILL = 'rgba(230, 230, 230, 0.5)';

// --- District overlay ---

export const DISTRICT_FILL_OPACITY = 0.60;

// --- Partisan lean ---

// Anchors: ±1.00 = dark extreme, ±0.50 = bright extreme, 0.00 = neutral gray.
// Colors between ±0.50 and 0.00 are linearly interpolated in RGB for equal visual steps.
export const PARTISAN_STEPS: [number, string][] = [
  [-1.00, '#c01010'],  // very dark red (extreme)
  [-0.30, '#ff4040'],  // bright red
  [-0.20, '#f68383'],
  [-0.10, '#f1a5a5'],
  [-0.08, '#efb6b6'],
  [-0.06, '#eec0c0'],
  [-0.04, '#eccaca'],
  [-0.03, '#ebd4d4'],
  [-0.02, '#eadbdb'],
  [-0.01, '#e9e1e1'],
  // [ 0.00, '#e8e8e8'],  // neutral gray
  [ 0.00, '#e1e1e9'],
  [ 0.01, '#dbdbea'],
  [ 0.02, '#d4d4eb'],
  [ 0.03, '#cacaec'],
  [ 0.04, '#c0c0ee'],
  [ 0.06, '#b6b6ef'],
  [ 0.08, '#a5a5f1'],
  [ 0.10, '#8383f6'],
  [ 0.20, '#4040ff'],  // bright blue
  [ 0.30, '#1010cf'],  // very dark blue (extreme)
];

export function partisanStepColor(lean: number): string {
  for (let i = PARTISAN_STEPS.length - 1; i >= 0; i--) {
    if (lean >= PARTISAN_STEPS[i][0]) return PARTISAN_STEPS[i][1];
  }
  return PARTISAN_STEPS[0][1];
}

// --- Ethnicity concentration ---

// Per-metric color ramp: [lightColor, darkColor, zeroGroupColor, zeroPopColor]
// lightColor → darkColor: low → high concentration
// zeroGroupColor: unit has population but none of this group
// zeroPopColor: unit has no population at all
export const ETHNICITY_COLOR_RANGE: Record<EthnicityMetric, [string, string, string, string]> = {
  white_pct:    ['#f0f7ff', '#003d99', '#ffffff', '#d8d8d8'],
  black_pct:    ['#f8f5ff', '#3d008f', '#ffffff', '#d8d8d8'],
  hispanic_pct: ['#fff8f0', '#e05000', '#ffffff', '#d8d8d8'],
  asian_pct:    ['#f2fbf7', '#006b40', '#ffffff', '#d8d8d8'],
  native_pct:   ['#fefef2', '#c49a00', '#ffffff', '#d8d8d8'],
  pacific_pct:  ['#fef3f0', '#b03020', '#ffffff', '#d8d8d8'],
};

export function lerpColor(t: number, light: string, dark: string): string {
  const lr = parseInt(light.slice(1, 3), 16), lg = parseInt(light.slice(3, 5), 16), lb = parseInt(light.slice(5, 7), 16);
  const dr = parseInt(dark.slice(1, 3), 16),  dg = parseInt(dark.slice(3, 5), 16),  db = parseInt(dark.slice(5, 7), 16);
  const r = Math.round(lr + (dr - lr) * t).toString(16).padStart(2, '0');
  const g = Math.round(lg + (dg - lg) * t).toString(16).padStart(2, '0');
  const b = Math.round(lb + (db - lb) * t).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}
