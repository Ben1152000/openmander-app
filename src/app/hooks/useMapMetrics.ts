import { useCallback, useRef } from 'react';
import type { EthnicityMetric, ScalarMetric } from '@/app/constants/metrics';

export function useMapMetrics() {
  const partisanLeanRef = useRef<Record<string, number>>({});
  const ethnicityDataRef = useRef<Partial<Record<EthnicityMetric, Record<string, number>>>>({});
  const scalarDataRef = useRef<Partial<Record<ScalarMetric, Record<string, number>>>>({});
  const geoIdByIndexRef = useRef<Record<string, Record<number, string>>>({});

  const clearMetrics = useCallback(() => {
    partisanLeanRef.current = {};
    geoIdByIndexRef.current = {};
    scalarDataRef.current = {};
    ethnicityDataRef.current = {};
  }, []);

  const applyMetrics = useCallback((
    partisanLean: Record<string, number>,
    geoIdByIndex: Record<string, Record<number, string>>,
    scalarData: Partial<Record<ScalarMetric, Record<string, number>>>,
    ethnicityData: Partial<Record<EthnicityMetric, Record<string, number>>>,
  ) => {
    partisanLeanRef.current = partisanLean;
    geoIdByIndexRef.current = geoIdByIndex;
    scalarDataRef.current = scalarData;
    ethnicityDataRef.current = ethnicityData;
  }, []);

  return { partisanLeanRef, ethnicityDataRef, scalarDataRef, geoIdByIndexRef, clearMetrics, applyMetrics };
}
