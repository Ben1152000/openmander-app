import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Upload, Download, Link } from 'lucide-react';
import openmanderIcon from '/openmander-icon.svg';
import { CustomSelect } from './CustomSelect';

import { STATE_CONFIGS } from '@/app/constants/config';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import type { DistrictStat } from '@/app/constants/metrics';
import { ethCatFromStat, ETH_CAT_LABELS } from '@/app/constants/metrics';
import type { RegionStats } from '@/app/hooks/useDistrictData';
import { partisanLeanClass, partisanLeanLabel, deviationClass } from '@/app/constants/colors';
import { RankVotesChart } from './RankVotesChart';


// Log-scale slider helpers for parameters in the automation tab.
function logSliderToValue(t: number, min: number, max: number): number {
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  return Math.exp(logMin + (t / 100) * (logMax - logMin));
}

function valueToLogSlider(value: number, min: number, max: number): number {
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  return ((Math.log(value) - logMin) / (logMax - logMin)) * 100;
}

interface SidePanelProps {
  activeTab: 'summary' | 'districts' | 'automation' | 'analysis' | 'debug';
  onTabChange: (tab: 'summary' | 'districts' | 'automation' | 'analysis' | 'debug') => void;
  numDistricts: number;
  onNumDistrictsChange: (n: number) => void;
  loadedState: string;
  onLoadMap?: (state: string, districts: number) => void;
  onPendingStateChange?: (state: string) => void;
  activeDistrict: number;
  onActiveDistrictChange: (n: number) => void;
  paintMode: boolean;
  onPaintModeChange: (enabled: boolean) => void;
  visualizationMode: string;
  onVisualizationModeChange: (mode: string) => void;
  onRefreshDistricts: () => void;
  onClearAssignments: () => void;
  districtColorMetric: string;
  onDistrictColorMetricChange: (m: string) => void;
  districtStats: DistrictStat[] | null;
  regionStats: RegionStats | null;
  districtSwatchColors: Record<number, string>;
  workerReady: boolean;
  currentZoom: number;
  currentLayer: string;
  loadingStatus: string;
  algorithm: 'random-initialization' | 'pop-balance';
  onAlgorithmChange: (algorithm: 'random-initialization' | 'pop-balance') => void;
  popTolerance: number;
  onPopToleranceChange: (value: number) => void;
  popIterations: number;
  onPopIterationsChange: (value: number) => void;
  automationRunning: boolean;
  onRunAutomation: () => void;
  onExportPlan: () => void;
  onImportPlan: (file: File) => void;
}


