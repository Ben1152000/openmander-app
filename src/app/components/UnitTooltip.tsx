import { Fragment, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import type { EthnicityMetric } from '@/app/constants/metrics';
import { ETHNICITY_METRICS, ethCatFullLabel } from '@/app/constants/metrics';
import {
  unitValues, ethnicityCategory, scalarValue, electionSeriesLabel, censusSeriesLabel,
  type UnitDataStore,
} from '@/app/lib/unitData';

interface UnitTooltipProps {
  geoId: string;
  layer: string;
  index: number;
  x: number;
  y: number;
  districtColorMetric: string;
  unitDataRef: MutableRefObject<UnitDataStore>;
}

type Row = { label: string; count: string; pct?: string; color?: string; bold?: boolean };
type Section = { header: string; rows: Row[] };

const ETH_LABELS: [EthnicityMetric, string][] = [
  ['white_pct',    'White'],
  ['black_pct',    'Black'],
  ['hispanic_pct', 'Hispanic'],
  ['asian_pct',    'Asian'],
  ['native_pct',   'Native'],
  ['pacific_pct',  'Pacific'],
];

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

export function UnitTooltip({ geoId, layer, index, x, y, districtColorMetric, unitDataRef }: UnitTooltipProps) {
  const store = unitDataRef.current;
  const name = store.names[layer]?.[index];
  const v = unitValues(store, layer, index);
  const population = v.population;
  const metric = districtColorMetric;
  const electionName = electionSeriesLabel(store.electionSeries);
  const censusName = censusSeriesLabel(store.censusSeries);

  const sections: Section[] = [];

  // --- Census section ---
  const censusRows: Row[] = [];
  if (population != null) {
    censusRows.push({ label: 'Population', count: fmt(population) });
  }

  if (metric === 'population_density') {
    const landKm2 = v.landKm2;
    const stored = scalarValue(v, 'population_density');
    if (landKm2 != null) censusRows.push({ label: 'Land area', count: `${fmt(landKm2, landKm2 < 10 ? 2 : landKm2 < 100 ? 1 : 0)} km²` });
    if (stored != null && stored >= 0) censusRows.push({ label: 'Density', count: `${fmt(Math.round(Math.expm1(stored)))}/km²` });
  } else if (ETHNICITY_METRICS.includes(metric as EthnicityMetric) || metric === 'ethnicity') {
    const pop = population ?? 0;
    for (const [key, label] of ETH_LABELS) {
      const count = v.ethnicCounts[key];
      if (count != null) {
        censusRows.push({ label, count: fmt(count), pct: pop > 0 ? `${fmt(count / pop * 100, 1)}%` : undefined, bold: key === metric });
      }
    }
  }

  let censusHeader = censusName || 'Census';
  if (metric === 'ethnicity') {
    censusHeader = `${censusHeader} · ${ethCatFullLabel(ethnicityCategory(v))}`;
  }

  if (censusRows.length > 0) sections.push({ header: censusHeader, rows: censusRows });

  // --- Election section ---
  if (metric === 'partisan') {
    if (v.dem != null && v.rep != null) {
      const total = v.dem + v.rep;
      const demPct = total > 0 ? `${fmt(v.dem / total * 100, 1)}%` : undefined;
      const repPct = total > 0 ? `${fmt(v.rep / total * 100, 1)}%` : undefined;
      sections.push({
        header: electionName || 'Election',
        rows: [
          { label: 'Dem', count: fmt(v.dem), pct: demPct, color: 'text-blue-600' },
          { label: 'Rep', count: fmt(v.rep), pct: repPct, color: 'text-red-600' },
        ],
      });
    }
  } else if (metric === 'turnout') {
    const electionRows: Row[] = [];
    const turnout = scalarValue(v, 'turnout');
    if (v.vap != null) electionRows.push({ label: 'VAP', count: fmt(v.vap) });
    if (v.votes != null) electionRows.push({ label: 'Votes', count: fmt(v.votes) });
    if (turnout != null && turnout >= 0) electionRows.push({ label: 'Turnout', count: `${fmt(turnout * 100, 1)}%` });
    if (electionRows.length > 0) sections.push({ header: electionName || 'Election', rows: electionRows });
  }

  const totalRows = sections.reduce((n, s) => n + s.rows.length, 0);
  const tooltipW = 230;
  const tooltipH = 60 + totalRows * 20 + sections.length * 22;
  const offset = 14;
  const left = x + offset + tooltipW > window.innerWidth  ? x - tooltipW - offset : x + offset;
  const top  = y + offset + tooltipH > window.innerHeight ? y - tooltipH - offset : y + offset;

  const displayName = name || geoId;
  const layerLabel = layer.charAt(0).toUpperCase() + layer.slice(1);

  return createPortal(
    <div className="fixed z-50 pointer-events-none" style={{ left, top }}>
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs" style={{ minWidth: '190px' }}>
        <div className="font-semibold text-gray-800 truncate" style={{ maxWidth: '220px' }} title={displayName}>{displayName}</div>
        <div className="text-[10px] text-gray-400 mb-1">{layerLabel} · {geoId}</div>
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
      </div>
    </div>,
    document.body,
  );
}
