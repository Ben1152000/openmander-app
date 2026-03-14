import { Hand, Paintbrush, Eraser, Layers } from 'lucide-react';
import type React from 'react';

export type DrawingTool = 'pan' | 'paint' | 'erase';

interface MapToolbarProps {
  drawingTool: DrawingTool;
  onDrawingToolChange: (tool: DrawingTool) => void;
  visualizationMode: 'districts' | 'map';
  onVisualizationModeChange: (mode: 'districts' | 'map') => void;
  districtColorMetric: string;
  onDistrictColorMetricChange: (metric: string) => void;
  visible: boolean;
}


export function MapToolbar({ drawingTool, onDrawingToolChange, visualizationMode, onVisualizationModeChange, districtColorMetric, onDistrictColorMetricChange, visible }: MapToolbarProps) {
  if (!visible) return null;

  const toolButton = (tool: DrawingTool, icon: React.ReactNode, title: string) => (
    <button
      key={tool}
      title={title}
      onClick={() => onDrawingToolChange(tool)}
      className={`p-2.5 rounded-lg transition-colors ${
        drawingTool === tool
          ? 'bg-blue-100 text-blue-700'
          : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="absolute top-4 left-4 right-4 z-10 flex justify-between pointer-events-none">
      {/* Drawing Tools */}
      <div className="flex items-center gap-1 bg-white rounded-lg shadow-lg p-1 pointer-events-auto">
        {toolButton('pan', <Hand className="w-5 h-5" />, 'Pan')}
        {toolButton('paint', <Paintbrush className="w-5 h-5" />, 'Paint districts')}
        {toolButton('erase', <Eraser className="w-5 h-5" />, 'Erase assignments')}
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-3 pointer-events-auto">
        {/* Visualization Mode Button */}
        <button
          className="flex items-center gap-2 bg-white rounded-lg shadow-lg px-3 h-9 cursor-pointer select-none text-gray-700 hover:bg-gray-50 transition-colors"
          onClick={() => onVisualizationModeChange(visualizationMode === 'districts' ? 'map' : 'districts')}
          title={visualizationMode === 'districts' ? 'Switch to map view' : 'Switch to district view'}
        >
          <Layers className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium">
            {visualizationMode === 'districts' ? 'District View' : 'Map View'}
          </span>
        </button>

        {/* Metric dropdown */}
        <div className="flex items-center bg-white rounded-lg shadow-lg px-3 h-9">
          <select
            value={districtColorMetric}
            onChange={e => onDistrictColorMetricChange(e.target.value)}
            className="text-sm font-medium text-gray-700 bg-transparent cursor-pointer outline-none"
          >
            <option value="default">Color</option>
            <option value="partisan">Partisan</option>
            <option value="population_density">Density</option>
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
