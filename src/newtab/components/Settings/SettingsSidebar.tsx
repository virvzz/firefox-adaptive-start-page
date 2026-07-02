import { type ReactNode } from 'react';

type Section =
  | 'themes'
  | 'layout'
  | 'background'
  | 'widgets'
  | 'sync'
  | 'advanced'
  | 'about';

interface SettingsSidebarProps {
  activeSection: Section;
  onSelect: (section: Section) => void;
}

const sections: { id: Section; label: string; icon: ReactNode }[] = [
  {
    id: 'themes',
    label: 'Темы',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 2.2 15.8 6v6L9 15.8 2.2 12V6L9 2.2Z" />
        <path d="M2.6 6.2 9 9.8l6.4-3.6" />
        <path d="M9 9.8v5.6" />
      </svg>
    ),
  },
  {
    id: 'layout',
    label: 'Плитки и макет',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="3" width="7" height="5.5" rx="1" />
        <rect x="9.5" y="3" width="7" height="5.5" rx="1" />
        <rect x="1.5" y="9.5" width="7" height="5.5" rx="1" />
        <rect x="9.5" y="9.5" width="7" height="5.5" rx="1" />
      </svg>
    ),
  },
  {
    id: 'background',
    label: 'Фон',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="1" width="16" height="16" rx="3" />
        <circle cx="8" cy="8" r="3" />
        <path d="M14 5l-8 8" />
        <circle cx="13" cy="6" r="0.8" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'widgets',
    label: 'Виджеты',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="1" width="7" height="4.5" rx="1" />
        <rect x="10" y="1" width="7" height="4.5" rx="1" />
        <rect x="1" y="7" width="10" height="10" rx="1" />
        <rect x="13" y="7" width="4" height="4" rx="1" />
        <rect x="13" y="12.5" width="4" height="4.5" rx="1" />
      </svg>
    ),
  },
  {
    id: 'sync',
    label: 'Синхронизация',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 8.5a5.5 5.5 0 0 0-10.6-1.5" />
        <path d="M3.5 9.5a5.5 5.5 0 0 0 10.6 1.5" />
        <path d="M2 5.5v3h3" />
        <path d="M16 12.5v-3h-3" />
      </svg>
    ),
  },
  {
    id: 'advanced',
    label: 'Дополнительно',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5.5" cy="3" r="1.5" />
        <circle cx="12.5" cy="3" r="1.5" />
        <circle cx="5.5" cy="9" r="1.5" />
        <circle cx="12.5" cy="9" r="1.5" />
        <circle cx="5.5" cy="15" r="1.5" />
        <circle cx="12.5" cy="15" r="1.5" />
        <path d="M7 3h4" />
        <path d="M7 9h4" />
        <path d="M7 15h4" />
      </svg>
    ),
  },
  {
    id: 'about',
    label: 'О программе',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="9" r="8" />
        <path d="M9 8.5v5" />
        <circle cx="9" cy="5.5" r="0.6" fill="currentColor" />
      </svg>
    ),
  },
];

export function SettingsSidebar({ activeSection, onSelect }: SettingsSidebarProps) {
  return (
    <nav className="flex flex-col gap-0.5 py-4 px-3">
      <div className="px-3 py-2 mb-2">
        <h1 className="text-base font-bold text-white tracking-tight">
          Настройки
        </h1>
        <p className="text-xs text-white/30 mt-0.5">
          FASP v0.1
        </p>
      </div>
      {sections.map((section) => {
        const isActive = activeSection === section.id;
        return (
          <button
            key={section.id}
            data-testid={`settings-section-${section.id}`}
            onClick={() => onSelect(section.id)}
            className={`
              group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
              transition-all duration-200 ease-out
              ${isActive
                ? 'text-white'
                : 'text-white/45 hover:bg-white/5 hover:text-white/75'
              }
            `}
            style={isActive ? {
              background: 'color-mix(in srgb, var(--fasp-accent) 16%, transparent)',
              boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--fasp-accent) 34%, transparent)',
            } : undefined}
          >
            <span className={`
              transition-colors duration-200
              ${isActive ? '' : 'text-white/25 group-hover:text-white/45'}
            `}
            style={isActive ? { color: 'color-mix(in srgb, var(--fasp-accent) 62%, white)' } : undefined}
            >
              {section.icon}
            </span>
            <span>{section.label}</span>
            {isActive && (
              <span
                className="ml-auto h-1.5 w-1.5 rounded-full"
                style={{
                  background: 'var(--fasp-accent)',
                  boxShadow: '0 0 8px color-mix(in srgb, var(--fasp-accent) 60%, transparent)',
                }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
