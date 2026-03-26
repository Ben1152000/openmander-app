import type { EthnicityMetric, ScalarMetric } from './metrics';

// --- Partisan colors ---

export const PARTISAN_DEM_CLASS = 'text-blue-600';
export const PARTISAN_REP_CLASS = 'text-red-600';

export function deviationClass(deviation: number): string {
  if (Math.abs(deviation) < 0.005) return 'text-muted-foreground';
  return deviation > 0 ? 'text-green-600' : 'text-red-600';
}

export function partisanLeanClass(lean: number | null): string {
  if (lean === null || lean === 0) return '';
  return lean > 0 ? PARTISAN_DEM_CLASS : PARTISAN_REP_CLASS;
}

export function partisanLeanLabel(lean: number | null): string {
  if (lean === null) return '—';
  if (lean > 0) return `D+${(lean * 100).toFixed(1)}%`;
  if (lean < 0) return `R+${(-lean * 100).toFixed(1)}%`;
  return 'Even';
}

// --- District colors ---

const GOLDEN_ANGLE = 137.50776405;

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function districtColor(index: number): string {
  const hue = (index * GOLDEN_ANGLE + 10) % 360;
  return hslToHex(hue, 65, 52);
}

/** Split a #rrggbb hex color into [r, g, b] components (0–255 each). */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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
  [-0.30, '#ff3030'],  // bright red
  [-0.20, '#fa6060'],
  [-0.10, '#f68383'],
  [-0.08, '#f1a5a5'],
  [-0.06, '#efb6b6'],
  [-0.05, '#eec0c0'],
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
  [ 0.05, '#b6b6ef'],
  [ 0.06, '#a5a5f1'],
  [ 0.08, '#8383f6'],
  [ 0.10, '#6060fa'],
  [ 0.20, '#3030ff'],  // bright blue
  [ 0.30, '#1010cf'],  // very dark blue (extreme)
];

// Unit-level partisan ramp — linear interpolation, matches the map-view fill-color expression.
export const PARTISAN_UNIT_RAMP: [number, string][] = [
  [-1.0, '#990000'],
  [-0.5, '#ff4040'],
  [ 0.0, '#e8e8e8'],
  [ 0.5, '#4040ff'],
  [ 1.0, '#000099'],
];

export function partisanStepColor(lean: number): string {
  for (let i = PARTISAN_STEPS.length - 1; i >= 0; i--) {
    if (lean >= PARTISAN_STEPS[i][0]) return PARTISAN_STEPS[i][1];
  }
  return PARTISAN_STEPS[0][1];
}

// --- Turnout ramp (input = raw fraction 0–1, no transform) ---
// Warm gold → teal pivot at 50% → cool blue. Steps concentrated in the 30–70% typical range.
export const TURNOUT_COLOR_RAMP: [number, string][] = [
  [0.00, '#f7eebc'],
  [0.20, '#e8c040'],
  [0.35, '#b0c050'],
  [0.50, '#38aa88'],
  [0.65, '#1e72c0'],
  [0.80, '#0f44a0'],
  [1.00, '#06184a'],
];

// --- Density ramp (input = Math.log1p(people_per_km²), fixed absolute thresholds) ---
// Light green → teal → blue → dark blue → purple → dark red → bright red → orange.
export const DENSITY_COLOR_RAMP: [number, string][] = [
  [Math.log1p(0),      '#ffffff'],
  [Math.log1p(5),      '#f4fbf2'],
  [Math.log1p(10),     '#d9f2e5'],
  [Math.log1p(20),     '#a8e3e5'],
  [Math.log1p(50),     '#71c7d7'],
  [Math.log1p(100),    '#428acb'],
  [Math.log1p(200),    '#2d6bb3'],
  [Math.log1p(500),    '#0c4c9f'],
  [Math.log1p(1000),   '#00309f'],
  [Math.log1p(2000),   '#521f8b'],
  [Math.log1p(5000),   '#700080'],
  [Math.log1p(10000),  '#990049'],
  [Math.log1p(20000),  '#cc003d'],
  [Math.log1p(30000),  '#ff0000'],
  [Math.log1p(50000),  '#ff6200'],
  [Math.log1p(100000), '#ff9e00'],
  [Math.log1p(200000), '#ffc300'],
];