export function SidePanel(props: SidePanelProps) {
  const {
    activeTab,
    onTabChange,
    numDistricts,
    loadedState,
    onLoadMap,
    onPendingStateChange,
    activeDistrict,
    onActiveDistrictChange,
    onRefreshDistricts,
    districtColorMetric,
    onDistrictColorMetricChange,
    districtStats,
    regionStats,
    districtSwatchColors,
    workerReady,
    loadingStatus,
    currentZoom,
    currentLayer,
    algorithm,
    onAlgorithmChange,
    popTolerance,
    onPopToleranceChange,
    popIterations,
    onPopIterationsChange,
    automationRunning,
    onRunAutomation,
    onExportPlan,
    onImportPlan,
  } = props;

  const [showUrlDialog, setShowUrlDialog] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [pendingState, setPendingState] = useState('illinois');
  const [pendingDistrictsRaw, setPendingDistrictsRaw] = useState(String(STATE_CONFIGS['illinois']?.districts ?? numDistricts));
  const [deviationMode, setDeviationMode] = useState<'percent' | 'absolute'>('percent');
  const shiftHeldOnSpinner = useRef(false);

  type LogEntry = { level: 'log' | 'warn' | 'error'; message: string; time: string };
  const [consoleLogs, setConsoleLogs] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeTab]);

  useEffect(() => {
    setConsoleLogs([]);
  }, [loadedState, numDistricts]);

  useEffect(() => {
    const MAX = 500;
    const push = (level: LogEntry['level'], args: unknown[]) => {
      const message = args.map(a => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch { return String(a); }
      }).join(' ');
      const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setConsoleLogs(prev => {
        const next = [...prev, { level, message, time }];
        return next.length > MAX ? next.slice(next.length - MAX) : next;
      });
    };

    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    console.log   = (...args) => { origLog(...args);   push('log',   args); };
    console.warn  = (...args) => { origWarn(...args);  push('warn',  args); };
    console.error = (...args) => { origError(...args); push('error', args); };
    return () => { console.log = origLog; console.warn = origWarn; console.error = origError; };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [consoleLogs]);

  const districtsError = (() => {
    const trimmed = pendingDistrictsRaw.trim();
    if (trimmed === '') return 'Required';
    if (!/^\d+$/.test(trimmed)) return 'Must be a whole number';
    const n = parseInt(trimmed, 10);
    if (n < 1 || n > 1000) return 'Must be between 1 and 1000';
    return null;
  })();

  return (
    <div className="h-full bg-background border-r flex flex-col">
      <div className="p-6 border-b">
        <div className="flex items-center gap-3">
          <img src={openmanderIcon} alt="OpenMander logo" className="w-14 h-14 flex-shrink-0 mr-1" />
          <div>
            <h1 className="text-2xl">OpenMander</h1>
            <p className="text-sm text-muted-foreground">
              Automated Congressional Redistricting
            </p>
          </div>
        </div>
      </div>

      <div className="border-b flex overflow-x-auto scrollbar-none">
        {(['summary', 'districts', 'automation', 'analysis', 'debug'] as const).map(tab => (
          <button
            key={tab}
            ref={activeTab === tab ? activeTabRef : null}
            onClick={() => onTabChange(tab)}
            className={'flex-none px-4 py-3 text-sm font-medium transition-colors capitalize ' + (
              activeTab === tab
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {activeTab === 'districts' && (
          <>
            {!districtStats || districtStats.length === 0 ? (
              <p className="text-sm text-muted-foreground p-6">No plan generated yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted border-b sticky top-0">
                  <tr>
                    <th className="text-left py-2 pl-6 pr-3 font-medium w-1/5">District</th>
                    <th className="text-right py-2 px-3 font-medium w-1/4">Population</th>
                    <th className="text-right py-1 px-3 font-medium w-1/4">
                      <button
                        className="text-sm font-medium cursor-pointer hover:text-blue-600 transition-colors"
                        onClick={() => setDeviationMode(m => m === 'percent' ? 'absolute' : 'percent')}
                        title="Toggle deviation mode"
                      >
                        {deviationMode === 'percent' ? 'Deviation\u00a0%' : 'Deviation\u00a0#'}
                      </button>
                    </th>
                    <th className="relative text-right py-1 pl-3 pr-6 font-medium w-1/4">
                      <div className="flex justify-end">
                        <CustomSelect
                          value={districtColorMetric}
                          onChange={onDistrictColorMetricChange}
                          dropdownAlign="right"
                          options={[
                            { value: 'default',            label: 'Color'      },
                            { value: 'partisan',           label: 'Partisan'   },
                            { value: 'population_density', label: 'Density'    },
                            { value: 'turnout',            label: 'Turnout'    },
                            { value: 'ethnicity',          label: 'Ethnicity'  },
                            { value: 'white_pct',          label: 'White\u00a0%'    },
                            { value: 'black_pct',          label: 'Black\u00a0%'    },
                            { value: 'hispanic_pct',       label: 'Hispanic\u00a0%' },
                            { value: 'asian_pct',          label: 'Asian\u00a0%'    },
                            { value: 'native_pct',         label: 'Native\u00a0%'   },
                            { value: 'pacific_pct',        label: 'Pacific\u00a0%'  },
                          ]}
                        />
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {regionStats && (() => {
                    const assignedPop = districtStats.reduce((sum, d) => sum + d.population, 0);
                    const unassignedPop = Math.round(regionStats.totalPop - assignedPop);
                    if (unassignedPop <= 0) return null;
                    return (
                      <tr className="border-b text-muted-foreground">
                        <td className="py-3 pl-6 pr-3">
                          <span>None</span>
                        </td>
                        <td className="py-3 px-3 text-right">{unassignedPop.toLocaleString()}</td>
                        <td className="py-3 px-3 text-right">—</td>
                        <td className="py-3 pl-3 pr-6 text-right">—</td>
                      </tr>
                    );
                  })()}
                  {districtStats.map((d) => {
                    const twoParty = d.demVotes + d.repVotes;
                    const lean = twoParty > 0 ? (d.demVotes - d.repVotes) / twoParty : null;
                    const leanLabel = partisanLeanLabel(lean);
                    const leanClass = partisanLeanClass(lean);

                    const lastColValue = (() => {
                      switch (districtColorMetric) {
                        case 'default': return { label: '—', className: 'text-muted-foreground' };
                        case 'partisan': return { label: leanLabel, className: leanClass };
                        case 'population_density': return { label: `${Math.round(d.populationDensity).toLocaleString()}/km²`, className: '' };
                        case 'turnout': return { label: d.turnout > 0 ? `${(d.turnout * 100).toFixed(1)}%` : '—', className: '' };
                        case 'white_pct': return { label: `${d.whitePct.toFixed(1)}%`, className: '' };
                        case 'black_pct': return { label: `${d.blackPct.toFixed(1)}%`, className: '' };
                        case 'hispanic_pct': return { label: `${d.hispanicPct.toFixed(1)}%`, className: '' };
                        case 'asian_pct': return { label: `${d.asianPct.toFixed(1)}%`, className: '' };
                        case 'native_pct': return { label: `${d.nativePct.toFixed(1)}%`, className: '' };
                        case 'pacific_pct': return { label: `${d.pacificPct.toFixed(1)}%`, className: '' };
                        case 'ethnicity': {
                          const cat = ethCatFromStat(d);
                          const isWhite = cat === 0 || cat === 6 || cat === 12 || cat === 18;
                          return { label: ETH_CAT_LABELS[cat] ?? '—', className: isWhite ? 'text-muted-foreground' : '' };
                        }
                        default: return { label: '—', className: 'text-muted-foreground' };
                      }
                    })();

                    const isSelected = d.district === activeDistrict;
                    return (
                      <tr
                        key={d.district}
                        className={`border-b last:border-b-0 hover:bg-accent transition-colors cursor-pointer ${isSelected ? 'bg-accent' : ''}`}
                        onClick={() => onActiveDistrictChange(d.district === activeDistrict ? 0 : d.district)}
                      >
                        <td className="py-3 pl-6 pr-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded ${isSelected ? 'ring-2 ring-foreground ring-offset-1' : ''}`} style={{ backgroundColor: districtSwatchColors[d.district] ?? d.color }} />
                            <span>{d.district}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right text-muted-foreground">
                          {Math.round(d.population).toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right">
                          {deviationMode === 'percent' ? (
                            d.population === 0 ? (
                              <span className={deviationClass(-100)}>-100.00%</span>
                            ) : (
                              <span className={deviationClass(d.deviation)}>
                                {d.deviation > 0 ? '+' : ''}{d.deviation.toFixed(2)}%
                              </span>
                            )
                          ) : (() => {
                            const target = regionStats ? regionStats.totalPop / numDistricts : 0;
                            const abs = Math.round(d.population - target) || 0;
                            const absClass = d.population === 0
                              ? deviationClass(-100)
                              : abs === 0 ? 'text-muted-foreground' : abs > 0 ? 'text-green-600' : 'text-red-600';
                            return (
                              <span className={absClass}>
                                {abs > 0 ? '+' : ''}{abs.toLocaleString()}
                              </span>
                            );
                          })()}
                        </td>
                        <td className={`py-3 pl-3 pr-6 text-right ${lastColValue.className}`}>
                          {lastColValue.label}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
        <div className={`p-6 space-y-6 ${activeTab === 'districts' ? 'hidden' : ''}`}>
          {activeTab === 'summary' && (
            <>
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label htmlFor="state-select">State</Label>
                  <select
                    id="state-select"
                    value={pendingState}
                    onChange={(e) => {
                      const s = e.target.value;
                      setPendingState(s);
                      const d = STATE_CONFIGS[s]?.districts;
                      if (d) setPendingDistrictsRaw(String(d));
                      onPendingStateChange?.(s);
                    }}
                    className="mt-2 flex h-10 w-full items-center justify-between gap-2 rounded-md border-2 border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/20 transition-colors"
                  >
                    {[
                      'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
                      'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho',
                      'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana',
                      'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi',
                      'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey',
                      'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma',
                      'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota',
                      'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
                      'west virginia', 'wisconsin', 'wyoming',
                    ].map((value) => (
                      <option key={value} value={value} disabled={!(value in STATE_CONFIGS)}>
                        {value.replace(/\b\w/g, c => c.toUpperCase())}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-32">
                  <Label htmlFor="num-districts-select">Districts</Label>
                  <input
                    id="num-districts-select"
                    type="number"
                    value={pendingDistrictsRaw}
                    min={1}
                    max={1000}
                    onMouseDown={(e) => { shiftHeldOnSpinner.current = e.shiftKey; }}
                    onKeyDown={(e) => {
                      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                        e.preventDefault();
                        const prev = parseInt(pendingDistrictsRaw, 10);
                        if (!isNaN(prev)) {
                          const dir = e.key === 'ArrowUp' ? 1 : -1;
                          setPendingDistrictsRaw(String(Math.min(1000, Math.max(1, prev + dir * 10))));
                        }
                      }
                    }}
                    onChange={(e) => {
                      if (shiftHeldOnSpinner.current) {
                        shiftHeldOnSpinner.current = false;
                        const prev = parseInt(pendingDistrictsRaw, 10);
                        const next = parseInt(e.target.value, 10);
                        if (!isNaN(prev) && !isNaN(next) && prev !== next) {
                          const dir = next > prev ? 1 : -1;
                          setPendingDistrictsRaw(String(Math.min(1000, Math.max(1, prev + dir * 10))));
                          return;
                        }
                      }
                      setPendingDistrictsRaw(e.target.value);
                    }}
                    className={`mt-2 flex h-10 w-full items-center justify-between gap-2 rounded-md border-2 bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/20 transition-colors ${districtsError ? 'border-destructive focus-visible:border-destructive' : 'border-input focus-visible:border-primary'}`}
                  />
                </div>
              </div>

              {districtsError && (
                <p className="text-xs text-destructive -mt-4">{districtsError}</p>
              )}

              <Button
                className="w-full"
                disabled={!!districtsError || !!loadingStatus || automationRunning}
                onClick={() => {
                  const hasData = districtStats?.some(d => d.population > 0);
                  if (hasData && !window.confirm('This will discard the current map. Are you sure?')) return;
                  onLoadMap?.(pendingState, parseInt(pendingDistrictsRaw, 10));
                }}
              >
                Create Map
              </Button>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" disabled={!workerReady} onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.csv';
                  input.onchange = () => { if (input.files?.[0]) onImportPlan(input.files[0]); };
                  input.click();
                }}>
                  <Download className="w-4 h-4 mr-2" /> Import
                </Button>
                <Button variant="outline" className="flex-1" onClick={onExportPlan} disabled={!workerReady}>
                  <Upload className="w-4 h-4 mr-2" /> Export
                </Button>
                <Button variant="outline" className="flex-1" disabled={!workerReady} onClick={() => { setUrlInput(''); setShowUrlDialog(true); }}>
                  <Link className="w-4 h-4 mr-2" /> From URL
                </Button>
              </div>

              {showUrlDialog && createPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowUrlDialog(false)}>
                  <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
                    <div>
                      <h2 className="text-base font-semibold">Load Map from URL</h2>
                      <p className="text-sm text-muted-foreground mt-1">Paste a link from Dave's Redistricting or Districtr.</p>
                    </div>
                    <input
                      type="url"
                      placeholder="https://..."
                      value={urlInput}
                      onChange={e => setUrlInput(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/20"
                      autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" onClick={() => setShowUrlDialog(false)}>Cancel</Button>
                      <Button disabled={!urlInput.trim()}>Load</Button>
                    </div>
                  </div>
                </div>,
                document.body
              )}

              {regionStats && (() => {
                const Stat = ({ label, value }: { label: string; value: string }) => (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span>{value}</span>
                  </div>
                );
                const Section = ({ title }: { title: string }) => (
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{title}</p>
                );

                const maxDev = districtStats && districtStats.some(d => d.population > 0)
                  ? Math.max(...districtStats.map(d => Math.abs(d.deviation)))
                  : null;
                const twoParty = regionStats.demVotes + regionStats.repVotes;
                const lean = twoParty > 0 ? (regionStats.demVotes - regionStats.repVotes) / twoParty : null;
                const assignedDistricts = districtStats?.filter(d => d.population > 0) ?? [];

                return (
                  <Card>
                    <CardContent className="pt-4 space-y-4">
                      <div>
                        <Section title="Population" />
                        <div className="space-y-1.5">
                          <Stat label="Total" value={regionStats.totalPop.toLocaleString()} />
                          {maxDev !== null && (
                            <Stat label="Max deviation" value={`±${maxDev.toFixed(2)}%`} />
                          )}
                        </div>
                      </div>
                      {lean !== null && (
                        <div className="border-t pt-4">
                          <Section title="Partisan Lean" />
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Overall</span>
                              <span className={partisanLeanClass(lean)}>{partisanLeanLabel(lean)}</span>
                            </div>
                            <Stat label="Dem votes" value={regionStats.demVotes.toLocaleString()} />
                            <Stat label="Rep votes" value={regionStats.repVotes.toLocaleString()} />
                            {assignedDistricts.length > 0 && (
                              <Stat
                                label="Districts won"
                                value={`D ${assignedDistricts.filter(d => d.demVotes > d.repVotes).length} – R ${assignedDistricts.filter(d => d.repVotes > d.demVotes).length}`}
                              />
                            )}
                          </div>
                        </div>
                      )}
                      <div className="border-t pt-4">
                        <Section title="Demographics (2020)" />
                        <div className="space-y-1.5">
                          <Stat label="White"    value={`${regionStats.whitePct.toFixed(1)}%`} />
                          <Stat label="Hispanic" value={`${regionStats.hispanicPct.toFixed(1)}%`} />
                          <Stat label="Black"    value={`${regionStats.blackPct.toFixed(1)}%`} />
                          <Stat label="Asian"    value={`${regionStats.asianPct.toFixed(1)}%`} />
                          <Stat label="Native"   value={`${regionStats.nativePct.toFixed(1)}%`} />
                          <Stat label="Pacific"  value={`${regionStats.pacificPct.toFixed(1)}%`} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
            </>
          )}

          {activeTab === 'automation' && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="algorithm-select">Algorithm</Label>
                <select
                  id="algorithm-select"
                  value={algorithm}
                  onChange={(e) => onAlgorithmChange(e.target.value as 'random-initialization' | 'pop-balance')}
                  className="mt-2 flex h-10 w-full items-center justify-between gap-2 rounded-md border-2 border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/20 transition-colors"
                >
                  <option value="random-initialization">Random initialization</option>
                  <option value="pop-balance">Population balance</option>
                  <option value="shortest-splitline" disabled>Shortest Splitline</option>
                  <option value="compact-districts" disabled>Compact Districts</option>
                  <option value="population-equality" disabled>Population Equality</option>
                </select>
              </div>

              {algorithm === 'random-initialization' && (
                <div className="text-sm text-muted-foreground">
                  No parameters for this method.
                </div>
              )}

              {algorithm === 'pop-balance' && (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Population tolerance</Label>
                      <span className="text-sm text-muted-foreground">
                        {+(popTolerance * 100).toPrecision(2)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={valueToLogSlider(popTolerance, 1e-6, 1)}
                      onChange={(e) => {
                        const t = Number(e.target.value);
                        onPopToleranceChange(logSliderToValue(t, 1e-6, 1));
                      }}
                      className="w-full h-2 bg-muted rounded-lg cursor-pointer accent-primary"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Iterations</Label>
                      <span className="text-sm text-muted-foreground">
                        {Math.round(popIterations).toLocaleString()}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={valueToLogSlider(popIterations, 1, 10000)}
                      onChange={(e) => {
                        const t = Number(e.target.value);
                        onPopIterationsChange(
                          Math.round(logSliderToValue(t, 1, 10000))
                        );
                      }}
                      className="w-full h-2 bg-muted rounded-lg cursor-pointer accent-primary"
                    />
                  </div>
                </>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1"
                  disabled={automationRunning || !workerReady}
                  onClick={onRunAutomation}
                >
                  {automationRunning ? 'Running...' : 'Generate'}
                </Button>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium">Console</h3>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setConsoleLogs([])}
                  >
                    Clear
                  </button>
                </div>
                <div className="h-64 overflow-y-auto rounded-md border bg-muted/40 p-2 font-mono text-xs space-y-0.5">
                  {consoleLogs.length === 0 && (
                    <div className="text-muted-foreground italic">No messages yet.</div>
                  )}
                  {consoleLogs.map((entry, i) => (
                    <div key={i} className={
                      entry.level === 'error' ? 'text-red-600' :
                      entry.level === 'warn'  ? 'text-yellow-600' :
                      'text-foreground'
                    }>
                      <span className="text-muted-foreground select-none">{entry.time} </span>
                      {entry.message}
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'analysis' && (
            <div className="space-y-6">
              {districtStats && districtStats.some(d => d.demVotes + d.repVotes > 0)
                ? <RankVotesChart districtStats={districtStats} activeDistrict={activeDistrict} onDistrictSelect={onActiveDistrictChange} />
                : <p className="text-sm text-muted-foreground">No partisan data available. Generate a plan first.</p>
              }
            </div>
          )}

          {activeTab === 'debug' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-2">Worker Status</h3>
                {!workerReady && <div className="text-sm text-muted-foreground">Worker initializing...</div>}
                {workerReady && <div className="text-sm text-green-600">✓ Worker ready</div>}
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">Map Info</h3>
                <div className="text-sm text-muted-foreground space-y-1">
                  <div>Zoom: {currentZoom.toFixed(1)}</div>
                  <div>Layer: {currentLayer}</div>
                </div>
              </div>

              <Button variant="outline" className="w-full" onClick={onRefreshDistricts}>
                Refresh Districts
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
