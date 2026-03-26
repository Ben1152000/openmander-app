import { Hand, Paintbrush, Eraser, Layers, BoxSelect } from 'lucide-react';
import type React from 'react';
import { ZOOM_THRESHOLD_COUNTY_TO_VTD, ZOOM_THRESHOLD_VTD_TO_BLOCK } from '@/app/constants/config';
import type { LayerZoomRanges } from '@/app/hooks/usePackLoader';

export type DrawingTool = 'pan' | 'paint' | 'erase' | 'box';

const LAYER_OPTIONS: { value: string; label: string; minZoom: number }[] = [
  { value: 'county', label: 'County', minZoom: 0 },
  { value: 'tract',  label: 'Tract',  minZoom: ZOOM_THRESHOLD_COUNTY_TO_VTD },
  { value: 'vtd',    label: 'VTD',    minZoom: ZOOM_THRESHOLD_COUNTY_TO_VTD },
  { value: 'block',  label: 'Block',  minZoom: ZOOM_THRESHOLD_VTD_TO_BLOCK },
];

interface MapToolbarProps {
  drawingTool: DrawingTool;
  onDrawingToolChange: (tool: DrawingTool) => void;
  visualizationMode: 'districts' | 'map';
  onVisualizationModeChange: (mode: 'districts' | 'map') => void;
  districtColorMetric: string;
  onDistrictColorMetricChange: (metric: string) => void;
  layerOverride: string | null;
  onLayerOverrideChange: (layer: string | null) => void;
  currentZoom: number;
  layerZoomRanges: LayerZoomRanges;
  visible: boolean;
  workerReady: boolean;
  activeDistrict: number;
}


export function MapToolbar({ drawingTool, onDrawingToolChange, visualizationMode, onVisualizationModeChange, districtColorMetric, onDistrictColorMetricChange, layerOverride, onLayerOverrideChange, currentZoom, layerZoomRanges, visible, workerReady, activeDistrict }: MapToolbarProps) {
  if (!visible) return null;

  const hasRanges = Object.keys(layerZoomRanges).length > 0;
  const availableOptions = LAYER_OPTIONS.filter(o => {
    if (hasRanges) {
      const range = layerZoomRanges[o.value];
      if (!range) return false;
      return currentZoom >= range.minzoom && currentZoom <= range.maxzoom;
    }
    return currentZoom >= o.minZoom;
  });

  const toolButton = (tool: DrawingTool, icon: React.ReactNode, title: string) => {
    const isPaintTool = tool === 'paint' || tool === 'erase' || tool === 'box';
    const disabled = (isPaintTool && !workerReady) || (tool === 'paint' && activeDistrict === 0);
    return (
      <button
        key={tool}
        title={disabled ? 'Initializing redistricting engine...' : title}
        disabled={disabled}
        onClick={() => onDrawingToolChange(tool)}
        className={`p-2.5 rounded-lg transition-colors ${
          disabled
            ? 'text-gray-300 cursor-not-allowed'
            : drawingTool === tool
              ? 'bg-blue-100 text-blue-700'
              : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        {icon}
      </button>
    );
  };

  return (
    <div className="absolute top-4 left-4 right-4 z-10 flex justify-between pointer-events-none">
      {/* Drawing Tools */}
      <div className="flex items-center gap-1 bg-white rounded-lg shadow-lg p-1 pointer-events-auto">
        {toolButton('pan', <Hand className="w-5 h-5" />, 'Pan')}
        {toolButton('paint', <Paintbrush className="w-5 h-5" />, 'Paint districts')}
        {toolButton('erase', <Eraser className="w-5 h-5" />, 'Erase assignments')}
        {toolButton('box', (
          <div className="relative">
            <BoxSelect className="w-5 h-5" />
            <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-px shadow-sm">
              {activeDistrict === 0
                ? <Eraser className="w-3.5 h-3.5 text-gray-500" />
                : <Paintbrush className="w-3.5 h-3.5 text-gray-500" />}
            </div>
          </div>
        ), 'Box select')}
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-3 pointer-events-auto">
        {/* Visualization Mode Button */}
        <button
          className="flex items-center gap-2 bg-white rounded-lg shadow-lg px-3 py-2 cursor-pointer select-none text-gray-700 hover:bg-gray-50 transition-colors"
          onClick={() => onVisualizationModeChange(visualizationMode === 'districts' ? 'map' : 'districts')}
          title={visualizationMode === 'districts' ? 'Switch to map view' : 'Switch to district view'}
        >
          <Layers className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium">
            {visualizationMode === 'districts' ? 'District View' : 'Map View'}
          </span>
        </button>

        {/* Layer selector */}
        <div className="flex items-center bg-white rounded-lg shadow-lg px-3">
          <select
            value={layerOverride ?? 'auto'}
            onChange={e => onLayerOverrideChange(e.target.value === 'auto' ? null : e.target.value)}
            className="text-sm font-medium text-gray-700 bg-transparent cursor-pointer outline-none py-[9.5px]"
          >
            <option value="auto">
              Auto ({LAYER_OPTIONS.findLast(o => currentZoom >= o.minZoom)?.label ?? 'County'})
            </option>
            {availableOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Metric dropdown */}
        <div className="flex items-center bg-white rounded-lg shadow-lg px-3">
          <select
            value={districtColorMetric}
            onChange={e => onDistrictColorMetricChange(e.target.value)}
            className="text-sm font-medium text-gray-700 bg-transparent cursor-pointer outline-none py-[9.5px]"
          >
            <option value="default">Color</option>
            <option value="partisan">Partisan</option>
            <option value="population_density">Density</option>
            <option value="ethnicity">Ethnicity</option>
            <option value="white_pct">White %</option>
            <option value="black_pct">Black %</option>
            <option value="hispanic_pct">Hispanic %</option>
            <option value="asian_pct">Asian %</option>
            <option value="native_pct">Native %</option>
            <option value="pacific_pct">Pacific %</option>
          </select>
        </div>
      </div>
    </div>
  );
}
