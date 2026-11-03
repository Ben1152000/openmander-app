// WorkerPlan — async JS wrapper around the planWorker message protocol.
//
// Each method posts a message to the worker and returns a Promise that
// resolves when the operation completes. Streaming data (assignments,
// geometries, stats, logs) is delivered via callbacks throughout.
//
// Only one operation runs at a time. Concurrent calls are not supported.
// Exception: getColumns() is answered out of band (matched by request id), so it
// can run alongside a pending operation.

export type GeometryItem = { district: number; wkb: Uint8Array };

export type DistrictStat = {
  district: number; color: string; population: number; deviation: number;
  demVotes: number; repVotes: number; areaSqKm: number; populationDensity: number;
  turnout: number; vap: number; votesCast: number;
  whitePct: number; blackPct: number; hispanicPct: number;
  asianPct: number; nativePct: number; pacificPct: number;
};

export type RegionStats = {
  totalPop: number; demVotes: number; repVotes: number;
  whitePct: number; blackPct: number; hispanicPct: number;
  asianPct: number; nativePct: number; pacificPct: number;
};

export type ReadyPayload = {
  geoIdIndex: Record<string, string[]>;
  unitNames: Record<string, string[]>;
  blockParents: Record<string, Uint32Array>;
  seriesNames: string[];
};

/** layer → series → values (index-aligned with the layer's units). */
export type ColumnsPayload = Record<string, Record<string, Float64Array>>;

export type WorkerPlanCallbacks = {
  onAssignments: (data: Uint32Array, done: boolean) => void;
  onGeometries: (items: GeometryItem[], demTotals: number[] | null, repTotals: number[] | null) => void;
  onStats: (districtStats: DistrictStat[], regionStats: RegionStats) => void;
  onReady: (payload: ReadyPayload) => void;
  onLog: (message: string) => void;
};

export class WorkerPlan {
  private worker: Worker;
  private callbacks: WorkerPlanCallbacks;

  // State for the currently pending operation.
  private resolve: (() => void) | null = null;
  private reject: ((err: Error) => void) | null = null;
  private waitingFor: 'ready' | 'stats' | null = null;

  // Out-of-band column requests, keyed by request id.
  private nextRequestId = 1;
  private columnRequests = new Map<number, { resolve: (c: ColumnsPayload) => void; reject: (e: Error) => void }>();

  constructor(worker: Worker, callbacks: WorkerPlanCallbacks) {
    this.worker = worker;
    this.callbacks = callbacks;
    worker.addEventListener('message', this.handleMessage);
    worker.addEventListener('error', this.handleError);
  }

  private handleMessage = (e: MessageEvent) => {
    const msg = e.data;

    switch (msg.type) {
      case 'log':
        this.callbacks.onLog(msg.message);
        break;

      case 'ready':
        this.callbacks.onReady({
          geoIdIndex: msg.geoIdIndex ?? {},
          unitNames: msg.unitNames ?? {},
          blockParents: msg.blockParents ?? {},
          seriesNames: msg.seriesNames ?? [],
        });
        if (this.waitingFor === 'ready') this.settle();
        break;

      case 'assignments':
        this.callbacks.onAssignments(msg.data, msg.done);
        break;

      case 'geometries':
        this.callbacks.onGeometries(msg.items, msg.demTotals, msg.repTotals);
        break;

      case 'stats':
        this.callbacks.onStats(msg.districtStats, msg.regionStats);
        if (this.waitingFor === 'stats' && !msg.unsolicited) this.settle();
        break;

      case 'columns': {
        const request = this.columnRequests.get(msg.id);
        this.columnRequests.delete(msg.id);
        if (msg.error) request?.reject(new Error(msg.error));
        else request?.resolve(msg.columns);
        break;
      }

      case 'error':
        console.error('[Worker] Error:', msg.message);
        this.fail(new Error(msg.message));
        break;
    }
  };

