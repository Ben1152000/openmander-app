import { useCallback, useMemo, useState } from 'react';
import { parseWkbMultiPolygon } from '@/app/lib/wkb';
import {
  districtColor, rampColor, partisanStepColor,
  ETHNICITY_COLOR_RANGE, SCALAR_COLOR_RAMPS,
} from '@/app/constants/colors';
import {
  ETHNICITY_METRICS, ETHNICITY_STAT_KEYS, SCALAR_METRICS, SCALAR_STAT_KEYS,
} from '@/app/constants/metrics';
import type { DistrictStat, EthnicityMetric, ScalarMetric } from '@/app/constants/metrics';

type ColorMetric = 'default' | 'partisan' | ScalarMetric | EthnicityMetric;

export interface RegionStats {
  totalPop: number;
  demVotes: number;
  repVotes: number;
  whitePct: number;
  blackPct: number;
  hispanicPct: number;
  asianPct: number;
  nativePct: number;
  pacificPct: number;
}

// Pure function — no hook state, safe to call from anywhere.
function buildGeoJsonFromWkb(
  items: { district: number; wkb: Uint8Array }[],
  demTotals: number[] | null,
  repTotals: number[] | null,
): GeoJSON.FeatureCollection | null {
  try {
    const features: GeoJSON.Feature[] = [];
    for (const { district, wkb } of items) {
      const mp = parseWkbMultiPolygon(wkb);
      if (mp && mp.coordinates.length > 0) {
        const dem = demTotals?.[district - 1] ?? 0;
        const rep = repTotals?.[district - 1] ?? 0;
        const total = dem + rep;
        features.push({
          type: 'Feature',
          properties: { district, color: districtColor(district - 1), partisanLean: total > 0 ? (dem - rep) / total : 0 },
          geometry: mp,
        });
      }
    }
    return { type: 'FeatureCollection', features };
  } catch (err) {
    console.error('Failed to build GeoJSON from WKB:', err);
    return null;
  }
}

export function useDistrictData(
  districtColorMetric: ColorMetric,
) {
  const [districtGeoJson, setDistrictGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [districtStats, setDistrictStats] = useState<DistrictStat[] | null>(null);
  const [regionStats, setRegionStats] = useState<RegionStats | null>(null);

  // Apply stats that came from the worker — no WASM calls on main thread.
  const applyWorkerStats = useCallback((ds: DistrictStat[], rs: RegionStats) => {
    setDistrictStats(ds);
    setRegionStats(rs);
  }, []);

  // Apply geometry data that came from the worker — no WASM calls on main thread.
  // Wrapped in useCallback so its reference is stable across renders, preventing
  // the worker message handler from constantly tearing down and re-registering.
  const applyWorkerGeometries = useCallback((
    items: { district: number; wkb: Uint8Array }[],
    demTotals: number[] | null,
    repTotals: number[] | null,
  ) => {
    const geoJson = buildGeoJsonFromWkb(items, demTotals, repTotals);
    if (geoJson) setDistrictGeoJson(geoJson);
  }, [setDistrictGeoJson]);

  const districtSwatchColors = useMemo((): Record<number, string> => {
    if (!districtStats) return {};
    return Object.fromEntries(districtStats.map(d => {
      if (ETHNICITY_METRICS.includes(districtColorMetric as EthnicityMetric)) {
        const metric = districtColorMetric as EthnicityMetric;
        const [stops, zeroGroupColor] = ETHNICITY_COLOR_RANGE[metric];
        const pct = (d[ETHNICITY_STAT_KEYS[metric]] as number) / 100;
        return [d.district, pct === 0 ? zeroGroupColor : rampColor(pct, stops)];
      }
      if (SCALAR_METRICS.includes(districtColorMetric as ScalarMetric)) {
        const metric = districtColorMetric as ScalarMetric;
        return [d.district, rampColor(Math.log1p(d[SCALAR_STAT_KEYS[metric]] as number), SCALAR_COLOR_RAMPS[metric])];
      }
      if (districtColorMetric === 'partisan') {
        const total = d.demVotes + d.repVotes;
        return [d.district, partisanStepColor(total > 0 ? (d.demVotes - d.repVotes) / total : 0)];
      }
      return [d.district, d.color];
    }));
  }, [districtStats, districtColorMetric]);

  return { districtGeoJson, setDistrictGeoJson, districtStats, regionStats, districtSwatchColors, applyWorkerGeometries, applyWorkerStats };
}
