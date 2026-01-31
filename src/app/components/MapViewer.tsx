import type { MutableRefObject } from 'react';
import type { Map } from 'maplibre-gl';

interface MapViewerProps {
  mapRef: MutableRefObject<Map | null>;
  mapDivRef: MutableRefObject<HTMLDivElement | null>;
  onMapInitialized: () => void;
  loadingPack: boolean;
  loadingStatus: string;
  activeLayer: string;
}

export function MapViewer(props: MapViewerProps) {
  const { mapDivRef, loadingPack, loadingStatus } = props;

  // Map initialization is handled in the parent App component
  // This component just renders the container and loading overlay

  return (
    <div className="relative h-full w-full">
      <div ref={mapDivRef} className="h-full w-full" />
      
      {/* Loading indicator overlay */}
      {loadingPack && (
        <div
          className="absolute top-4 left-4 bg-background/95 border rounded-lg shadow-lg p-4 flex items-center gap-3 z-[1000] min-w-[200px]"
        >
          <div className="loading-spinner" />
          <div>
            <div className="font-medium text-sm">
              {loadingPack ? 'Loading map...' : 'Loading...'}
            </div>
            {loadingStatus && (
              <div className="text-xs text-muted-foreground mt-1">
                {loadingStatus}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
