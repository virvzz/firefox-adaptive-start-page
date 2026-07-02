interface ToggleSwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ToggleSwitch({ label, description, checked, onChange }: ToggleSwitchProps) {
  return (
    <label className="settings-toggle-row flex items-center justify-between gap-3 py-2 cursor-pointer group">
      <div className="settings-toggle-copy flex min-w-0 flex-col">
        <span className="text-sm font-medium text-white/90 transition-colors group-hover:text-white">
          {label}
        </span>
        {description && (
          <span className="text-xs text-white/40 mt-0.5">{description}</span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`
          settings-toggle-switch
          relative inline-flex h-6 w-11 shrink-0 items-center rounded-full
          transition-all duration-300 ease-out
          ${checked ? '' : 'bg-white/10 hover:bg-white/15'}
        `}
        style={checked ? {
          background: 'var(--fasp-accent)',
          boxShadow: '0 0 12px color-mix(in srgb, var(--fasp-accent) 40%, transparent)',
        } : undefined}
      >
        <span
          className={`
            inline-block h-4 w-4 rounded-full bg-white shadow-md
            transition-all duration-300 ease-out
            ${checked ? 'translate-x-6' : 'translate-x-1'}
          `}
        />
      </button>
    </label>
  );
}
