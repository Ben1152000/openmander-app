import { Fragment, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import type { EthnicityMetric, ScalarMetric } from '@/app/constants/metrics';
import { ETHNICITY_METRICS, ethCatFromPcts, ETH_CAT_LABELS } from '@/app/constants/metrics';

interface UnitTooltipProps {
  geoId: string;
  layer: string;
  x: number;
  y: number;
  districtColorMetric: string;
  unitNamesRef: MutableRefObject<Record<string, Record<string, string>>>;
  unitPopulationRef: MutableRefObject<Record<string, number>>;
  scalarDataRef: MutableRefObject<Partial<Record<ScalarMetric, Record<string, number>>>>;
  ethnicityDataRef: MutableRefObject<Partial<Record<EthnicityMetric, Record<string, number>>>>;
  unitElectionVotesRef: MutableRefObject<Record<string, { dem: number; rep: number }>>;
  unitEthnicCountsRef: MutableRefObject<Partial<Record<EthnicityMetric, Record<string, number>>>>;
  unitLandKm2Ref: MutableRefObject<Record<string, number>>;
  unitVapRef: MutableRefObject<Record<string, number>>;
  electionNameRef: MutableRefObject<string>;
  censusNameRef: MutableRefObject<string>;
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

export function UnitTooltip({
  geoId, layer, x, y, districtColorMetric,
  unitNamesRef, unitPopulationRef, scalarDataRef, ethnicityDataRef,
  unitElectionVotesRef, unitEthnicCountsRef, unitLandKm2Ref, unitVapRef, electionNameRef, censusNameRef,
}: UnitTooltipProps) {
  const name = unitNamesRef.current[layer]?.[geoId];
  const population = unitPopulationRef.current[geoId];
  const metric = districtColorMetric;

  const sections: Section[] = [];

  // --- Census section ---
  const censusRows: Row[] = [];
  if (population != null) {
    censusRows.push({ label: 'Population', count: fmt(population) });
  }

  if (metric === 'population_density') {
    const landKm2 = unitLandKm2Ref.current[geoId];
    const stored = scalarDataRef.current['population_density']?.[geoId];
    if (landKm2 != null) censusRows.push({ label: 'Land area', count: `${fmt(landKm2, landKm2 < 10 ? 2 : landKm2 < 100 ? 1 : 0)} km²` });
    if (stored != null && stored >= 0) censusRows.push({ label: 'Density', count: `${fmt(Math.round(Math.expm1(stored)))}/km²` });
  } else if (ETHNICITY_METRICS.includes(metric as EthnicityMetric) || metric === 'ethnicity') {
    const pop = population ?? 0;
    for (const [key, label] of ETH_LABELS) {
      const count = unitEthnicCountsRef.current[key]?.[geoId];
      if (count != null) {
        censusRows.push({ label, count: fmt(count), pct: pop > 0 ? `${fmt(count / pop * 100, 1)}%` : undefined, bold: key === metric });
      }
    }
    if (metric === 'ethnicity' && censusRows.length === 1) {
      // No ethnic count data; fall back to category label
      const white = ethnicityDataRef.current['white_pct']?.[geoId] ?? -1;
      const nwPcts = (['black_pct', 'hispanic_pct', 'asian_pct', 'native_pct', 'pacific_pct'] as EthnicityMetric[])
        .map(k => ethnicityDataRef.current[k]?.[geoId] ?? -1);
      censusRows.push({ label: 'Category', count: ETH_CAT_LABELS[ethCatFromPcts(white, nwPcts)] ?? '—' });
    }
  }

  let censusHeader = censusNameRef.current || 'Census';
  if (metric === 'ethnicity') {
    const white = ethnicityDataRef.current['white_pct']?.[geoId] ?? -1;
    const nwPcts = (['black_pct', 'hispanic_pct', 'asian_pct', 'native_pct', 'pacific_pct'] as EthnicityMetric[])
      .map(k => ethnicityDataRef.current[k]?.[geoId] ?? -1);
    censusHeader = `${censusHeader} · ${ETH_CAT_LABELS[ethCatFromPcts(white, nwPcts)] ?? '—'}`;
  }

  if (censusRows.length > 0) sections.push({ header: censusHeader, rows: censusRows });

  // --- Election section ---
  if (metric === 'partisan') {
    const votes = unitElectionVotesRef.current[geoId];
    if (votes) {
      const total = votes.dem + votes.rep;
      const demPct = total > 0 ? `${fmt(votes.dem / total * 100, 1)}%` : undefined;
      const repPct = total > 0 ? `${fmt(votes.rep / total * 100, 1)}%` : undefined;
      sections.push({
        header: electionNameRef.current || 'Election',
        rows: [
          { label: 'Dem', count: fmt(votes.dem), pct: demPct, color: 'text-blue-600' },
          { label: 'Rep', count: fmt(votes.rep), pct: repPct, color: 'text-red-600' },
        ],
      });
    }
  } else if (metric === 'turnout') {
    const electionRows: Row[] = [];
    const vap = unitVapRef.current[geoId];
    const v = scalarDataRef.current['turnout']?.[geoId];
    if (vap != null) electionRows.push({ label: 'VAP', count: fmt(vap) });
    const votes = unitElectionVotesRef.current[geoId];
    if (votes) electionRows.push({ label: 'Votes', count: fmt(votes.total) });
    if (v != null && v >= 0) electionRows.push({ label: 'Turnout', count: `${fmt(v * 100, 1)}%` });
    if (electionRows.length > 0) sections.push({ header: electionNameRef.current || 'Election', rows: electionRows });
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
