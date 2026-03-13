import { useRef, useState } from 'react';

import { Label } from './ui/label';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Play } from 'lucide-react';
import type { DistrictStat } from '@/app/constants/metrics';

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
  districtSwatchColors: Record<number, string>;
  wasmLoading: boolean;
  wasmError: Error | null;
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
    activeDistrict,
    onActiveDistrictChange,
    paintMode,
    onPaintModeChange,
    visualizationMode,
    onVisualizationModeChange,
    districtCounts,
    onRefreshDistricts,
    onClearAssignments,
    districtColorMetric,
    onDistrictColorMetricChange,
    districtStats,
    districtSwatchColors,
    wasmLoading,
    wasmError,
    currentZoom,
    currentLayer,
    loadingStatus,
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
                    const leanLabel = lean === null ? '—'
                      : lean > 0 ? `D+${(lean * 100).toFixed(1)}%`
                      : lean < 0 ? `R+${(-lean * 100).toFixed(1)}%`
                      : 'Even';
                    const leanClass = lean === null ? 'text-muted-foreground'
                      : lean > 0 ? 'text-blue-600'
                      : lean < 0 ? 'text-red-600'
                      : 'text-muted-foreground';

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
                          <span className={d.deviation >= 0 ? 'text-green-600' : 'text-red-600'}>
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

              {districtStats && districtStats.length > 0 && (() => {
                const totalPop = districtStats.reduce((s, d) => s + d.population, 0);
                const maxDev = Math.max(...districtStats.map(d => Math.abs(d.deviation)));
                const totalDem = districtStats.reduce((s, d) => s + d.demVotes, 0);
                const totalRep = districtStats.reduce((s, d) => s + d.repVotes, 0);
                const twoParty = totalDem + totalRep;
                const lean = twoParty > 0 ? (totalDem - totalRep) / twoParty : null;
                const wpct = (key: keyof DistrictStat) =>
                  totalPop > 0
                    ? districtStats.reduce((s, d) => s + (d[key] as number) * d.population, 0) / totalPop
                    : 0;
                const Stat = ({ label, value }: { label: string; value: string }) => (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span>{value}</span>
                  </div>
                );
                return (
                  <>
                    <Card>
                      <CardHeader className="pb-3"><CardTitle className="text-base">Population</CardTitle></CardHeader>
                      <CardContent className="space-y-2">
                        <Stat label="Total" value={totalPop.toLocaleString()} />
                        <Stat label="Max deviation" value={`±${maxDev.toFixed(2)}%`} />
                      </CardContent>
                    </Card>
                    {lean !== null && (
                      <Card>
                        <CardHeader className="pb-3"><CardTitle className="text-base">Partisan Lean</CardTitle></CardHeader>
                        <CardContent className="space-y-2">
                          <Stat
                            label="Overall"
                            value={lean > 0 ? `D+${(lean * 100).toFixed(1)}%` : lean < 0 ? `R+${(-lean * 100).toFixed(1)}%` : 'Even'}
                          />
                          <Stat label="Dem votes" value={totalDem.toLocaleString()} />
                          <Stat label="Rep votes" value={totalRep.toLocaleString()} />
                          <Stat
                            label="Districts won"
                            value={`D ${districtStats.filter(d => d.demVotes > d.repVotes).length} – R ${districtStats.filter(d => d.repVotes > d.demVotes).length}`}
                          />
                        </CardContent>
                      </Card>
                    )}
                    <Card>
                      <CardHeader className="pb-3"><CardTitle className="text-base">Demographics (2020)</CardTitle></CardHeader>
                      <CardContent className="space-y-2">
                        <Stat label="White"    value={`${wpct('whitePct').toFixed(1)}%`} />
                        <Stat label="Hispanic" value={`${wpct('hispanicPct').toFixed(1)}%`} />
                        <Stat label="Black"    value={`${wpct('blackPct').toFixed(1)}%`} />
                        <Stat label="Asian"    value={`${wpct('asianPct').toFixed(1)}%`} />
                        <Stat label="Native"   value={`${wpct('nativePct').toFixed(1)}%`} />
                        <Stat label="Pacific"  value={`${wpct('pacificPct').toFixed(1)}%`} />
                      </CardContent>
                    </Card>
                  </>
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
                  className="mt-2 flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  No parameters for this method yet.
                </div>
              )}

              {algorithm === 'pop-balance' && (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Population tolerance</Label>
                      <span className="text-sm text-muted-foreground">
                        {popTolerance.toExponential(2)}
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
                <h3 className="text-sm font-medium mb-2">WASM Status</h3>
                {wasmLoading && <div className="text-sm text-muted-foreground">Loading WASM...</div>}
                {wasmError && (
                  <div className="text-sm text-red-600">WASM Error: {wasmError.message}</div>
                )}
                {!wasmLoading && !wasmError && (
                  <div className="text-sm text-green-600">✓ WASM loaded</div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">Map Info</h3>
                <div className="text-sm text-muted-foreground space-y-1">
                  <div>Zoom: {currentZoom.toFixed(1)}</div>
                  <div>Layer: {currentLayer}</div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">Settings</h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="active-district">Active District:</Label>
                    <input
                      id="active-district"
                      type="number"
                      value={activeDistrict}
                      min={1}
                      onChange={(e) => onActiveDistrictChange(parseInt(e.target.value || '1', 10))}
                      className="w-20 h-9 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Label>Paint Mode:</Label>
                    <Button
                      variant={paintMode ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => onPaintModeChange(!paintMode)}
                    >
                      {paintMode ? 'ON' : 'OFF'}
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    <Label>Visualization:</Label>
                    <div className="flex gap-1">
                      <Button
                        variant={visualizationMode === 'districts' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => onVisualizationModeChange('districts')}
                      >
                        Districts
                      </Button>
                      <Button
                        variant={visualizationMode === 'partisan' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => onVisualizationModeChange('partisan')}
                      >
                        Partisan
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">Toy Metrics</h3>
                <div className="font-mono text-xs space-y-1">
                  {Object.keys(districtCounts).length === 0 && (
                    <div className="text-muted-foreground">(no assignments yet)</div>
                  )}
                  {Object.entries(districtCounts)
                    .sort((a, b) => Number(a[0]) - Number(b[0]))
                    .map(([d, c]) => (
                      <div key={d}>
                        D{d}: {String(c)} units
                      </div>
                    ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={onClearAssignments}>
                  Clear Assignments
                </Button>
                <Button variant="outline" className="flex-1" onClick={onRefreshDistricts}>
                  Refresh Districts
                </Button>
              </div>

              {loadingStatus && (
                <div>
                  <h3 className="text-sm font-medium mb-2">Status</h3>
                  <div className="text-sm text-muted-foreground">{loadingStatus}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
