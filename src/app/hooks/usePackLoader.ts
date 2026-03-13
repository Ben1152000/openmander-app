import { useEffect, useRef, useState } from 'react';
import { loadPackFromDirectory } from '@/loadPack';
import { loadAndCachePMTiles, setPMTilesBuffer } from '@/pmtilesCache';
import { STATE_CONFIGS } from '@/app/constants/config';

export type PackData = { wasmMap: any; packFiles: Record<string, Uint8Array> };

export function usePackLoader(
  wasm: any,
  loadedState: string,
  setLoadingStatus: (s: string) => void,
  onBeforeLoad: () => void,
) {
  const [mapData, setMapData] = useState<PackData | null>(null);
  const [loadingPack, setLoadingPack] = useState(false);
  const [pmtilesBufferReady, setPmtilesBufferReady] = useState(false);
  const wasmMapRef = useRef<any>(null);

  // Stable ref so the effect doesn't re-run when the callback identity changes.
  const onBeforeLoadRef = useRef(onBeforeLoad);
  onBeforeLoadRef.current = onBeforeLoad;

  useEffect(() => {
    if (!wasm) return;
    const config = STATE_CONFIGS[loadedState];
    if (!config) return;

    const controller = new AbortController();
    const { signal } = controller;

    const run = async () => {
      onBeforeLoadRef.current();

      if (wasmMapRef.current) { wasmMapRef.current.free?.(); wasmMapRef.current = null; }

      setPmtilesBufferReady(false);
      setMapData(null);
      setLoadingPack(true);
      setLoadingStatus('Loading pack files...');

      try {
        const packPath = `/packs/${config.packDir}`;
        const packFiles = await loadPackFromDirectory(packPath, (cur, total, file) => {
          setLoadingStatus(`Loading pack files... (${cur}/${total})${file ? ` - ${file}` : ''}`);
        }, signal);
        if (signal.aborted) return;

        setLoadingStatus('Downloading geometry tiles...');
        const pmtilesBuffer = await loadAndCachePMTiles(
          `${packPath}/geom/geometries.pmtiles`,
          (loaded, total) => {
            const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
            setLoadingStatus(`Downloading geometry tiles... ${pct}%`);
          },
          signal,
        );
        if (signal.aborted) return;

        setPMTilesBuffer(pmtilesBuffer);
        setPmtilesBufferReady(true);

        setLoadingStatus('Initializing map...');
        await new Promise(resolve => { requestAnimationFrame(() => { requestAnimationFrame(resolve); }); });
        if (signal.aborted) return;

        const { WasmMap } = wasm as any;
        const wasmMap = new WasmMap(packFiles);
        wasmMapRef.current = wasmMap;
        setMapData({ wasmMap, packFiles });
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error(`Failed to load ${loadedState} pack:`, err);
        setLoadingStatus('Error loading pack');
      } finally {
        if (!signal.aborted) { setLoadingPack(false); setLoadingStatus(''); }
      }
    };

    run();
    return () => controller.abort();
  }, [wasm, loadedState]); // eslint-disable-line react-hooks/exhaustive-deps

  return { mapData, loadingPack, pmtilesBufferReady, resetPmtilesBuffer: () => setPmtilesBufferReady(false) };
}
