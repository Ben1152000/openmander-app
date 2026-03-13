import { useMemo, useRef, useState, useEffect } from 'react';
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

export function useDistrictData(
  plan: any,
  planUpdateTrigger: number,
  districtColorMetric: ColorMetric,
  setLoadingStatus: (s: string) => void,
) {
  const [districtGeoJson, setDistrictGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [districtStats, setDistrictStats] = useState<DistrictStat[] | null>(null);
  const computingRef = useRef(false);
  const pendingRef = useRef(false);

  const computeDistrictGeometries = async () => {
    if (!plan) return;
    if (computingRef.current) { pendingRef.current = true; return; }

    computingRef.current = true;

    try {
      const geometries = plan.district_geometries_wkb();
      const available: string[] = plan.series();
      const demTotals: number[] | null = available.includes('E_20_PRES_Dem')
        ? Array.from(plan.district_totals('E_20_PRES_Dem')) : null;
      const repTotals: number[] | null = available.includes('E_20_PRES_Rep')
        ? Array.from(plan.district_totals('E_20_PRES_Rep')) : null;

      const features: GeoJSON.Feature[] = [];
      for (const { district, wkb } of geometries) {
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
      setDistrictGeoJson({ type: 'FeatureCollection', features });
    } catch (err) {
      console.error('Failed to compute district geometries:', err);
      setDistrictGeoJson(null);
    } finally {
      computingRef.current = false;
      const hasPending = pendingRef.current;
      pendingRef.current = false;
      if (hasPending) {
        computeDistrictGeometries();
      } else {
        setLoadingStatus('');
      }
    }
  };

  // Recompute district stats when plan changes
  useEffect(() => {
    if (!plan) { setDistrictStats(null); return; }
    try {
      const available: string[] = plan.series();
      const populations: number[] = available.includes('T_20_CENS_Total')
        ? Array.from(plan.district_totals('T_20_CENS_Total')) : [];

      const total = populations.reduce((a, b) => a + b, 0);
      const ideal = populations.length > 0 ? total / populations.length : 0;

      const demVotes: number[] | null = available.includes('E_20_PRES_Dem')
        ? Array.from(plan.district_totals('E_20_PRES_Dem')) : null;
      const repVotes: number[] | null = available.includes('E_20_PRES_Rep')
        ? Array.from(plan.district_totals('E_20_PRES_Rep')) : null;
      const landM2: number[] | null = available.includes('land_m2')
        ? Array.from(plan.district_totals('land_m2')) : null;

      const ethnicGroups = ['White', 'Black', 'Hispanic', 'Asian', 'Native', 'Pacific'] as const;
      const ethnicTotals: Record<string, number[] | null> = {};
      for (const g of ethnicGroups) {
        const col = `T_20_CENS_${g}`;
        ethnicTotals[g] = available.includes(col) ? Array.from(plan.district_totals(col)) : null;
      }

      setDistrictStats(populations.map((pop, i) => {
        const pct = (arr: number[] | null) => arr && pop > 0 ? (arr[i] / pop) * 100 : 0;
        return {
          district: i + 1,
          color: districtColor(i),
          population: pop,
          deviation: ideal > 0 ? ((pop - ideal) / ideal) * 100 : 0,
          demVotes: demVotes?.[i] ?? 0,
          repVotes: repVotes?.[i] ?? 0,
          areaSqKm: landM2 ? landM2[i] / 1e6 : 0,
          populationDensity: landM2 && landM2[i] > 0 ? pop / (landM2[i] / 1e6) : 0,
          whitePct: pct(ethnicTotals['White']),
          blackPct: pct(ethnicTotals['Black']),
          hispanicPct: pct(ethnicTotals['Hispanic']),
          asianPct: pct(ethnicTotals['Asian']),
          nativePct: pct(ethnicTotals['Native']),
          pacificPct: pct(ethnicTotals['Pacific']),
        };
      }));
    } catch (err) {
      console.error('Failed to compute district stats:', err);
      setDistrictStats(null);
    }
  }, [planUpdateTrigger, plan]);

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

  return { districtGeoJson, setDistrictGeoJson, districtStats, districtSwatchColors, computeDistrictGeometries };
}