// 	<#f4fbf2; 20-99</td>
// 	<#d9f2e5; 100-399</td>
// 	<#a8e3e5; 400-1k</td>
// 	<#71c7d7; 1k-2k</td>
// 	<#428acb; 2k-3.5k</td>
// 	<#2d6bb3; 3.5k-5.5k</td>
// 	<#0c4c9f; 5.5k-7.5k</td>
// 	<#00309f; 7.5k-10k</td>
// 	<#521f8b; 10k-12k</td>
// 	<#700080; 12k-16k</td>
// 	<#990049; 16k-22k</td>
// 	<#cc003d; 22k-30k</td>
// 	<#ff0000; 30k-50k</td>
// 	<#ff6200; 50k-100k</td>
// 	<#ff9e00; 100k-200k</td>
// 	<#ffc300; 200k+</td>

// --- Ethnicity concentration ---

// Per-metric color ramp: [stops, zeroGroupColor, zeroPopColor]
// Each group has a distinct hue; all ramp from white (0%) to a saturated dark (100%).
// zeroGroupColor: unit has population but none of this group
// zeroPopColor: unit has no population at all
export const ETHNICITY_COLOR_RANGE: Record<EthnicityMetric, [[number, string][], string, string]> = {
  white_pct:    [[[0, '#ffffff'], [0.25, '#c0dcff'], [0.5, '#2090f0'], [0.75, '#0040a0'], [1, '#001040']], '#ffffff', '#d8d8d8'],
  black_pct:    [[[0, '#ffffff'], [0.25, '#e4c8ff'], [0.5, '#9820e0'], [0.75, '#5800a0'], [1, '#220040']], '#ffffff', '#d8d8d8'],
  hispanic_pct: [[[0, '#ffffff'], [0.25, '#ffe0a0'], [0.5, '#ff7000'], [0.75, '#b02000'], [1, '#4a0800']], '#ffffff', '#d8d8d8'],
  asian_pct:    [[[0, '#ffffff'], [0.25, '#b0f0d8'], [0.5, '#00b870'], [0.75, '#006040'], [1, '#002018']], '#ffffff', '#d8d8d8'],
  native_pct:   [[[0, '#ffffff'], [0.25, '#ffe880'], [0.5, '#e0a000'], [0.75, '#804800'], [1, '#301800']], '#ffffff', '#d8d8d8'],
  pacific_pct:  [[[0, '#ffffff'], [0.25, '#ffc0a0'], [0.5, '#f04020'], [0.75, '#901000'], [1, '#380005']], '#ffffff', '#d8d8d8'],
};

function lerpColor(t: number, a: string, b: string): string {
  const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t).toString(16).padStart(2, '0');
  const g = Math.round(ag + (bg - ag) * t).toString(16).padStart(2, '0');
  const bh = Math.round(ab + (bb - ab) * t).toString(16).padStart(2, '0');
  return `#${r}${g}${bh}`;
}

export const SCALAR_COLOR_RAMPS: Record<ScalarMetric, [number, string][]> = {
  population_density: DENSITY_COLOR_RAMP,
  turnout: TURNOUT_COLOR_RAMP,
};

export function rampColor(t: number, stops: [number, string][]): string {
  if (t <= stops[0][0]) return stops[0][1];
  if (t >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const local = (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return lerpColor(local, stops[i - 1][1], stops[i][1]);
    }
  }
  return stops[stops.length - 1][1];
}

// --- Ethnicity colors ---
//
// eth_cat codes — grouped by tier, same group order (Black/Hispanic/Asian/Native/Pacific/White) in each:
//   0     zero population
//   1–6   dominant  ≥75%                   lerp(75%→100%, t=0.40) ≈ global 85% of each group's ramp
//   7–12  majority  50–75%                 lerp(50%→75%,  t=0.40) ≈ global 60%
//   13–18 plurality <50% (or white plu.)   lerp(25%→50%,  t=0.32) ≈ global 33%
//         (white plurality: no NW group is largest but combined NW ≥50%)
export const ETH_COLORS: Record<number, string> = {
  0:  '#D8D8D8', // zero pop
  1:  '#42007A', 2:  '#871600', 3:  '#004630', 4:  '#603500', 5:  '#6D0A02', 6:  '#002D7A', // dom: Blk Hisp Asian Nat Pac Wht
  7:  '#7E13C6', 8:  '#DF5000', 9:  '#00955D', 10: '#BA7D00', 11: '#CA2D13', 12: '#1370D0', // maj: Blk Hisp Asian Nat Pac Wht
  13: '#CC92F5', 14: '#FFBC6D', 15: '#78DEB7', 16: '#F5D157', 17: '#FA9777', 18: '#8DC4FA', // plu: Blk Hisp Asian Nat Pac Wht
};

// Generated from ETH_COLORS — no need to maintain separately.
export const ETH_COLOR_EXPR: any[] = [
  'match', ['feature-state', 'eth_cat'],
  ...Object.entries(ETH_COLORS).flatMap(([k, v]) => [Number(k), v]),
  '#D8D8D8',
];
