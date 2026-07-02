import { useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  valueFormatter?: (value: number) => string;
}

export function SliderControl({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  valueFormatter,
}: SliderControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const percentage = max === min
    ? 0
    : Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const displayValue = valueFormatter ? valueFormatter(value) : `${value}${unit}`;
  const sliderStyle = { '--slider-progress': `${percentage}%` } as CSSProperties;
  const stepPrecision = String(step).includes('.')
    ? String(step).split('.')[1].length
    : 0;

  const valueFromPointer = useCallback((clientX: number) => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || max === min) return value;

    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = min + ratio * (max - min);
    const stepped = min + Math.round((raw - min) / step) * step;
    const normalized = Number(stepped.toFixed(stepPrecision));
    return Math.max(min, Math.min(max, normalized));
  }, [max, min, step, stepPrecision, value]);

  const commitPointerValue = useCallback((clientX: number) => {
    const nextValue = valueFromPointer(clientX);
    if (nextValue !== value) onChange(nextValue);
  }, [onChange, value, valueFromPointer]);

  return (
    <div className="settings-slider-control space-y-2 py-1.5">
      <div className="settings-slider-header flex items-center justify-between">
        <span className="text-sm font-medium text-white/80">{label}</span>
        <span
          className="min-w-[3rem] rounded-md px-2 py-0.5 text-center font-mono text-xs"
          style={{
            color: 'color-mix(in srgb, var(--fasp-accent) 68%, white)',
            background: 'color-mix(in srgb, var(--fasp-accent) 14%, transparent)',
          }}
        >
          {displayValue}
        </span>
      </div>
      <input
        ref={inputRef}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          draggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          commitPointerValue(event.clientX);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current) return;
          commitPointerValue(event.clientX);
        }}
        onPointerUp={(event) => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          commitPointerValue(event.clientX);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          draggingRef.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        className="settings-slider-input"
        style={sliderStyle}
      />
    </div>
  );
}
