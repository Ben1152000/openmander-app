import type { ReactNode } from 'react';
import { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface CustomSelectOption {
  value: string;
  label: string;
  /** Shorter label shown in the trigger button; falls back to label. */
  buttonLabel?: string;
}

export function CustomSelect({ value, onChange, options, prefix, dropdownAlign = 'left' }: {
  value: string;
  onChange: (v: string) => void;
  options: CustomSelectOption[];
  prefix?: ReactNode;
  dropdownAlign?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // If the dropdown bleeds off the viewport edge, flip alignment.
  useLayoutEffect(() => {
    if (!open || !dropdownRef.current) return;
    const rect = dropdownRef.current.getBoundingClientRect();
    if (dropdownAlign === 'right') {
      if (rect.left < 0) {
        dropdownRef.current.style.right = 'auto';
        dropdownRef.current.style.left = '0';
      }
    } else {
      if (rect.right > window.innerWidth) {
        dropdownRef.current.style.left = 'auto';
        dropdownRef.current.style.right = '0';
      }
    }
  }, [open, dropdownAlign]);

  const selected = options.find(o => o.value === value);
  const displayLabel = selected?.buttonLabel ?? selected?.label ?? value;

  return (
    <div ref={ref} className="flex items-center h-full">
      <button
        className="flex items-center gap-1.5 h-full px-0 text-sm font-medium text-gray-700 cursor-pointer"
        onClick={() => setOpen(v => !v)}
      >
        {prefix}
        {displayLabel}
        <ChevronDown className="w-3 h-3 text-gray-400" />
      </button>
      {open && (
        <div ref={dropdownRef} className={`absolute top-full bg-gray-100 rounded-lg shadow-xl border border-gray-200 p-1 z-50 flex flex-col min-w-full ${dropdownAlign === 'right' ? 'right-0' : 'left-0'}`}>
          {options.map(o => (
            <button
              key={o.value}
              className="flex items-center gap-1.5 text-left pl-2 pr-4 py-0.5 text-sm font-normal whitespace-nowrap hover:bg-blue-500 hover:text-white rounded text-gray-700"
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <Check className={`w-3 h-3 shrink-0 ${value === o.value ? 'opacity-100' : 'opacity-0'}`} />
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
