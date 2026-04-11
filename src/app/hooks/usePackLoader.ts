import { useEffect, useRef, useState } from 'react';
import { PMTiles } from 'pmtiles';
import { loadPackFromDirectory } from '@/loadPack';
import { loadAndCachePMTiles, cacheAndSetPMTiles, setPMTilesBuffer } from '@/pmtilesCache';
import { STATE_CONFIGS } from '@/app/constants/config';

export type LayerZoomRanges = Record<string, { minzoom: number; maxzoom: number }>;

export type PackData = { packFiles: Record<string, Uint8Array> };

export function usePackLoader(
  loadedState: string,
  setLoadingStatus: (s: string) => void,
  onBeforeLoad: () => void,
) {
  const [mapData, setMapData] = useState<PackData | null>(null);
  const [loadingPack, setLoadingPack] = useState(false);
  const [pmtilesBufferReady, setPmtilesBufferReady] = useState(false);
  const [layerZoomRanges, setLayerZoomRanges] = useState<LayerZoomRanges>({});

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
      setLayerZoomRanges({});
      setMapData(null);
      setLoadingPack(true);
      setLoadingStatus('Loading pack files...');

      try {
        const packsBase = import.meta.env.VITE_PACK_SERVER_URL ?? '/packs';
        const packPath = `${packsBase}/${config.packDir}`;
        const { packFiles, pmtilesBuffer } = await loadPackFromDirectory(packPath, (cur, total, file) => {
          setLoadingStatus(`Loading pack files... (${cur}/${total})${file ? ` - ${file}` : ''}`);
        }, signal);
        if (signal.aborted) return;

        setLoadingStatus('Downloading geometry tiles...');

        // Build an absolute URL for the PMTiles file (used as the cache key).
        const pmtilesUrl = `${packPath}/geom/geometries.pmtiles`;
        const pmtilesAbsUrl = pmtilesUrl.startsWith('http')
          ? pmtilesUrl
          : `${window.location.origin}${pmtilesUrl}`;

        if (pmtilesBuffer !== null) {
          // PMTiles was pre-assembled from chunks — cache it and set the buffer directly.
          await cacheAndSetPMTiles(pmtilesAbsUrl, pmtilesBuffer);
        } else {
          // PMTiles exists as a single file — use the normal download + cache path.
          const pmtilesDownloaded = await loadAndCachePMTiles(
            pmtilesUrl,
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

        // Read vector layer zoom ranges from PMTiles metadata (async, non-blocking).
        // Our fetch interceptor serves range requests from the in-memory buffer, so
        // this works without an extra network round-trip.
        new PMTiles(pmtilesAbsUrl).getMetadata().then((metadata: any) => {
          if (signal.aborted) return;
          const ranges: LayerZoomRanges = {};
          for (const layer of (metadata?.vector_layers ?? [])) {
            if (layer.id && layer.minzoom !== undefined && layer.maxzoom !== undefined) {
              ranges[layer.id] = { minzoom: layer.minzoom, maxzoom: layer.maxzoom };
            }
          }
          if (Object.keys(ranges).length > 0) setLayerZoomRanges(ranges);
        }).catch(() => { /* silently fall back to hardcoded thresholds */ });

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

  // Derived immediately from packFiles keys — no async wait needed.
  const hasVtd = mapData === null
    ? true // default true while loading to avoid flicker
    : Object.keys(mapData.packFiles).some(k => /^data\/vtd[./]/.test(k));

  return { mapData, loadingPack, pmtilesBufferReady, layerZoomRanges, hasVtd, resetPmtilesBuffer: () => setPmtilesBufferReady(false) };
}
