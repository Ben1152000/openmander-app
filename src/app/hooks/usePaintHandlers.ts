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
  automationRunning: boolean;
}) {
  const { mapRef, mapInitialized, currentLayer, drawingTool, activeDistrict, assignmentsRef, setDistrictCounts, featureHashesRef, geoIdByIndexRef, onAssignUnit, automationRunning } = params;

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

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = '';
      clearHover();
      isPaintingRef.current = false;
    };

    map.on('mousedown', fillLayerId, handleMouseDown);
    map.on('mousemove', fillLayerId, handleMouseMove);
    map.on('mouseup', fillLayerId, handleMouseUp);
    map.on('mouseleave', fillLayerId, handleMouseLeave);
    return () => {
      map.off('mousedown', fillLayerId, handleMouseDown);
      map.off('mousemove', fillLayerId, handleMouseMove);
      map.off('mouseup', fillLayerId, handleMouseUp);
      map.off('mouseleave', fillLayerId, handleMouseLeave);
      clearHover();
      isPaintingRef.current = false;
    };
  }, [drawingTool, activeDistrict, mapInitialized, currentLayer]); // eslint-disable-line react-hooks/exhaustive-deps
}
