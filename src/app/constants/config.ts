// Map configuration: zoom thresholds, defaults, and per-state settings.

import stateBoundsData from './state-extents.json';

export const ZOOM_THRESHOLD_COUNTY_TO_VTD = 8;
export const ZOOM_THRESHOLD_VTD_TO_BLOCK = 12;
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

export function getLayerForZoom(zoom: number): string {
  if (zoom < ZOOM_THRESHOLD_COUNTY_TO_VTD) return 'county';
  if (zoom < ZOOM_THRESHOLD_VTD_TO_BLOCK) return 'vtd';
  return 'block';
}

// Build a lookup from lowercase state name → bounds.
const boundsByName: Record<string, [[number, number], [number, number]]> = {};
for (const entry of stateBoundsData) {
  boundsByName[entry.state.toLowerCase()] = entry.bounds as [[number, number], [number, number]];
}

function boundsFor(name: string): [[number, number], [number, number]] {
  const b = boundsByName[name];
  if (!b) throw new Error(`No bounds found for state: ${name}`);
  return b;
}

export const STATE_CONFIGS: Record<string, StateConfig> = {
  alabama:              { packDir: 'AL/AL_2020_webpack', bounds: boundsFor('alabama'),           districts: 7  },
  // alaska:               { packDir: 'AK/AK_2020_webpack', bounds: boundsFor('alaska'),            districts: 1  },
  arizona:              { packDir: 'AZ/AZ_2020_webpack', bounds: boundsFor('arizona'),           districts: 9  },
  arkansas:             { packDir: 'AR/AR_2020_webpack', bounds: boundsFor('arkansas'),          districts: 4  },
  california:           { packDir: 'CA/CA_2020_webpack', bounds: boundsFor('california'),        districts: 52 },
  colorado:             { packDir: 'CO/CO_2020_webpack', bounds: boundsFor('colorado'),          districts: 8  },
  connecticut:          { packDir: 'CT/CT_2020_webpack', bounds: boundsFor('connecticut'),       districts: 5  },
  delaware:             { packDir: 'DE/DE_2020_webpack', bounds: boundsFor('delaware'),          districts: 1  },
  florida:              { packDir: 'FL/FL_2020_webpack', bounds: boundsFor('florida'),           districts: 28 },
  georgia:              { packDir: 'GA/GA_2020_webpack', bounds: boundsFor('georgia'),           districts: 14 },
  // hawaii:               { packDir: 'HI/HI_2020_webpack', bounds: boundsFor('hawaii'),            districts: 2  },
  idaho:                { packDir: 'ID/ID_2020_webpack', bounds: boundsFor('idaho'),             districts: 2  },
  illinois:             { packDir: 'IL/IL_2020_webpack', bounds: boundsFor('illinois'),          districts: 17 },
  indiana:              { packDir: 'IN/IN_2020_webpack', bounds: boundsFor('indiana'),           districts: 9  },
  iowa:                 { packDir: 'IA/IA_2020_webpack', bounds: boundsFor('iowa'),              districts: 4  },
  kansas:               { packDir: 'KS/KS_2020_webpack', bounds: boundsFor('kansas'),            districts: 4  },
  kentucky:             { packDir: 'KY/KY_2020_webpack', bounds: boundsFor('kentucky'),          districts: 6  },
  louisiana:            { packDir: 'LA/LA_2020_webpack', bounds: boundsFor('louisiana'),         districts: 6  },
  maine:                { packDir: 'ME/ME_2020_webpack', bounds: boundsFor('maine'),             districts: 2  },
  maryland:             { packDir: 'MD/MD_2020_webpack', bounds: boundsFor('maryland'),          districts: 8  },
  massachusetts:        { packDir: 'MA/MA_2020_webpack', bounds: boundsFor('massachusetts'),     districts: 9  },
  michigan:             { packDir: 'MI/MI_2020_webpack', bounds: boundsFor('michigan'),          districts: 13 },
  minnesota:            { packDir: 'MN/MN_2020_webpack', bounds: boundsFor('minnesota'),        districts: 8  },
  mississippi:          { packDir: 'MS/MS_2020_webpack', bounds: boundsFor('mississippi'),       districts: 4  },
  missouri:             { packDir: 'MO/MO_2020_webpack', bounds: boundsFor('missouri'),          districts: 8  },
  montana:              { packDir: 'MT/MT_2020_webpack', bounds: boundsFor('montana'),           districts: 2  },
  nebraska:             { packDir: 'NE/NE_2020_webpack', bounds: boundsFor('nebraska'),          districts: 3  },
  nevada:               { packDir: 'NV/NV_2020_webpack', bounds: boundsFor('nevada'),            districts: 4  },
  'new hampshire':      { packDir: 'NH/NH_2020_webpack', bounds: boundsFor('new hampshire'),     districts: 2  },
  'new jersey':         { packDir: 'NJ/NJ_2020_webpack', bounds: boundsFor('new jersey'),        districts: 12 },
  'new mexico':         { packDir: 'NM/NM_2020_webpack', bounds: boundsFor('new mexico'),        districts: 3  },
  'new york':           { packDir: 'NY/NY_2020_webpack', bounds: boundsFor('new york'),          districts: 26 },
  'north carolina':     { packDir: 'NC/NC_2020_webpack', bounds: boundsFor('north carolina'),    districts: 14 },
  'north dakota':       { packDir: 'ND/ND_2020_webpack', bounds: boundsFor('north dakota'),      districts: 1  },
  ohio:                 { packDir: 'OH/OH_2020_webpack', bounds: boundsFor('ohio'),              districts: 15 },
  oklahoma:             { packDir: 'OK/OK_2020_webpack', bounds: boundsFor('oklahoma'),          districts: 5  },
  oregon:               { packDir: 'OR/OR_2020_webpack', bounds: boundsFor('oregon'),            districts: 6  },
  pennsylvania:         { packDir: 'PA/PA_2020_webpack', bounds: boundsFor('pennsylvania'),      districts: 17 },
  'rhode island':       { packDir: 'RI/RI_2020_webpack', bounds: boundsFor('rhode island'),      districts: 2  },
  'south carolina':     { packDir: 'SC/SC_2020_webpack', bounds: boundsFor('south carolina'),    districts: 7  },
  'south dakota':       { packDir: 'SD/SD_2020_webpack', bounds: boundsFor('south dakota'),      districts: 1  },
  tennessee:            { packDir: 'TN/TN_2020_webpack', bounds: boundsFor('tennessee'),         districts: 9  },
  texas:                { packDir: 'TX/TX_2020_webpack', bounds: boundsFor('texas'),             districts: 38 },
  utah:                 { packDir: 'UT/UT_2020_webpack', bounds: boundsFor('utah'),              districts: 4  },
  vermont:              { packDir: 'VT/VT_2020_webpack', bounds: boundsFor('vermont'),           districts: 1  },
  virginia:             { packDir: 'VA/VA_2020_webpack', bounds: boundsFor('virginia'),          districts: 11 },
  washington:           { packDir: 'WA/WA_2020_webpack', bounds: boundsFor('washington'),        districts: 10 },
  'west virginia':      { packDir: 'WV/WV_2020_webpack', bounds: boundsFor('west virginia'),     districts: 2  },
  wisconsin:            { packDir: 'WI/WI_2020_webpack', bounds: boundsFor('wisconsin'),         districts: 8  },
  wyoming:              { packDir: 'WY/WY_2020_webpack', bounds: boundsFor('wyoming'),           districts: 1  },
};
