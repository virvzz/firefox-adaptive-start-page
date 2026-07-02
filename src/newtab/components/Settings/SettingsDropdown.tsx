import { useState, useRef, useEffect } from 'react';

interface SettingsDropdownProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  description?: string;
}

export function SettingsDropdown({ label, value, options, onChange, description }: SettingsDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  return (
    <div className="settings-dropdown space-y-1.5 py-1.5 relative" ref={ref}>
      <span className="settings-dropdown-label text-sm font-medium text-white/80">{label}</span>
      {description && (
        <span className="settings-dropdown-description text-xs text-white/40 block mt-0.5 mb-1">{description}</span>
      )}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`
          settings-dropdown-trigger w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm
          bg-white/5 backdrop-blur-xl border transition-all duration-200
          ${open
            ? ''
            : 'border-white/10 hover:border-white/20 hover:bg-white/8'
          }
        `}
        style={open ? {
          borderColor: 'color-mix(in srgb, var(--fasp-accent) 55%, transparent)',
          boxShadow: '0 0 16px color-mix(in srgb, var(--fasp-accent) 16%, transparent)',
        } : undefined}
      >
        <span className="settings-dropdown-value text-white/90">{selectedLabel}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className={`text-white/40 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="
          settings-dropdown-menu
          absolute z-50 mt-1 w-full min-w-fit
          bg-[#1e1b2e]/95 backdrop-blur-2xl border border-white/10 rounded-xl
          shadow-2xl shadow-black/50 overflow-hidden
          animate-[fadeIn_0.15s_ease-out]
          max-h-48 overflow-y-auto
        ">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`
                settings-dropdown-option w-full text-left px-4 py-2.5 text-sm transition-colors duration-100
                ${opt.value === value
                  ? 'text-white'
                  : 'text-white/70 hover:bg-white/5 hover:text-white/90'
                }
              `}
              style={opt.value === value ? {
                background: 'color-mix(in srgb, var(--fasp-accent) 16%, transparent)',
                color: 'color-mix(in srgb, var(--fasp-accent) 58%, white)',
              } : undefined}
            >
              <span>{opt.label}</span>
              {opt.value === value && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="inline-block ml-2">
                  <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
