import { useEffect, useRef, useState } from 'react';

import { Label } from './ui/label';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Play } from 'lucide-react';
import type { DistrictStat } from '@/app/constants/metrics';
import type { RegionStats } from '@/app/hooks/useDistrictData';
import { partisanLeanClass, partisanLeanLabel, deviationClass } from '@/app/constants/colors';

const STATE_DISTRICTS: Record<string, number> = {
  alabama: 7, alaska: 1, arizona: 9, arkansas: 4, california: 52, colorado: 8,
  connecticut: 5, delaware: 1, florida: 28, georgia: 14, hawaii: 2, idaho: 2,
  illinois: 17, indiana: 9, iowa: 4, kansas: 4, kentucky: 6, louisiana: 6,
  maine: 2, maryland: 8, massachusetts: 9, michigan: 13, minnesota: 8,
  mississippi: 4, missouri: 8, montana: 2, nebraska: 3, nevada: 4,
  'new-hampshire': 2, 'new-jersey': 12, 'new-mexico': 3, 'new-york': 26,
  'north-carolina': 14, 'north-dakota': 1, ohio: 15, oklahoma: 5, oregon: 6,
  pennsylvania: 17, 'rhode-island': 2, 'south-carolina': 7, 'south-dakota': 1,
  tennessee: 9, texas: 38, utah: 4, vermont: 1, virginia: 11, washington: 10,
  'west-virginia': 2, wisconsin: 8, wyoming: 1,
};

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
  activeDistrict: number;
  onActiveDistrictChange: (n: number) => void;
  paintMode: boolean;
  onPaintModeChange: (enabled: boolean) => void;
  visualizationMode: string;
  onVisualizationModeChange: (mode: string) => void;
  districtCounts: Record<number, number>;
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
  onRunAutomation: () => void;
}


