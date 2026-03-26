import { Hand, Paintbrush, Eraser, Eye, EyeOff, Layers, Palette, BoxSelect } from 'lucide-react';
import type React from 'react';
import { CustomSelect } from './CustomSelect';
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
  prevDistrict: number;
}


export function MapToolbar({ drawingTool, onDrawingToolChange, visualizationMode, onVisualizationModeChange, districtColorMetric, onDistrictColorMetricChange, layerOverride, onLayerOverrideChange, currentZoom, layerZoomRanges, visible, workerReady, activeDistrict, prevDistrict }: MapToolbarProps) {
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
    const disabled = (isPaintTool && !workerReady) || (tool === 'paint' && activeDistrict === 0 && prevDistrict === 0);
    return (
      <button
        key={tool}
        title={title}
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
        {toolButton('paint', <Paintbrush className="w-5 h-5" />, 'Paint')}
        {toolButton('erase', <Eraser className="w-5 h-5" />, 'Erase')}
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

      {/* Right controls — single card with dividers */}
      <div className="flex items-stretch bg-white rounded-lg shadow-lg pointer-events-auto divide-x divide-gray-200 px-1 py-1">
        {/* Visualization mode toggle */}
        <button
          className={`flex items-center gap-1.5 px-3 py-2 rounded-l-lg transition-colors cursor-pointer select-none ${
            visualizationMode === 'districts' ? 'text-gray-700 hover:bg-gray-100' : 'text-gray-400 hover:bg-gray-100'
          }`}
          onClick={() => onVisualizationModeChange(visualizationMode === 'districts' ? 'map' : 'districts')}
          title={visualizationMode === 'districts' ? 'Hide districts' : 'Show districts'}
        >
          {visualizationMode === 'districts'
            ? <Eye className="w-4 h-4" />
            : <EyeOff className="w-4 h-4" />}
          <span className="text-sm font-medium">Districts</span>
        </button>

        {/* Layer selector */}
        <div className="relative flex items-center px-3">
          <CustomSelect
            prefix={<Layers className="w-4 h-4 text-gray-700 shrink-0" />}
            value={layerOverride ?? 'auto'}
            onChange={v => onLayerOverrideChange(v === 'auto' ? null : v)}
            options={[
              { value: 'auto', label: `Auto (${LAYER_OPTIONS.findLast(o => currentZoom >= o.minZoom)?.label ?? 'County'})`, buttonLabel: 'Auto' },
              ...availableOptions,
            ]}
          />
        </div>

        {/* Metric dropdown */}
        <div className="relative flex items-center px-3">
          <CustomSelect
            prefix={<Palette className="w-4 h-4 text-gray-700 shrink-0" />}
            value={districtColorMetric}
            onChange={onDistrictColorMetricChange}
            options={[
              { value: 'default',            label: 'Color'      },
              { value: 'partisan',           label: 'Partisan'   },
              { value: 'population_density', label: 'Density'    },
              { value: 'ethnicity',          label: 'Ethnicity'  },
              { value: 'white_pct',          label: 'White\u00a0%' },
              { value: 'black_pct',          label: 'Black\u00a0%'    },
              { value: 'hispanic_pct',       label: 'Hispanic\u00a0%' },
              { value: 'asian_pct',          label: 'Asian\u00a0%'    },
              { value: 'native_pct',         label: 'Native\u00a0%'   },
              { value: 'pacific_pct',        label: 'Pacific\u00a0%'  },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
