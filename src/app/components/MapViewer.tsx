import type { MutableRefObject, ReactNode } from 'react';
import type { Map } from 'maplibre-gl';

interface MapViewerProps {
  mapRef: MutableRefObject<Map | null>;
  mapDivRef: MutableRefObject<HTMLDivElement | null>;
  onMapInitialized: () => void;
  loadingPack: boolean;
  loadingStatus: string;
  activeLayer: string;
  children?: ReactNode;
}

export function MapViewer(props: MapViewerProps) {
  const { mapDivRef, loadingPack, loadingStatus, children } = props;

  return (
    <div className="relative h-full w-full">
      <div ref={mapDivRef} className="h-full w-full" />

      {/* Toolbar and other overlays */}
      {children}

      {/* Loading indicator — top center */}
      {(loadingPack || !!loadingStatus) && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-background/95 border rounded-lg shadow-lg py-3 px-4 flex items-center gap-3 z-[1000] min-w-[200px]">
          <div className="loading-spinner shrink-0" />
          <div>
            <div className="font-medium text-sm">
              {loadingPack ? 'Loading map...' : loadingStatus}
            </div>
            {loadingPack && loadingStatus && (
              <div className="text-xs text-muted-foreground">
                {loadingStatus}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
