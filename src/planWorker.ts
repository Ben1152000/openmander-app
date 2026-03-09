// Persistent Web Worker for plan computation.
// The WasmMap is loaded once on 'init' and reused across 'randomize' calls.
//
// Messages in:
//   { type: 'init', packFiles: Record<string, Uint8Array>, numDistricts: number }
//   { type: 'randomize' }
//
// Messages out:
//   { type: 'ready' }                          — init complete
//   { type: 'assignments', data: Uint32Array } — randomize complete (buffer transferred)
//   { type: 'error', message: string }

import init, { WasmMap, WasmPlan } from '../wasm/pkg/openmander';

let wasmMap: WasmMap | null = null;
let wasmPlan: WasmPlan | null = null;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as
    | { type: 'init'; packFiles: Record<string, Uint8Array>; numDistricts: number }
    | { type: 'randomize' };

  try {
    if (msg.type === 'init') {
      await init();

      wasmMap?.free();
      wasmPlan?.free();

      wasmMap = new WasmMap(msg.packFiles);
      wasmPlan = new WasmPlan(wasmMap, msg.numDistricts);

      self.postMessage({ type: 'ready' });

    } else if (msg.type === 'randomize') {
      if (!wasmPlan) throw new Error('Worker not initialized');

      wasmPlan.randomize();

      const wasmAssignments = wasmPlan.assignments_u32();
      // Copy out of WASM linear memory into a plain transferable buffer.
      const assignments = new Uint32Array(wasmAssignments);
      self.postMessage({ type: 'assignments', data: assignments }, [assignments.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) });
  }
};
