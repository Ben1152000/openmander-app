import { useEffect, useRef, useState } from 'react';
import { Hand, Paintbrush, Eraser, ChevronDown } from 'lucide-react';

export type DrawingTool = 'pan' | 'paint' | 'erase';

interface MapToolbarProps {
  drawingTool: DrawingTool;
  onDrawingToolChange: (tool: DrawingTool) => void;
  visualizationMode: 'districts' | 'partisan';
  onVisualizationModeChange: (mode: 'districts' | 'partisan') => void;
  visible: boolean;
}

const VIZ_OPTIONS: { value: 'districts' | 'partisan'; label: string; description: string }[] = [
  { value: 'districts', label: 'District View', description: 'Show district polygons' },
  { value: 'partisan', label: 'Map View', description: 'Color individual units' },
];

export function MapToolbar({ drawingTool, onDrawingToolChange, visualizationMode, onVisualizationModeChange, visible }: MapToolbarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handle = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [dropdownOpen]);

  if (!visible) return null;

  const currentOption = VIZ_OPTIONS.find(o => o.value === visualizationMode) ?? VIZ_OPTIONS[0];

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

      {/* Visualization Mode Dropdown */}
      <div className="relative pointer-events-auto" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(o => !o)}
          className="flex items-center gap-1.5 bg-white rounded-lg shadow-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {currentOption.label}
          <ChevronDown className="w-4 h-4 text-gray-500" />
        </button>
        {dropdownOpen && (
          <div className="absolute top-full right-0 mt-1 w-52 bg-white rounded-lg shadow-xl border overflow-hidden">
            {VIZ_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => { onVisualizationModeChange(opt.value); setDropdownOpen(false); }}
                className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                  visualizationMode === opt.value
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="font-medium">{opt.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{opt.description}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
