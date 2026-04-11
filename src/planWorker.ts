// Persistent Web Worker for plan computation.
// The WasmMap is loaded once on 'init' and reused across calls.
//
// Messages in:
//   { type: 'init', packFiles: Record<string, Uint8Array>, numDistricts: number }
//   { type: 'randomize' }
//   { type: 'equalize', series: string, tolerance: number, maxIter: number, chunkSize?: number }
//   { type: 'compute-geometries' }
//   { type: 'assign-unit', layer: string, geoId: string, district: number }
//
// Messages out:
//   { type: 'ready' }                                          — init complete
//   { type: 'assignments', data: Uint32Array, done: boolean } — progress or completion (buffer transferred)
//   { type: 'geometries', items: {district: number, wkb: Uint8Array}[] } — WKB per district (buffers transferred)
//   { type: 'stats', districtStats: DistrictStat[], regionStats: RegionStats } — district/region stats
//   { type: 'log', message: string }                          — forwarded console.log (worker runs off main thread)
//   { type: 'error', message: string }

import init, { WasmMap, WasmPlan } from '../wasm/pkg/openmander';

// Forward logs to the main thread so they appear in the DevTools console under the page context.
function log(message: string) {
  (self as any).postMessage({ type: 'log', message });
}

// Intercept console methods so WASM output (web_sys::console::log etc.) is forwarded to the main thread.
// Must run before WASM init so the patched console is in place when the module loads.
const stringify = (arg: any): string => {
  if (typeof arg === 'string') return arg;
  if (arg === null || arg === undefined) return String(arg);
  try { return JSON.stringify(arg) ?? String(arg); } catch { return String(arg); }
};

(['log', 'warn', 'error', 'info', 'debug'] as const).forEach((method) => {
  const original = console[method].bind(console);
  (console as any)[method] = (...args: any[]) => {
    original(...args); // still visible in worker DevTools context
    (self as any).postMessage({ type: 'log', message: args.map(stringify).join(' ') });
  };
});

// Start WASM compilation immediately when the worker is spawned so it overlaps
// with pack file fetching on the main thread instead of running sequentially.
const wasmReady = init();

let wasmMap: WasmMap | null = null;
let wasmPlan: WasmPlan | null = null;

const GEOMETRY_UPDATE_INTERVAL_MS = 500;
let lastGeometryMs = 0;

const GOLDEN_ANGLE = 137.50776405;

function districtColorWorker(index: number): string {
  const hue = (index * GOLDEN_ANGLE + 10) % 360;
  return `hsl(${hue.toFixed(1)} 65% 52%)`;
}

function sendGeometries() {
  if (!wasmPlan) return;
  const raw = wasmPlan.district_geometries_wkb();
  const items: { district: number; wkb: Uint8Array }[] = [];
  for (let i = 0; i < (raw as any).length; i++) {
    const entry = (raw as any)[i];
    items.push({ district: entry.district as number, wkb: entry.wkb as Uint8Array });
  }

  // Include partisan totals so the main thread doesn't need to call plan.district_totals()
  const available: string[] = (wasmPlan as any).series() as string[];
  const demTotals: number[] | null = available.includes('E_20_PRES_Dem')
    ? Array.from((wasmPlan as any).district_totals('E_20_PRES_Dem') as number[]) : null;
  const repTotals: number[] | null = available.includes('E_20_PRES_Rep')
    ? Array.from((wasmPlan as any).district_totals('E_20_PRES_Rep') as number[]) : null;

  const transferables = items.map(item => item.wkb.buffer as ArrayBuffer);
  (self as any).postMessage({ type: 'geometries', items, demTotals, repTotals }, transferables);
  lastGeometryMs = performance.now();
}

