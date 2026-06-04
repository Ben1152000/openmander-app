import { useEffect, useState } from 'react';
import type { StateConfig } from '@/app/constants/config';

export function usePackIndex(): Record<string, StateConfig> {
  const [stateConfigs, setStateConfigs] = useState<Record<string, StateConfig>>({});

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}packs.json`)
      .then(r => r.json())
      .then((data: Record<string, Record<string, { name: string; packDir: string; bounds: [[number, number], [number, number]]; districts: number }>>) => {
        const configs: Record<string, StateConfig> = {};
        for (const packs of Object.values(data)) {
          const pack = Object.values(packs)[0];
          if (!pack?.name) continue;
          configs[pack.name.toLowerCase()] = {
            packDir:   pack.packDir,
            bounds:    pack.bounds,
            districts: pack.districts,
          };
        }
        setStateConfigs(configs);
      })
      .catch(err => console.error('Failed to load pack index:', err));
  }, []);

  return stateConfigs;
}
