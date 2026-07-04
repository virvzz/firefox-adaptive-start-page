import type { CSSProperties } from 'react';
import type { ThemeDefinition } from '../../../types';
import { colorWithOpacity, shadowLabels, shadowPreview } from './settingsShared';

export function ThemeLivePreview({ theme }: { theme: ThemeDefinition }) {
  const previewBackground = theme.background.style === 'gradient' && theme.background.gradient
    ? theme.background.gradient
    : `radial-gradient(circle at 18% 20%, ${theme.colors.accent}44, transparent 34%), radial-gradient(circle at 82% 28%, ${theme.colors.accent2}33, transparent 30%), linear-gradient(135deg, #070b18, #12182a)`;

  const glassPanel: CSSProperties = {
    background: theme.glass.enabled ? colorWithOpacity(theme.colors.surfaceStrong, theme.glass.opacity) : 'rgba(12, 16, 30, 0.94)',
    borderColor: theme.colors.border,
    borderRadius: Math.max(18, theme.tiles.radius + 4),
    backdropFilter: theme.glass.enabled ? `blur(${theme.glass.blur}px) saturate(${theme.glass.saturation}%)` : 'none',
    WebkitBackdropFilter: theme.glass.enabled ? `blur(${theme.glass.blur}px) saturate(${theme.glass.saturation}%)` : 'none',
    boxShadow: shadowPreview[theme.tiles.shadow],
  };
  const tileStyle: CSSProperties = {
    borderRadius: theme.tiles.radius,
    opacity: theme.tiles.opacity,
    background: theme.glass.enabled
      ? `linear-gradient(135deg, ${colorWithOpacity(theme.colors.surface, theme.glass.opacity)}, rgba(255,255,255,0.04))`
      : 'rgba(255,255,255,0.055)',
    borderColor: theme.colors.border,
    boxShadow: shadowPreview[theme.tiles.shadow],
  };
  const miniTileStyle: CSSProperties = {
    borderRadius: Math.max(10, theme.tiles.radius * 0.55),
    background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent2})`,
    boxShadow: `0 10px 24px ${theme.colors.accent}33`,
  };

  return (
    <aside className="theme-live-preview-panel" data-testid="theme-live-preview">
      <div className="theme-live-preview-header">
        <div>
          <h3>Живая демонстрация</h3>
          <p>Показывает, как выбранные настройки будут выглядеть на странице.</p>
        </div>
        <span style={{ color: theme.colors.accent }}>
          {theme.glass.enabled ? 'Стекло' : 'Плоский стиль'}
        </span>
      </div>

      <div className="theme-live-stage" data-testid="theme-live-stage" style={{ background: previewBackground }}>
        <div className="theme-live-noise" />
        <div className="theme-live-orb theme-live-orb-a" style={{ background: theme.colors.accent }} />
        <div className="theme-live-orb theme-live-orb-b" style={{ background: theme.colors.accent2 }} />
        <div className="theme-live-orb theme-live-orb-c" style={{ background: theme.colors.danger }} />
        <div className="theme-live-topbar" style={glassPanel}>
          <span style={{ color: theme.colors.text }}>Поиск по закладкам...</span>
          <strong style={{ color: theme.colors.accent }}>⌘</strong>
        </div>

        <div className="theme-live-grid" style={{ gap: theme.layout.spacing }}>
          <div className="theme-live-tile theme-live-tile-large" style={tileStyle}>
            <div className="theme-live-icon" style={miniTileStyle}>F</div>
            <span style={{ color: theme.colors.text }}>Firefox</span>
          </div>
          <div className="theme-live-tile theme-live-folder" style={tileStyle}>
            <div className="theme-live-folder-grid">
              {[theme.colors.accent, theme.colors.accent2, theme.colors.danger, theme.colors.text].map((color, index) => (
                <i key={`${color}-${index}`} style={{ background: color }} />
              ))}
            </div>
            <span style={{ color: theme.colors.text }}>Работа</span>
          </div>
          <div className="theme-live-tile theme-live-hover" style={{ ...tileStyle, transform: `translateY(-5px) scale(${theme.tiles.hoverScale})` }}>
            <div className="theme-live-icon" style={{ ...miniTileStyle, background: theme.colors.accent2 }}>A</div>
            <span style={{ color: theme.colors.text }}>Наведение</span>
          </div>
        </div>

        <div className="theme-live-menu" style={glassPanel}>
          <button style={{ color: theme.colors.text }}>Открыть</button>
          <button style={{ color: theme.colors.text }}>Изменить цвет</button>
          <button style={{ color: theme.colors.danger }}>Удалить</button>
        </div>
      </div>

      <div className="theme-live-metrics">
        <div>
          <span>Радиус</span>
          <strong>{theme.tiles.radius}px</strong>
        </div>
        <div>
          <span>Размытие</span>
          <strong>{theme.glass.enabled ? `${theme.glass.blur}px` : 'выкл'}</strong>
        </div>
        <div>
          <span>Тень</span>
          <strong>{shadowLabels[theme.tiles.shadow]}</strong>
        </div>
      </div>
    </aside>
  );
}