function sendStats() {
  if (!wasmPlan) return;
  const available: string[] = Array.from((wasmPlan as any).series() as any) as string[];

  const sumAll = (series: string): number => {
    if (!available.includes(series)) return 0;
    return (Array.from((wasmPlan as any).all_part_totals(series) as any) as number[]).reduce((a, b) => a + b, 0);
  };

  // Region stats
  const regionPop = sumAll('T_20_CENS_Total');
  const regionDem = sumAll('E_20_PRES_Dem');
  const regionRep = sumAll('E_20_PRES_Rep');
  const epct = (series: string) => regionPop > 0 ? (sumAll(series) / regionPop) * 100 : 0;
  const regionStats = {
    totalPop: regionPop,
    demVotes: regionDem,
    repVotes: regionRep,
    whitePct:    epct('T_20_CENS_White'),
    blackPct:    epct('T_20_CENS_Black'),
    hispanicPct: epct('T_20_CENS_Hispanic'),
    asianPct:    epct('T_20_CENS_Asian'),
    nativePct:   epct('T_20_CENS_Native'),
    pacificPct:  epct('T_20_CENS_Pacific'),
  };

  // Per-district stats
  const populations: number[] = available.includes('T_20_CENS_Total')
    ? Array.from((wasmPlan as any).district_totals('T_20_CENS_Total') as any) as number[]
    : [];

  const ideal = regionPop > 0 && populations.length > 0 ? regionPop / populations.length : 0;

  const demVotes: number[] | null = available.includes('E_20_PRES_Dem')
    ? Array.from((wasmPlan as any).district_totals('E_20_PRES_Dem') as any) as number[] : null;
  const repVotes: number[] | null = available.includes('E_20_PRES_Rep')
    ? Array.from((wasmPlan as any).district_totals('E_20_PRES_Rep') as any) as number[] : null;
  const landM2: number[] | null = available.includes('land_m2')
    ? Array.from((wasmPlan as any).district_totals('land_m2') as any) as number[] : null;
  const presTotal: number[] | null = available.includes('E_20_PRES_Total')
    ? Array.from((wasmPlan as any).district_totals('E_20_PRES_Total') as any) as number[] : null;
  const vap20: number[] | null = available.includes('V_20_VAP_Total')
    ? Array.from((wasmPlan as any).district_totals('V_20_VAP_Total') as any) as number[] : null;

  const ethnicGroups = ['White', 'Black', 'Hispanic', 'Asian', 'Native', 'Pacific'] as const;
  const ethnicTotals: Record<string, number[] | null> = {};
  for (const g of ethnicGroups) {
    const col = `T_20_CENS_${g}`;
    ethnicTotals[g] = available.includes(col)
      ? Array.from((wasmPlan as any).district_totals(col) as any) as number[]
      : null;
  }

  const districtStats = populations.map((pop, i) => {
    const pct = (arr: number[] | null) => arr && pop > 0 ? (arr[i] / pop) * 100 : 0;
    return {
      district: i + 1,
      color: districtColorWorker(i),
      population: pop,
      deviation: ideal > 0 && pop > 0 ? ((pop - ideal) / ideal) * 100 : 0,
      demVotes: demVotes?.[i] ?? 0,
      repVotes: repVotes?.[i] ?? 0,
      areaSqKm: landM2 ? landM2[i] / 1e6 : 0,
      populationDensity: landM2 && landM2[i] > 0 ? pop / (landM2[i] / 1e6) : 0,
      votesCast: presTotal ? presTotal[i] : ((demVotes?.[i] ?? 0) + (repVotes?.[i] ?? 0)),
      turnout: vap20 && vap20[i] > 0
        ? (presTotal ? presTotal[i] : ((demVotes?.[i] ?? 0) + (repVotes?.[i] ?? 0))) / vap20[i]
        : 0,
      vap: vap20?.[i] ?? 0,
      whitePct:    pct(ethnicTotals['White']),
      blackPct:    pct(ethnicTotals['Black']),
      hispanicPct: pct(ethnicTotals['Hispanic']),
      asianPct:    pct(ethnicTotals['Asian']),
      nativePct:   pct(ethnicTotals['Native']),
      pacificPct:  pct(ethnicTotals['Pacific']),
    };
  });

  (self as any).postMessage({ type: 'stats', districtStats, regionStats });
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as
    | { type: 'init'; packFiles: Record<string, Uint8Array>; numDistricts: number }
    | { type: 'randomize' }
    | { type: 'equalize'; series: string; tolerance: number; maxIter: number; chunkSize?: number }
    | { type: 'compute-geometries' }
    | { type: 'assign-unit'; layer: string; geoId: string; district: number }
    | { type: 'assign-units-batch'; layer: string; geoIds: string[]; district: number }
    | { type: 'set-assignments'; data: Uint32Array };

  try {
    if (msg.type === 'init') {
      await wasmReady;

      wasmMap?.free();
      wasmPlan?.free();

      wasmMap = new WasmMap(msg.packFiles);
      // Pack bytes are now in WASM linear memory; drop JS references so GC can
      // reclaim the ~1 GB of JS ArrayBuffers before Plan allocation begins.
      for (const key in msg.packFiles) delete (msg.packFiles as any)[key];
      wasmPlan = new WasmPlan(wasmMap, msg.numDistricts);
      lastGeometryMs = 0;

      // Export geo_id index so the main thread can enable painting immediately,
      // without waiting for the metrics worker to finish parsing the block CSV.
      const geoIdIndexJson: string = (wasmMap as any).geo_id_index_json();
      const geoIdIndex: Record<string, string[]> = JSON.parse(geoIdIndexJson);

      sendStats();
      log('[Worker] Ready');
      self.postMessage({ type: 'ready', geoIdIndex });

    } else if (msg.type === 'randomize') {
      if (!wasmPlan) throw new Error('Worker not initialized');

      log('[Worker] Randomizing...');
      wasmPlan.randomize();
      log('[Worker] Randomize done');

      const assignments = new Uint32Array(wasmPlan.assignments_u32());
      (self as any).postMessage({ type: 'assignments', data: assignments, done: true }, [assignments.buffer]);
      sendGeometries();
      sendStats();

    } else if (msg.type === 'equalize') {
      if (!wasmPlan) throw new Error('Worker not initialized');

      const { series, tolerance, maxIter, chunkSize = 20 } = msg;

      for (let iter = 0; iter < maxIter;) {
        let converged = false;
        const end = Math.min(iter + chunkSize, maxIter);
        for (; iter < end; iter++) {
          converged = wasmPlan.equalize_step(series, tolerance);
          if (converged) break;
        }

        const done = converged || iter >= maxIter;
        const assignments = new Uint32Array(wasmPlan.assignments_u32());
        (self as any).postMessage({ type: 'assignments', data: assignments, done }, [assignments.buffer]);

        if (done || performance.now() - lastGeometryMs >= GEOMETRY_UPDATE_INTERVAL_MS) {
          sendGeometries();
        }

        if (done) {
          if (!converged) log(`Equalization incomplete after ${maxIter} iterations`);
          sendStats();
          break;
        }

        // Yield so the worker event loop can process a cancel/abort message before the next chunk.
        await new Promise<void>(r => setTimeout(r, 0));
      }

    } else if (msg.type === 'compute-geometries') {
      sendGeometries();
      sendStats();

    } else if (msg.type === 'set-assignments') {
      if (!wasmPlan) throw new Error('Worker not initialized');
      wasmPlan.set_assignments_u32(msg.data);
      const setAssignments = new Uint32Array(wasmPlan.assignments_u32());
      (self as any).postMessage({ type: 'assignments', data: setAssignments, done: true }, [setAssignments.buffer]);
      sendGeometries();
      sendStats();

    } else if (msg.type === 'assign-unit') {
      if (!wasmPlan) throw new Error('Worker not initialized');
      (wasmPlan as any).assign_unit(msg.layer, msg.geoId, msg.district);
      // done: false — incremental update for feature-state display only; does not
      // trigger assignmentsRef / districtCounts recalculation on the main thread.
      const unitAssignments = new Uint32Array(wasmPlan.assignments_u32());
      (self as any).postMessage({ type: 'assignments', data: unitAssignments, done: false }, [unitAssignments.buffer]);
      sendGeometries();
      sendStats();

    } else if (msg.type === 'assign-units-batch') {
      if (!wasmPlan) throw new Error('Worker not initialized');
      // Single Rust call processes all geo_ids in one block-table pass; geometry/stats
      // are recomputed once at the end instead of once per unit.
      (wasmPlan as any).assign_units_batch(msg.layer, msg.geoIds, msg.district);
      const batchAssignments = new Uint32Array(wasmPlan.assignments_u32());
      (self as any).postMessage({ type: 'assignments', data: batchAssignments, done: true }, [batchAssignments.buffer]);
      sendGeometries();
      sendStats();
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) });
  }
};