export function SidePanel(props: SidePanelProps) {
  const {
    activeTab,
    onTabChange,
    numDistricts,
    onLoadMap,
    onRefreshDistricts,
    districtColorMetric,
    onDistrictColorMetricChange,
    districtStats,
    regionStats,
    districtSwatchColors,
    workerReady,
    currentZoom,
    currentLayer,
    algorithm,
    onAlgorithmChange,
    popTolerance,
    onPopToleranceChange,
    popIterations,
    onPopIterationsChange,
    onRunAutomation,
  } = props;

  const [pendingState, setPendingState] = useState('illinois');
  const [pendingDistrictsRaw, setPendingDistrictsRaw] = useState(String(STATE_DISTRICTS['illinois'] ?? numDistricts));
  const shiftHeldOnSpinner = useRef(false);

  type LogEntry = { level: 'log' | 'warn' | 'error'; message: string; time: string };
  const [consoleLogs, setConsoleLogs] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement | null>(null);

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
        <h1 className="text-2xl mb-1">OpenMander</h1>
        <p className="text-sm text-muted-foreground">
          Automated Congressional Redistricting
        </p>
      </div>

      <div className="border-b flex overflow-x-auto scrollbar-none">
        <button
          onClick={() => onTabChange('summary')}
          className={'flex-none px-4 py-3 text-sm font-medium transition-colors ' + (
            activeTab === 'summary'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Summary
        </button>
        <button
          onClick={() => onTabChange('districts')}
          className={'flex-none px-4 py-3 text-sm font-medium transition-colors ' + (
            activeTab === 'districts'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Districts
        </button>
        <button
          onClick={() => onTabChange('automation')}
          className={'flex-none px-4 py-3 text-sm font-medium transition-colors ' + (
            activeTab === 'automation'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Automation
        </button>
        <button
          onClick={() => onTabChange('analysis')}
          className={'flex-none px-4 py-3 text-sm font-medium transition-colors ' + (
            activeTab === 'analysis'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Analysis
        </button>
        <button
          onClick={() => onTabChange('debug')}
          className={'flex-none px-4 py-3 text-sm font-medium transition-colors ' + (
            activeTab === 'debug'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Debug
        </button>
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
                    <th className="text-left py-2 pl-6 pr-3 font-medium">District</th>
                    <th className="text-right py-2 px-3 font-medium">Population</th>
                    <th className="text-right py-2 px-3 font-medium">Deviation</th>
                    <th className="text-right py-1 pl-3 pr-6 font-medium w-1/3">
                      <select
                        value={districtColorMetric}
                        onChange={e => onDistrictColorMetricChange(e.target.value as typeof districtColorMetric)}
                        className="bg-transparent text-sm font-medium cursor-pointer outline-none text-right w-full"
                      >
                        <option value="default">Color</option>
                        <option value="partisan">Partisan</option>
                        <option value="population_density">Density</option>
                        <option value="white_pct">White %</option>
                        <option value="black_pct">Black %</option>
                        <option value="hispanic_pct">Hispanic %</option>
                        <option value="asian_pct">Asian %</option>
                        <option value="native_pct">Native %</option>
                        <option value="pacific_pct">Pacific %</option>
                      </select>
                    </th>
                  </tr>
                </thead>
                <tbody>
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
                        case 'white_pct': return { label: `${d.whitePct.toFixed(1)}%`, className: '' };
                        case 'black_pct': return { label: `${d.blackPct.toFixed(1)}%`, className: '' };
                        case 'hispanic_pct': return { label: `${d.hispanicPct.toFixed(1)}%`, className: '' };
                        case 'asian_pct': return { label: `${d.asianPct.toFixed(1)}%`, className: '' };
                        case 'native_pct': return { label: `${d.nativePct.toFixed(1)}%`, className: '' };
                        case 'pacific_pct': return { label: `${d.pacificPct.toFixed(1)}%`, className: '' };
                        default: return { label: '—', className: 'text-muted-foreground' };
                      }
                    })();

                    return (
                      <tr key={d.district} className="border-b last:border-b-0 hover:bg-accent transition-colors">
                        <td className="py-3 pl-6 pr-3">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: districtSwatchColors[d.district] ?? d.color }} />
                            <span>{d.district}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right text-muted-foreground">
                          {Math.round(d.population).toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <span className={deviationClass(d.deviation)}>
                            {d.deviation >= 0 ? '+' : ''}{d.deviation.toFixed(2)}%
                          </span>
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
                      const d = STATE_DISTRICTS[s];
                      if (d) setPendingDistrictsRaw(String(d));
                    }}
                    className="mt-2 flex h-10 w-full items-center justify-between gap-2 rounded-md border-2 border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/20 transition-colors"
                  >
                    <option value="alabama" disabled>Alabama</option>
                    <option value="arizona" disabled>Arizona</option>
                    <option value="arkansas" disabled>Arkansas</option>
                    <option value="california" disabled>California</option>
                    <option value="colorado" disabled>Colorado</option>
                    <option value="connecticut" disabled>Connecticut</option>
                    <option value="delaware" disabled>Delaware</option>
                    <option value="florida" disabled>Florida</option>
                    <option value="georgia" disabled>Georgia</option>
                    <option value="idaho" disabled>Idaho</option>
                    <option value="illinois">Illinois</option>
                    <option value="indiana">Indiana</option>
                    <option value="iowa">Iowa</option>
                    <option value="kansas" disabled>Kansas</option>
                    <option value="kentucky" disabled>Kentucky</option>
                    <option value="louisiana" disabled>Louisiana</option>
                    <option value="maine" disabled>Maine</option>
                    <option value="maryland" disabled>Maryland</option>
                    <option value="massachusetts" disabled>Massachusetts</option>
                    <option value="michigan" disabled>Michigan</option>
                    <option value="minnesota" disabled>Minnesota</option>
                    <option value="mississippi" disabled>Mississippi</option>
                    <option value="missouri" disabled>Missouri</option>
                    <option value="montana" disabled>Montana</option>
                    <option value="nebraska" disabled>Nebraska</option>
                    <option value="nevada" disabled>Nevada</option>
                    <option value="new-hampshire" disabled>New Hampshire</option>
                    <option value="new-jersey" disabled>New Jersey</option>
                    <option value="new-mexico" disabled>New Mexico</option>
                    <option value="new-york" disabled>New York</option>
                    <option value="north-carolina" disabled>North Carolina</option>
                    <option value="north-dakota" disabled>North Dakota</option>
                    <option value="ohio" disabled>Ohio</option>
                    <option value="oklahoma" disabled>Oklahoma</option>
                    <option value="oregon" disabled>Oregon</option>
                    <option value="pennsylvania" disabled>Pennsylvania</option>
                    <option value="rhode-island" disabled>Rhode Island</option>
                    <option value="south-carolina" disabled>South Carolina</option>
                    <option value="south-dakota" disabled>South Dakota</option>
                    <option value="tennessee" disabled>Tennessee</option>
                    <option value="texas" disabled>Texas</option>
                    <option value="utah" disabled>Utah</option>
                    <option value="vermont" disabled>Vermont</option>
                    <option value="virginia" disabled>Virginia</option>
                    <option value="washington" disabled>Washington</option>
                    <option value="west-virginia" disabled>West Virginia</option>
                    <option value="wisconsin" disabled>Wisconsin</option>
                    <option value="wyoming" disabled>Wyoming</option>
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
                disabled={!!districtsError}
                onClick={() => onLoadMap?.(pendingState, parseInt(pendingDistrictsRaw, 10))}
              >
                Load Map
              </Button>

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
                      className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
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
                      className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                  </div>
                </>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1"
                  onClick={onRunAutomation}
                >
                  <Play className="mr-2 size-4" />
                  Generate
                </Button>
              </div>
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
        </div>
      </div>
    </div>
  );
}
