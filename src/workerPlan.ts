// WorkerPlan — async JS wrapper around the planWorker message protocol.
//
// Each method posts a message to the worker and returns a Promise that
// resolves when the operation completes. Streaming data (assignments,
// geometries, stats, logs) is delivered via callbacks throughout.
//
// Only one operation runs at a time. Concurrent calls are not supported.

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

export type WorkerPlanCallbacks = {
  onAssignments: (data: Uint32Array, done: boolean) => void;
  onGeometries: (items: GeometryItem[], demTotals: number[] | null, repTotals: number[] | null) => void;
  onStats: (districtStats: DistrictStat[], regionStats: RegionStats) => void;
  onReady: (geoIdIndex: Record<string, string[]>) => void;
  onLog: (message: string) => void;
};

export class WorkerPlan {
  private worker: Worker;
  private callbacks: WorkerPlanCallbacks;

  // State for the currently pending operation.
  private resolve: (() => void) | null = null;
  private reject: ((err: Error) => void) | null = null;
  private waitingFor: 'ready' | 'stats' | null = null;

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
        this.callbacks.onReady(msg.geoIdIndex ?? {});
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
        if (this.waitingFor === 'stats') this.settle();
        break;

      case 'error':
        console.error('[Worker] Error:', msg.message);
        this.fail(new Error(msg.message));
        break;
    }
  };

  private handleError = (e: ErrorEvent) => {
    console.error('[Worker] Uncaught error:', e.message, e);
    this.fail(new Error(e.message));
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

  init(packFiles: Record<string, Uint8Array>, numDistricts: number): Promise<void> {
    return this.call('ready', { type: 'init', packFiles, numDistricts });
  }

  randomize(): Promise<void> {
    return this.call('stats', { type: 'randomize' });
  }

  equalize(series: string, tolerance: number, maxIter: number, chunkSize?: number): Promise<void> {
    return this.call('stats', { type: 'equalize', series, tolerance, maxIter, chunkSize });
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

  setAssignments(data: Uint32Array): Promise<void> {
    return this.call('stats', { type: 'set-assignments', data }, [data.buffer]);
  }

  terminate() {
    this.worker.terminate();
  }
}
