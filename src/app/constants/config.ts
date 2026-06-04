// Map configuration: zoom thresholds, defaults, and per-state settings.

export const ZOOM_THRESHOLD_COUNTY_TO_VTD = 8;
export const ZOOM_THRESHOLD_VTD_TO_BLOCK = 12;
export const POLAR_CIRCLE_LAT = 66.5;
export const POLAR_ZOOM_OFFSET = 2;
export const DEFAULT_ZOOM = 6;
export const DEFAULT_NUM_DISTRICTS = 17; // Illinois congressional districts
export const DEFAULT_LAYER = 'county';

export interface StateConfig {
  packDir: string;
  /** [[west, south], [east, north]] in WGS84 degrees */
  bounds: [[number, number], [number, number]];
  /** Number of congressional districts */
  districts: number;
}

/** Returns the internal layer name used for the precinct zoom level. */
export function midZoomLayer(hasVtd: boolean): 'vtd' | 'group' {
  return hasVtd ? 'vtd' : 'group';
}

/** Returns true if the state's bounds extend beyond the Arctic or Antarctic circle. */
export function isPolarState(config: StateConfig): boolean {
  const [[, south], [, north]] = config.bounds;
  return north > POLAR_CIRCLE_LAT || south < -POLAR_CIRCLE_LAT;
}

export function getLayerForZoom(zoom: number, hasVtd = true, zoomOffset = 0): string {
  if (zoom < ZOOM_THRESHOLD_COUNTY_TO_VTD - zoomOffset) return 'county';
  if (zoom < ZOOM_THRESHOLD_VTD_TO_BLOCK - zoomOffset) return midZoomLayer(hasVtd);
  return 'block';
}

/** Default map bounds (Illinois) used before the pack index loads. */
export const IL_DEFAULT_BOUNDS: [[number, number], [number, number]] = [[-91.513, 36.970], [-87.495, 42.508]];
