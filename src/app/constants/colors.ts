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

export function partisanStepColor(lean: number): string {
  for (let i = PARTISAN_STEPS.length - 1; i >= 0; i--) {
    if (lean >= PARTISAN_STEPS[i][0]) return PARTISAN_STEPS[i][1];
  }
  return PARTISAN_STEPS[0][1];
}

// --- Ethnicity concentration ---

// Per-metric color ramp: [stops, zeroGroupColor, zeroPopColor]
// stops: [[position (0–1), hexColor], ...] defining the multi-stop gradient
// zeroGroupColor: unit has population but none of this group (always white)
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