  private handleError = (e: ErrorEvent) => {
    console.error('[Worker] Uncaught error:', e.message, e);
    this.fail(new Error(e.message));
    for (const request of this.columnRequests.values()) request.reject(new Error(e.message));
    this.columnRequests.clear();
  };

  private settle() {
    this.resolve?.();
    this.resolve = null;
    this.reject = null;
    this.waitingFor = null;
  }

  private fail(err: Error) {
    this.reject?.(err);
    this.resolve = null;
    this.reject = null;
    this.waitingFor = null;
  }

  private call(waitFor: 'ready' | 'stats', msg: object, transfer: Transferable[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.waitingFor = waitFor;
      this.worker.postMessage(msg, transfer);
    });
  }

  /// Load a pack and create a plan. In production the pack buffers are transferred
  /// (detached on this side) to avoid keeping a second ~1 GB copy on the main thread.
  /// Dev builds copy instead, since a hot-reload remount re-runs init with the same buffers.
  init(packFiles: Record<string, Uint8Array>, numDistricts: number): Promise<void> {
    const buffers = new Set(Object.values(packFiles).map(a => a.buffer as ArrayBuffer));
    const transfer = import.meta.env.DEV ? [] : [...buffers];
    return this.call('ready', { type: 'init', packFiles, numDistricts }, transfer);
  }

  /// Replace the plan with an empty one on the already-loaded map.
  newPlan(numDistricts: number): Promise<void> {
    return this.call('stats', { type: 'new-plan', numDistricts });
  }

  /// Fetch data columns for every layer. Missing series are omitted from the result.
  getColumns(series: string[]): Promise<ColumnsPayload> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.columnRequests.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'get-columns', id, series });
    });
  }

  randomize(): Promise<void> {
    return this.call('stats', { type: 'randomize' });
  }

  randomizeMinimizeCountySplits(series: string): Promise<void> {
    return this.call('stats', { type: 'randomize-minimize-county-splits', series });
  }

  equalize(series: string, tolerance: number, maxIter: number, chunkSize?: number): Promise<void> {
    return this.call('stats', { type: 'equalize', series, tolerance, maxIter, chunkSize });
  }

  equalizeExact(series: string): Promise<void> {
    return this.call('stats', { type: 'equalize-exact', series });
  }

  debugEqualizationGraph(series: string): Promise<void> {
    return this.call('stats', { type: 'debug-equalization-graph', series });
  }

  computeGeometries(): Promise<void> {
    return this.call('stats', { type: 'compute-geometries' });
  }

  /// Assign all blocks belonging to a geographic unit to a given district.
  /// `layer`: geographic level ("block", "vtd", "tract", "county", etc.)
  /// `geoId`: FIPS identifier for the unit at that level.
  /// `district`: target district (1-indexed; 0 = unassigned). Contiguity is not enforced.
  assignUnit(layer: string, geoId: string, district: number): Promise<void> {
    return this.call('stats', { type: 'assign-unit', layer, geoId, district });
  }

  /// Assign all blocks belonging to multiple geographic units to a district in one worker call.
  /// More efficient than calling assignUnit repeatedly: geometry/stats recompute only once.
  assignUnitsBatch(layer: string, geoIds: string[], district: number): Promise<void> {
    return this.call('stats', { type: 'assign-units-batch', layer, geoIds, district });
  }

  anneal(configJson: string): Promise<void> {
    return this.call('stats', { type: 'anneal', configJson });
  }

  setAssignments(data: Uint32Array): Promise<void> {
    return this.call('stats', { type: 'set-assignments', data }, [data.buffer]);
  }

  abort(): void {
    this.worker.postMessage({ type: 'abort' });
  }

  setDataSeries(electionSeries: string, censusSeries: string): void {
    this.worker.postMessage({ type: 'set-data-series', electionSeries, censusSeries });
  }

  terminate() {
    this.worker.terminate();
  }
}
