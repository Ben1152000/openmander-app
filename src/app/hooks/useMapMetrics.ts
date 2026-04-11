import { useCallback, useRef } from 'react';
import type { EthnicityMetric, ScalarMetric } from '@/app/constants/metrics';

export type BlockParents = { county: string; vtd: string; tract: string; group: string };

export function useMapMetrics() {
  const partisanLeanRef = useRef<Record<string, number>>({});
  const ethnicityDataRef = useRef<Partial<Record<EthnicityMetric, Record<string, number>>>>({});
  const scalarDataRef = useRef<Partial<Record<ScalarMetric, Record<string, number>>>>({});
  const geoIdByIndexRef = useRef<Record<string, Record<number, string>>>({});
  const blockToParentsRef = useRef<Record<string, BlockParents>>({});
  const parentBlockIndicesRef = useRef<Record<string, Record<string, number[]>>>({});
  const unitNamesRef = useRef<Record<string, Record<string, string>>>({});
  const unitPopulationRef = useRef<Record<string, number>>({});
  const unitElectionVotesRef = useRef<Record<string, { dem: number; rep: number; total: number }>>({});
  const unitEthnicCountsRef = useRef<Partial<Record<EthnicityMetric, Record<string, number>>>>({});
  const unitLandKm2Ref = useRef<Record<string, number>>({});
  const unitVapRef = useRef<Record<string, number>>({});
  const electionNameRef = useRef<string>('');
  const censusNameRef = useRef<string>('');

  const clearMetrics = useCallback(() => {
    partisanLeanRef.current = {};
    geoIdByIndexRef.current = {};
    scalarDataRef.current = {};
    ethnicityDataRef.current = {};
    blockToParentsRef.current = {};
    parentBlockIndicesRef.current = {};
    unitNamesRef.current = {};
    unitPopulationRef.current = {};
    unitElectionVotesRef.current = {};
    unitEthnicCountsRef.current = {};
    unitLandKm2Ref.current = {};
    unitVapRef.current = {};
    electionNameRef.current = '';
    censusNameRef.current = '';
  }, []);

  // Seed geoIdByIndex without touching partisan/ethnicity/scalar data.
  const seedGeoIdIndex = useCallback((geoIdByIndex: Record<string, Record<number, string>>) => {
    geoIdByIndexRef.current = { ...geoIdByIndexRef.current, ...geoIdByIndex };
  }, []);

  const applyMetrics = useCallback((
    partisanLean: Record<string, number>,
    geoIdByIndex: Record<string, Record<number, string>>,
    scalarData: Partial<Record<ScalarMetric, Record<string, number>>>,
    ethnicityData: Partial<Record<EthnicityMetric, Record<string, number>>>,
    blockToParents: Record<string, BlockParents>,
    parentBlockIndices: Record<string, Record<string, number[]>>,
    unitNames: Record<string, Record<string, string>>,
    unitPopulation: Record<string, number>,
    unitElectionVotes: Record<string, { dem: number; rep: number; total: number }>,
    unitEthnicCounts: Partial<Record<EthnicityMetric, Record<string, number>>>,
    unitLandKm2: Record<string, number>,
    unitVap: Record<string, number>,
    electionName: string,
    censusName: string,
  ) => {
    partisanLeanRef.current = partisanLean;
    geoIdByIndexRef.current = geoIdByIndex;
    scalarDataRef.current = scalarData;
    ethnicityDataRef.current = ethnicityData;
    blockToParentsRef.current = blockToParents;
    parentBlockIndicesRef.current = parentBlockIndices;
    unitNamesRef.current = unitNames;
    unitPopulationRef.current = unitPopulation;
    unitElectionVotesRef.current = unitElectionVotes;
    unitEthnicCountsRef.current = unitEthnicCounts;
    unitLandKm2Ref.current = unitLandKm2;
    unitVapRef.current = unitVap;
    electionNameRef.current = electionName;
    censusNameRef.current = censusName;
  }, []);

  return {
    partisanLeanRef, ethnicityDataRef, scalarDataRef, geoIdByIndexRef,
    blockToParentsRef, parentBlockIndicesRef,
    unitNamesRef, unitPopulationRef,
    unitElectionVotesRef, unitEthnicCountsRef, unitLandKm2Ref, unitVapRef, electionNameRef, censusNameRef,
    clearMetrics, applyMetrics, seedGeoIdIndex,
  };
}
