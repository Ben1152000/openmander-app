import { useEffect, useRef, useState } from 'react';
import { loadPackFromDirectory } from '@/loadPack';
import { loadAndCachePMTiles, cacheAndSetPMTiles, setPMTilesBuffer } from '@/pmtilesCache';
import { STATE_CONFIGS } from '@/app/constants/config';

export type PackData = { packFiles: Record<string, Uint8Array> };

export function usePackLoader(
  loadedState: string,
  setLoadingStatus: (s: string) => void,
  onBeforeLoad: () => void,
) {
  const [mapData, setMapData] = useState<PackData | null>(null);
  const [loadingPack, setLoadingPack] = useState(false);
  const [pmtilesBufferReady, setPmtilesBufferReady] = useState(false);

  // Stable ref so the effect doesn't re-run when the callback identity changes.
  const onBeforeLoadRef = useRef(onBeforeLoad);
  onBeforeLoadRef.current = onBeforeLoad;

  useEffect(() => {
    const config = STATE_CONFIGS[loadedState];
    if (!config) return;

    const controller = new AbortController();
    const { signal } = controller;

    const run = async () => {
      onBeforeLoadRef.current();

      setPmtilesBufferReady(false);
      setMapData(null);
      setLoadingPack(true);
      setLoadingStatus('Loading pack files...');

      try {
        const packPath = `/packs/${config.packDir}`;
        const { packFiles, pmtilesBuffer } = await loadPackFromDirectory(packPath, (cur, total, file) => {
          setLoadingStatus(`Loading pack files... (${cur}/${total})${file ? ` - ${file}` : ''}`);
        }, signal);
        if (signal.aborted) return;

        setLoadingStatus('Downloading geometry tiles...');

        if (pmtilesBuffer !== null) {
          // PMTiles was pre-assembled from chunks — cache it and set the buffer directly.
          const baseUrl = window.location.origin;
          const fullUrl = `${baseUrl}${packPath}/geom/geometries.pmtiles`;
          await cacheAndSetPMTiles(fullUrl, pmtilesBuffer);
        } else {
          // PMTiles exists as a single file — use the normal download + cache path.
          const pmtilesDownloaded = await loadAndCachePMTiles(
            `${packPath}/geom/geometries.pmtiles`,
            (loaded, total) => {
              const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
              setLoadingStatus(`Downloading geometry tiles... ${pct}%`);
            },
            signal,
          );
          if (signal.aborted) return;
          setPMTilesBuffer(pmtilesDownloaded);
        }
        if (signal.aborted) return;

        setPmtilesBufferReady(true);

        setLoadingStatus('Initializing map...');
        await new Promise(resolve => { requestAnimationFrame(() => { requestAnimationFrame(resolve); }); });
        if (signal.aborted) return;

        setMapData({ packFiles });
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error(`Failed to load ${loadedState} pack:`, err);
        setLoadingStatus('Error loading pack');
      } finally {
        // Don't clear loadingStatus here — the worker will clear it on 'ready'
        // so the spinner stays up through WasmMap construction.
        if (!signal.aborted) { setLoadingPack(false); }
      }
    };

    run();
    return () => controller.abort();
  }, [loadedState]); // eslint-disable-line react-hooks/exhaustive-deps

  return { mapData, loadingPack, pmtilesBufferReady, resetPmtilesBuffer: () => setPmtilesBufferReady(false) };
}
