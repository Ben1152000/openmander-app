import { Fragment, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import type { DistrictStat, EthnicityMetric, ScalarMetric } from '@/app/constants/metrics';
import { ETHNICITY_METRICS, ETHNICITY_STAT_KEYS, SCALAR_METRICS, SCALAR_STAT_KEYS, SCALAR_TRANSFORMS, ethCatFromStat, ETH_CAT_LABELS } from '@/app/constants/metrics';
import { districtColor, partisanStepColor, ETHNICITY_COLOR_RANGE, SCALAR_COLOR_RAMPS, ETH_COLORS, rampColor } from '@/app/constants/colors';

interface DistrictTooltipProps {
  district: number;
  x: number;
  y: number;
  districtStats: DistrictStat[] | null;
  districtColorMetric: string;
  electionNameRef: MutableRefObject<string>;
  censusNameRef: MutableRefObject<string>;
}

type Row = { label: string; count: string; pct?: string; color?: string; bold?: boolean };
type Section = { header: string; rows: Row[] };

const ETH_LABELS: [EthnicityMetric, keyof DistrictStat, string][] = [
  ['white_pct',    'whitePct',    'White'],
  ['black_pct',    'blackPct',    'Black'],
  ['hispanic_pct', 'hispanicPct', 'Hispanic'],
  ['asian_pct',    'asianPct',    'Asian'],
  ['native_pct',   'nativePct',   'Native'],
  ['pacific_pct',  'pacificPct',  'Pacific'],
];

function swatchColor(metric: string, district: number, stat: DistrictStat | undefined): string {
  if (!stat) return districtColor(district - 1);
  if (metric === 'partisan') {
    const total = stat.demVotes + stat.repVotes;
    return total > 0 ? partisanStepColor((stat.demVotes - stat.repVotes) / total) : '#e8e8e8';
  }
  if (ETHNICITY_METRICS.includes(metric as EthnicityMetric)) {
    const [stops, zeroGroupColor] = ETHNICITY_COLOR_RANGE[metric as EthnicityMetric];
    const pct = (stat[ETHNICITY_STAT_KEYS[metric as EthnicityMetric]] as number) / 100;
    return pct === 0 ? zeroGroupColor : rampColor(pct, stops);
  }
  if (SCALAR_METRICS.includes(metric as ScalarMetric)) {
    const key = SCALAR_STAT_KEYS[metric as ScalarMetric];
    return rampColor(SCALAR_TRANSFORMS[metric as ScalarMetric](stat[key] as number), SCALAR_COLOR_RAMPS[metric as ScalarMetric]);
  }
  if (metric === 'ethnicity') return ETH_COLORS[ethCatFromStat(stat)] ?? '#888888';
  return stat.color;
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

export function DistrictTooltip({ district, x, y, districtStats, districtColorMetric, electionNameRef, censusNameRef }: DistrictTooltipProps) {
  const stat = districtStats?.find(d => d.district === district);
  const metric = districtColorMetric;

  const sections: Section[] = [];

  if (stat) {
    // --- Census section ---
    const devStr = `${stat.deviation >= 0 ? '+' : ''}${fmt(stat.deviation, 2)}%`;
    const censusRows: Row[] = [{ label: 'Population', count: fmt(stat.population), pct: devStr }];

    if (metric === 'population_density') {
      censusRows.push({ label: 'Area', count: `${fmt(stat.areaSqKm, stat.areaSqKm < 10 ? 2 : stat.areaSqKm < 100 ? 1 : 0)} km²` });
      censusRows.push({ label: 'Density', count: `${fmt(Math.round(stat.populationDensity))}/km²` });
    } else if (ETHNICITY_METRICS.includes(metric as EthnicityMetric) || metric === 'ethnicity') {
      for (const [ethKey, statKey, label] of ETH_LABELS) {
        const p = stat[statKey] as number; // already a percentage (0–100)
        const count = Math.round(p / 100 * stat.population);
        censusRows.push({ label, count: fmt(count), pct: `${fmt(p, 1)}%`, bold: ethKey === metric });
      }
    }

    let censusHeader = censusNameRef.current || 'Census';
    if (metric === 'ethnicity') {
      censusHeader = `${censusHeader} · ${ETH_CAT_LABELS[ethCatFromStat(stat)] ?? '—'}`;
    }
    sections.push({ header: censusHeader, rows: censusRows });

    // --- Election section ---
    if (metric === 'partisan') {
      const total = stat.demVotes + stat.repVotes;
      const demPct = total > 0 ? `${fmt(stat.demVotes / total * 100, 1)}%` : undefined;
      const repPct = total > 0 ? `${fmt(stat.repVotes / total * 100, 1)}%` : undefined;
      sections.push({
        header: electionNameRef.current || 'Election',
        rows: [
          { label: 'Dem', count: fmt(stat.demVotes), pct: demPct, color: 'text-blue-600' },
          { label: 'Rep', count: fmt(stat.repVotes), pct: repPct, color: 'text-red-600' },
        ],
      });
    } else if (metric === 'turnout') {
      const electionRows: Row[] = [];
      if (stat.vap > 0) electionRows.push({ label: 'VAP', count: fmt(stat.vap) });
      if (stat.vap > 0) electionRows.push({ label: 'Votes', count: fmt(stat.votesCast) });
      electionRows.push({ label: 'Turnout', count: `${fmt(stat.turnout * 100, 1)}%` });
      sections.push({ header: electionNameRef.current || 'Election', rows: electionRows });
    }
  }

  const totalRows = sections.reduce((n, s) => n + s.rows.length, 0);
  const tooltipW = 230;
  const tooltipH = 60 + totalRows * 20 + sections.length * 22;
  const offset = 14;
  const left = x + offset + tooltipW > window.innerWidth  ? x - tooltipW - offset : x + offset;
  const top  = y + offset + tooltipH > window.innerHeight ? y - tooltipH - offset : y + offset;

  const color = swatchColor(metric, district, stat);

  return createPortal(
    <div className="fixed z-50 pointer-events-none" style={{ left, top }}>
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs" style={{ minWidth: '190px' }}>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
          <span className="font-semibold text-gray-800">District {district}</span>
        </div>
        {stat ? (
          <div className="grid gap-x-3" style={{ gridTemplateColumns: 'auto 1fr auto' }}>
            {sections.map((section, si) => (
              <Fragment key={section.header}>
                <span className={`col-span-3 text-[10px] text-gray-400 ${si > 0 ? 'mt-1' : ''}`}>{section.header}</span>
                {section.rows.map(r => (
                  <Fragment key={`${section.header}-${r.label}`}>
                    <span className={r.bold ? 'font-semibold text-gray-800' : 'text-gray-600'}>{r.label}</span>
                    <span className={`text-right tabular-nums ${r.bold ? 'font-semibold text-gray-800' : 'font-medium'} ${r.color ?? 'text-gray-800'}`}>{r.count}</span>
                    <span className={`text-right tabular-nums ${r.bold ? 'font-semibold text-gray-800' : 'text-gray-400'}`}>{r.pct ?? ''}</span>
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </div>
        ) : (
          <div className="text-gray-400">No data</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
