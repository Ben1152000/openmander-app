// Map configuration: zoom thresholds, defaults, and per-state settings.

export const ZOOM_THRESHOLD_COUNTY_TO_VTD = 8;
export const ZOOM_THRESHOLD_VTD_TO_BLOCK = 12;
export const DEFAULT_ZOOM = 6;
export const DEFAULT_NUM_DISTRICTS = 17; // Illinois congressional districts
export const DEFAULT_LAYER = 'county';

export interface StateConfig {
  packDir: string;
  pmtilesBounds: [number, number, number, number]; // [west, south, east, north]
  center: [number, number];
  zoom: number;
}

export function getLayerForZoom(zoom: number): string {
  if (zoom < ZOOM_THRESHOLD_COUNTY_TO_VTD) return 'county';
  if (zoom < ZOOM_THRESHOLD_VTD_TO_BLOCK) return 'vtd';
  return 'block';
}

export const STATE_CONFIGS: Record<string, StateConfig> = {
  illinois: {
    packDir: 'IL/IL_2020_webpack',
    pmtilesBounds: [-91.5, 36.9, -87.0, 42.5],
    center: [-89.2, 40.0],
    zoom: 6,
  },
  iowa: {
    packDir: 'IA/IA_2020_webpack',
    pmtilesBounds: [-96.7, 40.3, -90.1, 43.6],
    center: [-93.5, 42.0],
    zoom: 6.5,
  },
  indiana: {
    packDir: 'IN/IN_2020_webpack',
    pmtilesBounds: [-88.1, 37.7, -84.7, 41.8],
    center: [-86.3, 39.8],
    zoom: 6.5,
  },
};
