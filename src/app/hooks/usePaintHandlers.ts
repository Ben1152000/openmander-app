import { useEffect, useRef } from 'react';
import type { Map } from 'maplibre-gl';
import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import type { DrawingTool } from '@/app/components/MapToolbar';

export function usePaintHandlers(params: {
  mapRef: MutableRefObject<Map | null>;
  mapInitialized: boolean;
  currentLayer: string;
  drawingTool: DrawingTool;
  activeDistrict: number;
  assignmentsRef: MutableRefObject<Record<string, number>>;
  setDistrictCounts: Dispatch<SetStateAction<Record<number, number>>>;
  featureHashesRef: MutableRefObject<Record<string, string>>;
  geoIdByIndexRef: MutableRefObject<Record<string, Record<number, string>>>;
  onAssignUnit: (layer: string, geoId: string, district: number) => void;
  onAssignUnitsBatch: (layer: string, geoIds: string[], district: number) => void;
  automationRunning: boolean;
  onHoverUnit?: (info: { geoId: string; layer: string; x: number; y: number } | null) => void;
  isDistrictHoveredRef?: MutableRefObject<boolean>;
}) {
  const {
    mapRef, mapInitialized, currentLayer, drawingTool, activeDistrict,
    assignmentsRef, setDistrictCounts, featureHashesRef, geoIdByIndexRef,
    onAssignUnit, onAssignUnitsBatch, automationRunning, onHoverUnit, isDistrictHoveredRef,
  } = params;

  const hoveredIdRef = useRef<string | number | null>(null);
  const isPaintingRef = useRef(false);
  const lastPaintedGeoIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mapRef.current || !mapInitialized) return;
    const map = mapRef.current;
    const fillLayerId = `units-${currentLayer}-fill`;
    if (!map.getLayer(fillLayerId)) return;

    const sourceId = 'units-all';

    const clearHover = () => {
      if (hoveredIdRef.current != null) {
        map.setFeatureState({ source: sourceId, sourceLayer: currentLayer, id: hoveredIdRef.current }, { hover: false });
        hoveredIdRef.current = null;
      }
    };

    // ── Pointer (inspect) tool ───────────────────────────────────────────────────
    if (drawingTool === 'pointer') {
      map.getCanvas().style.cursor = 'default';

      const lastGeoIdRef = { current: null as string | null };

      const pointerMouseMove = (e: any) => {
        map.getCanvas().style.cursor = 'default';
        const featureId = e.features?.[0]?.id;
        if (featureId == null) return;

        if (isDistrictHoveredRef?.current) {
          // A district is on top — clear any unit highlight and skip.
          clearHover();
          return;
        }

        if (featureId !== hoveredIdRef.current) {
          clearHover();
          hoveredIdRef.current = featureId;
          map.setFeatureState({ source: sourceId, sourceLayer: currentLayer, id: featureId }, { hover: true });
        }

        const index = (e.features?.[0] as any)?.properties?.index;
        const geoId = geoIdByIndexRef.current[currentLayer]?.[parseInt(index)];
        if (geoId) {
          lastGeoIdRef.current = geoId;
          onHoverUnit?.({ geoId, layer: currentLayer, x: e.originalEvent.clientX, y: e.originalEvent.clientY });
        }
      };

      // Native DOM mousemove on the canvas container — fires even during MapLibre
      // drag-pan, unlike MapLibre's own mousemove which stops during a drag.
      const container = map.getCanvasContainer();
      const nativeMouseMove = (e: MouseEvent) => {
        if (isDistrictHoveredRef?.current) { clearHover(); return; }
        if (!lastGeoIdRef.current) return;
        onHoverUnit?.({ geoId: lastGeoIdRef.current, layer: currentLayer, x: e.clientX, y: e.clientY });
      };

      const pointerMouseLeave = () => {
        map.getCanvas().style.cursor = '';
        clearHover();
        lastGeoIdRef.current = null;
        onHoverUnit?.(null);
      };

      map.on('mousemove', fillLayerId, pointerMouseMove);
      container.addEventListener('mousemove', nativeMouseMove);
      map.on('mouseleave', fillLayerId, pointerMouseLeave);
      map.on('mouseleave', pointerMouseLeave);

      return () => {
        map.off('mousemove', fillLayerId, pointerMouseMove);
        container.removeEventListener('mousemove', nativeMouseMove);
        map.off('mouseleave', fillLayerId, pointerMouseLeave);
        map.off('mouseleave', pointerMouseLeave);
        clearHover();
        lastGeoIdRef.current = null;
        onHoverUnit?.(null);
        map.getCanvas().style.cursor = '';
      };
    }

    // ── Box select tool ─────────────────────────────────────────────────────────
    if (drawingTool === 'box' && !automationRunning) {
      map.getCanvas().style.cursor = 'crosshair';

      // Selection-rect overlay div positioned inside the canvas container.
      const container = map.getCanvasContainer();
      const overlay = document.createElement('div');
      overlay.style.cssText = [
        'position:absolute', 'pointer-events:none', 'display:none',
        'border:2px dashed #3b82f6', 'background:rgba(59,130,246,0.08)',
        'box-sizing:border-box', 'z-index:10',
      ].join(';');
      container.appendChild(overlay);

      let startX = 0, startY = 0;
      let isSelecting = false;
      // Tracks feature IDs currently highlighted inside the drag box.
      const boxHighlighted = new Set<string | number>();

      const updateOverlay = (x: number, y: number) => {
        const left = Math.min(startX, x);
        const top  = Math.min(startY, y);
        overlay.style.left   = `${left}px`;
        overlay.style.top    = `${top}px`;
        overlay.style.width  = `${Math.abs(x - startX)}px`;
        overlay.style.height = `${Math.abs(y - startY)}px`;
      };

      const clearBoxHighlights = () => {
        for (const id of boxHighlighted) {
          map.setFeatureState({ source: sourceId, sourceLayer: currentLayer, id }, { hover: false });
        }
        boxHighlighted.clear();
      };

      const boxMouseDown = (e: any) => {
        if (e.originalEvent?.button !== 0) return;
        e.preventDefault();
        isSelecting = true;
        startX = e.point.x;
        startY = e.point.y;
        overlay.style.display = 'block';
        updateOverlay(startX, startY);
      };

      const boxMouseMove = (e: any) => {
        if (!isSelecting) return;
        const x = e.point.x, y = e.point.y;
        updateOverlay(x, y);

        const x1 = Math.min(startX, x), y1 = Math.min(startY, y);
        const x2 = Math.max(startX, x), y2 = Math.max(startY, y);
        const features = map.queryRenderedFeatures([[x1, y1], [x2, y2]], { layers: [fillLayerId] });
        const inBox = new Set<string | number>(
          features.map(f => f.id as string | number).filter(id => id != null),
        );
        // Clear features that left the box.
        for (const id of boxHighlighted) {
          if (!inBox.has(id)) {
            map.setFeatureState({ source: sourceId, sourceLayer: currentLayer, id }, { hover: false });
            boxHighlighted.delete(id);
          }
        }
        // Highlight features that entered the box.
        for (const id of inBox) {
          if (!boxHighlighted.has(id)) {
            map.setFeatureState({ source: sourceId, sourceLayer: currentLayer, id }, { hover: true });
            boxHighlighted.add(id);
          }
        }
      };

      const boxMouseUp = (e: any) => {
        if (!isSelecting) return;
        isSelecting = false;
        overlay.style.display = 'none';
        clearBoxHighlights();

        const x = e.point.x, y = e.point.y;
        const x1 = Math.min(startX, x), y1 = Math.min(startY, y);
        const x2 = Math.max(startX, x), y2 = Math.max(startY, y);

        // Ignore accidental single clicks (treat as no-op, not a point query).
        if (x2 - x1 < 4 && y2 - y1 < 4) return;

        const features = map.queryRenderedFeatures([[x1, y1], [x2, y2]], { layers: [fillLayerId] });

        const seenGeoIds = new Set<string>();
        const geoIds: string[] = [];
        for (const feature of features) {
          const index = parseInt(feature.properties?.index);
          const geoId = geoIdByIndexRef.current[currentLayer]?.[index];
          if (geoId && !seenGeoIds.has(geoId)) {
            seenGeoIds.add(geoId);
            geoIds.push(geoId);
          }
        }
        if (geoIds.length === 0) return;

        // Update frontend assignment cache synchronously so subsequent single-unit
        // paints have the correct previous-district values for count tracking.
        const deltas: Record<number, number> = {};
        for (const geoId of geoIds) {
          const prev = assignmentsRef.current[geoId];
          if (prev === activeDistrict) continue; // already assigned here
          if (prev != null) deltas[prev] = (deltas[prev] ?? 0) - 1;
          assignmentsRef.current[geoId] = activeDistrict;
          featureHashesRef.current[geoId] = `${geoId}:${activeDistrict}`;
          deltas[activeDistrict] = (deltas[activeDistrict] ?? 0) + 1;
        }
        if (Object.keys(deltas).length > 0) {
          setDistrictCounts(c => {
            const next = { ...c };
            for (const [d, delta] of Object.entries(deltas)) {
              const district = Number(d);
              next[district] = (next[district] ?? 0) + delta;
              if (next[district] <= 0) delete next[district];
            }
            return next;
          });
        }

        onAssignUnitsBatch(currentLayer, geoIds, activeDistrict);
      };

      map.on('mousedown', boxMouseDown);
      map.on('mousemove', boxMouseMove);
      map.on('mouseup', boxMouseUp);

      return () => {
        map.off('mousedown', boxMouseDown);
        map.off('mousemove', boxMouseMove);
        map.off('mouseup', boxMouseUp);
        overlay.remove();
        clearBoxHighlights();
        map.getCanvas().style.cursor = '';
        clearHover();
      };
    }

    // ── Paint / erase / pan tools ───────────────────────────────────────────────

    const applyPaint = (_featureId: string | number, geoId: string) => {
      if (drawingTool === 'erase') {
        const prev = assignmentsRef.current[geoId];
        if (prev != null) {
          delete assignmentsRef.current[geoId];
          setDistrictCounts(c => {
            const next = { ...c };
            next[prev] = (next[prev] ?? 1) - 1;
            if (next[prev] <= 0) delete next[prev];
            return next;
          });
          delete featureHashesRef.current[geoId];
        }
        onAssignUnit(currentLayer, geoId, 0);
      } else {
        const prev = assignmentsRef.current[geoId];
        assignmentsRef.current[geoId] = activeDistrict;
        setDistrictCounts(c => {
          const next = { ...c };
          if (prev != null) { next[prev] = (next[prev] ?? 1) - 1; }
          next[activeDistrict] = (next[activeDistrict] ?? 0) + 1;
          return next;
        });
        featureHashesRef.current[geoId] = `${geoId}:${activeDistrict}`;
        onAssignUnit(currentLayer, geoId, activeDistrict);
      }
    };

    const getFeatureInfo = (e: any): { featureId: string | number; geoId: string } | null => {
      const featureId = e.features?.[0]?.id;
      const index = (e.features?.[0] as any)?.properties?.index;
      const geoId = geoIdByIndexRef.current[currentLayer]?.[parseInt(index)];
      if (featureId == null || !geoId) return null;
      return { featureId, geoId };
    };

    const handleMouseDown = (e: any) => {
      if (drawingTool === 'pan' || automationRunning) return;
      // Prevent map drag when painting
      e.preventDefault();

      isPaintingRef.current = true;
      lastPaintedGeoIdRef.current = null;
      const info = getFeatureInfo(e);
      if (!info) return;
      lastPaintedGeoIdRef.current = info.geoId;
      applyPaint(info.featureId, info.geoId);
    };

    const handleMouseMove = (e: any) => {
      if (drawingTool === 'paint') map.getCanvas().style.cursor = 'crosshair';
      else if (drawingTool === 'erase') map.getCanvas().style.cursor = 'cell';
      else map.getCanvas().style.cursor = 'pointer';

      if (drawingTool === 'pan') return;

      const featureId = e.features?.[0]?.id;
      if (featureId == null) return;

      // Hover highlight
      if (featureId !== hoveredIdRef.current) {
        clearHover();
        hoveredIdRef.current = featureId;
        map.setFeatureState({ source: sourceId, sourceLayer: currentLayer, id: featureId }, { hover: true });
      }

      // Paint on drag
      if (!isPaintingRef.current) return;
      const info = getFeatureInfo(e);
      if (!info || info.geoId === lastPaintedGeoIdRef.current) return;
      lastPaintedGeoIdRef.current = info.geoId;
      applyPaint(info.featureId, info.geoId);
    };

    const handleMouseUp = () => {
      isPaintingRef.current = false;
      lastPaintedGeoIdRef.current = null;
    };

    const handleMapMouseLeave = () => {
      map.getCanvas().style.cursor = '';
      clearHover();
      isPaintingRef.current = false;
    };

    const handleLayerMouseLeave = () => {
      clearHover();
    };

    map.on('mousedown', fillLayerId, handleMouseDown);
    map.on('mousemove', fillLayerId, handleMouseMove);
    map.on('mouseup', handleMouseUp);
    map.on('mouseleave', handleMapMouseLeave);
    map.on('mouseleave', fillLayerId, handleLayerMouseLeave);
    return () => {
      map.off('mousedown', fillLayerId, handleMouseDown);
      map.off('mousemove', fillLayerId, handleMouseMove);
      map.off('mouseup', handleMouseUp);
      map.off('mouseleave', handleMapMouseLeave);
      map.off('mouseleave', fillLayerId, handleLayerMouseLeave);
      clearHover();
      isPaintingRef.current = false;
    };
  }, [drawingTool, activeDistrict, mapInitialized, currentLayer]); // eslint-disable-line react-hooks/exhaustive-deps
}
