import { useEffect } from 'react';
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
}) {
  const { mapRef, mapInitialized, currentLayer, drawingTool, activeDistrict, assignmentsRef, setDistrictCounts, featureHashesRef } = params;

  useEffect(() => {
    if (!mapRef.current || !mapInitialized) return;
    const map = mapRef.current;
    const fillLayerId = `units-${currentLayer}-fill`;
    if (!map.getLayer(fillLayerId)) return;

    const sourceId = 'units-all';

    const handleMouseMove = () => {
      if (drawingTool === 'paint') map.getCanvas().style.cursor = 'crosshair';
      else if (drawingTool === 'erase') map.getCanvas().style.cursor = 'cell';
      else map.getCanvas().style.cursor = 'pointer';
    };

    const handleMouseLeave = () => { map.getCanvas().style.cursor = ''; };

    const handleClick = (e: any) => {
      if (drawingTool === 'pan') return;
      const id = String((e.features?.[0] as any)?.properties?.geo_id ?? '');
      if (!id) return;

      if (drawingTool === 'erase') {
        const prev = assignmentsRef.current[id];
        if (prev == null) return;
        delete assignmentsRef.current[id];
        setDistrictCounts(c => {
          const next = { ...c };
          next[prev] = (next[prev] ?? 1) - 1;
          if (next[prev] <= 0) delete next[prev];
          return next;
        });
        map.setFeatureState({ source: sourceId, sourceLayer: currentLayer, id }, { district: null });
        delete featureHashesRef.current[id];
        return;
      }

      // paint
      const prev = assignmentsRef.current[id];
      assignmentsRef.current[id] = activeDistrict;
      setDistrictCounts(c => {
        const next = { ...c };
        if (prev != null) { next[prev] = (next[prev] ?? 1) - 1; }
        next[activeDistrict] = (next[activeDistrict] ?? 0) + 1;
        return next;
      });
      map.setFeatureState({ source: sourceId, sourceLayer: currentLayer, id }, { district: activeDistrict });
      featureHashesRef.current[id] = `${id}:${activeDistrict}`;
    };

    map.on('mousemove', fillLayerId, handleMouseMove);
    map.on('mouseleave', fillLayerId, handleMouseLeave);
    map.on('click', fillLayerId, handleClick);
    return () => {
      map.off('mousemove', fillLayerId, handleMouseMove);
      map.off('mouseleave', fillLayerId, handleMouseLeave);
      map.off('click', fillLayerId, handleClick);
    };
  }, [drawingTool, activeDistrict, mapInitialized, currentLayer]); // eslint-disable-line react-hooks/exhaustive-deps
}
