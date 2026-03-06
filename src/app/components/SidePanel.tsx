import { useRef, useState } from 'react';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Users, TrendingUp, AlertCircle, Play, RotateCcw } from 'lucide-react';

interface SidePanelProps {
  activeTab: 'summary' | 'districts' | 'automation' | 'debug';
  onTabChange: (tab: 'summary' | 'districts' | 'automation' | 'debug') => void;
  numDistricts: number;
  onNumDistrictsChange: (n: number) => void;
  onLoadMap?: (districts: number) => void;
  activeDistrict: number;
  onActiveDistrictChange: (n: number) => void;
  paintMode: boolean;
  onPaintModeChange: (enabled: boolean) => void;
  visualizationMode: string;
  onVisualizationModeChange: (mode: string) => void;
  districtCounts: Record<number, number>;
  onRandomize: () => void;
  onOptimize: () => void;
  onClearAssignments: () => void;
  wasmLoading: boolean;
  wasmError: Error | null;
  currentZoom: number;
  currentLayer: string;
  loadingStatus: string;
}

const mockDistricts = [
  { id: 1, number: 1, population: 762450, deviation: 0.2, compactness: 0.78, color: 'hsl(57 70% 50%)' },
  { id: 2, number: 2, population: 758920, deviation: -0.3, compactness: 0.82, color: 'hsl(114 70% 50%)' },
  { id: 3, number: 3, population: 765100, deviation: 0.5, compactness: 0.71, color: 'hsl(171 70% 50%)' },
  { id: 4, number: 4, population: 761230, deviation: 0.1, compactness: 0.85, color: 'hsl(228 70% 50%)' },
];

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
    onRandomize,
    onOptimize,
    onClearAssignments,
    wasmLoading,
    wasmError,
    currentZoom,
    currentLayer,
    loadingStatus,
  } = props;

  const [pendingDistrictsRaw, setPendingDistrictsRaw] = useState(String(numDistricts));
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

      <div className="border-b flex">
        <button
          onClick={() => onTabChange('summary')}
          className={'flex-1 px-4 py-3 text-sm font-medium transition-colors ' + (
            activeTab === 'summary'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Summary
        </button>
        <button
          onClick={() => onTabChange('districts')}
          className={'flex-1 px-4 py-3 text-sm font-medium transition-colors ' + (
            activeTab === 'districts'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Districts
        </button>
        <button
          onClick={() => onTabChange('automation')}
          className={'flex-1 px-4 py-3 text-sm font-medium transition-colors ' + (
            activeTab === 'automation'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Automation
        </button>
        <button
          onClick={() => onTabChange('debug')}
          className={'flex-1 px-4 py-3 text-sm font-medium transition-colors ' + (
            activeTab === 'debug'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Debug
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          {activeTab === 'summary' && (
            <>
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label htmlFor="state-select">State</Label>
                  <select
                    id="state-select"
                    defaultValue="illinois"
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
                    <option value="indiana" disabled>Indiana</option>
                    <option value="iowa" disabled>Iowa</option>
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
                onClick={() => onLoadMap?.(parseInt(pendingDistrictsRaw, 10))}
              >
                Load Map
              </Button>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Redistricting Metrics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="size-4 text-muted-foreground" />
                      <span className="text-sm">Total Population</span>
                    </div>
                    <span className="text-sm">12,807,140</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="size-4 text-muted-foreground" />
                      <span className="text-sm">Avg. Compactness</span>
                    </div>
                    <span className="text-sm">0.78</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="size-4 text-muted-foreground" />
                      <span className="text-sm">Max Deviation</span>
                    </div>
                    <span className="text-sm">0.5%</span>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {activeTab === 'districts' && (
            <div>
              <h2 className="mb-3">Districts</h2>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="text-left py-2 px-3 font-medium">District</th>
                      <th className="text-right py-2 px-3 font-medium">Population</th>
                      <th className="text-right py-2 px-3 font-medium">Deviation</th>
                      <th className="text-right py-2 px-3 font-medium">Compact.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockDistricts.map((district) => (
                      <tr
                        key={district.id}
                        className="border-b last:border-b-0 hover:bg-accent cursor-pointer transition-colors"
                      >
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded"
                              style={{ backgroundColor: district.color }}
                            />
                            <span>District {district.number}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right text-muted-foreground">
                          {district.population.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <span
                            className={
                              district.deviation > 0 ? 'text-green-600' : 'text-red-600'
                            }
                          >
                            {district.deviation > 0 ? '+' : ''}
                            {district.deviation}%
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right text-muted-foreground">
                          {district.compactness}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'automation' && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="algorithm-select">Algorithm</Label>
                <select
                  id="algorithm-select"
                  className="mt-2 flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="tabu-balance">Tabu Balance</option>
                  <option value="shortest-splitline">Shortest Splitline</option>
                  <option value="compact-districts">Compact Districts</option>
                  <option value="population-equality">Population Equality</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Compactness Weight</Label>
                  <span className="text-sm text-muted-foreground">75%</span>
                </div>
                <input
                  type="range"
                  defaultValue={75}
                  min={0}
                  max={100}
                  className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button className="flex-1" onClick={onOptimize} disabled={!onOptimize}>
                  <Play className="mr-2 size-4" />
                  Generate
                </Button>
                <Button variant="outline" onClick={onRandomize} disabled={!onRandomize}>
                  <RotateCcw className="size-4" />
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
                        variant={visualizationMode === 'default' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => onVisualizationModeChange('default')}
                      >
                        Default
                      </Button>
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

              <div>
                <Button variant="outline" className="w-full" onClick={onClearAssignments}>
                  Clear Assignments
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
