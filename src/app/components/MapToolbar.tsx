import { Hand, Paintbrush, Eraser, Eye, EyeOff, Layers, Palette, BoxSelect, MousePointer2, SquareDashed } from 'lucide-react';
import type React from 'react';
import { CustomSelect } from './CustomSelect';
import { ZOOM_THRESHOLD_COUNTY_TO_VTD, ZOOM_THRESHOLD_VTD_TO_BLOCK, midZoomLayer } from '@/app/constants/config';
import type { LayerZoomRanges } from '@/app/hooks/usePackLoader';

export type DrawingTool = 'pan' | 'paint' | 'erase' | 'box' | 'pointer';

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
  hasVtd: boolean;
  visible: boolean;
  workerReady: boolean;
  activeDistrict: number;
  prevDistrict: number;
  showOutlines: boolean;
  onShowOutlinesChange: (show: boolean) => void;
}


export function MapToolbar({ drawingTool, onDrawingToolChange, visualizationMode, onVisualizationModeChange, districtColorMetric, onDistrictColorMetricChange, layerOverride, onLayerOverrideChange, currentZoom, layerZoomRanges, hasVtd, visible, workerReady, activeDistrict, prevDistrict, showOutlines, onShowOutlinesChange }: MapToolbarProps) {
  if (!visible) return null;

  const precinctLayer = midZoomLayer(hasVtd);
  const LAYER_OPTIONS = [
    { value: 'county',       label: 'County',   minZoom: 0 },
    { value: 'tract',        label: 'Tract',    minZoom: ZOOM_THRESHOLD_COUNTY_TO_VTD },
    { value: precinctLayer,  label: 'Precinct', minZoom: ZOOM_THRESHOLD_COUNTY_TO_VTD },
    { value: 'block',        label: 'Block',    minZoom: ZOOM_THRESHOLD_VTD_TO_BLOCK },
  ];

  const activeLayerLabel = layerOverride
    ? LAYER_OPTIONS.find(o => o.value === layerOverride)?.label ?? 'Unit'
    : [...LAYER_OPTIONS].reverse().find(o => currentZoom >= o.minZoom)?.label ?? 'County';

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
    const disabled = (isPaintTool && !workerReady) || (tool === 'paint' && activeDistrict === 0 && prevDistrict === 0) || (tool === 'pointer' && !workerReady);
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
        {toolButton('pointer', <MousePointer2 className="w-5 h-5" />, 'Inspect')}
        {toolButton('paint', <Paintbrush className="w-5 h-5" />, 'Paint')}
        {toolButton('erase', <Eraser className="w-5 h-5" />, 'Erase')}
        {(() => {
          const boxDisabled = !workerReady;
          const innerColor = boxDisabled ? 'text-gray-300' : 'text-gray-500';
          return toolButton('box', (
            <div className="relative">
              <BoxSelect className="w-5 h-5" />
              <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-px shadow-sm">
                {activeDistrict === 0
                  ? <Eraser className={`w-3.5 h-3.5 ${innerColor}`} />
                  : <Paintbrush className={`w-3.5 h-3.5 ${innerColor}`} />}
              </div>
            </div>
          ), activeDistrict === 0 ? 'Box erase' : 'Box paint');
        })()}
      </div>

      {/* View controls — single card with dividers */}
      <div className="flex items-stretch bg-white rounded-lg shadow-lg pointer-events-auto divide-x divide-gray-200 px-1 py-1">
        {/* Districts + Outlines toggles */}
        <div className="flex items-center gap-1 pr-1">
          <button
            title={visualizationMode === 'districts' ? 'Hide districts' : 'Show districts'}
            onClick={() => onVisualizationModeChange(visualizationMode === 'districts' ? 'map' : 'districts')}
            className={`p-2.5 rounded-lg transition-colors cursor-pointer ${
              visualizationMode === 'districts' ? 'text-gray-600 hover:bg-gray-100' : 'text-gray-300 hover:bg-gray-100'
            }`}
          >
            {visualizationMode === 'districts' ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
          </button>
          <button
            title={showOutlines ? 'Hide unit outlines' : 'Show unit outlines'}
            onClick={() => onShowOutlinesChange(!showOutlines)}
            className={`p-2.5 rounded-lg transition-colors cursor-pointer ${
              showOutlines ? 'text-gray-600 hover:bg-gray-100' : 'text-gray-300 hover:bg-gray-100'
            }`}
          >
            <SquareDashed className="w-5 h-5" />
          </button>
        </div>

        {/* Metric dropdown */}
        <div className="relative flex items-center px-3">
          <CustomSelect
            prefix={<Palette className="w-4 h-4 text-gray-700 shrink-0" />}
            value={districtColorMetric}
            onChange={onDistrictColorMetricChange}
            options={[
              { value: 'default',            label: 'Color',          group: 'District' },
              { value: 'deviation',          label: 'Deviation'  },
              { value: 'partisan',           label: 'Partisan',       group: activeLayerLabel },
              { value: 'population_density', label: 'Density'    },
              { value: 'turnout',            label: 'Turnout'    },
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

        {/* Layer selector */}
        <div className="relative flex items-center px-3">
          <CustomSelect
            prefix={<Layers className="w-4 h-4 text-gray-700 shrink-0" />}
            value={layerOverride ?? 'auto'}
            onChange={v => onLayerOverrideChange(v === 'auto' ? null : v)}
            options={[
              { value: 'auto', label: `Auto (${[...LAYER_OPTIONS].reverse().find(o => currentZoom >= o.minZoom)?.label ?? 'County'})`, buttonLabel: 'Auto' },
              ...availableOptions,
            ]}
          />
        </div>

      </div>
    </div>
  );
}
