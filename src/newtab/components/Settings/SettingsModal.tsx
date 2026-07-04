import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';
import { SettingsSidebar } from './SettingsSidebar';
import { SliderControl } from './SliderControl';
import { ToggleSwitch } from './ToggleSwitch';
import { SettingsDropdown } from './SettingsDropdown';
import { extractImagePalette } from '../../../engines/imagePalette';
import { useLayoutStore } from '../../stores/layoutStore';
import { useBackgroundStore } from '../../stores/backgroundStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { PRESET_THEMES, useThemeStore } from '../../stores/themeStore';
import { useTileStore } from '../../stores/tilesStore';
import { saveImageAssetFromDataUrl } from '../../media/mediaAssets';
import { exportProfileJson, importProfileJson } from '../../profile/profileTransfer';
import type { AppSettings, LayoutConfig, ThemeDefinition, ThemeShadowPreset } from '../../../types';

type Section =
  | 'themes'
  | 'layout'
  | 'background'
  | 'widgets'
  | 'sync'
  | 'advanced'
  | 'about';

type ThemeColorKey = 'accent' | 'accent2' | 'text' | 'danger';

interface SettingsModalProps {
  onClose: () => void;
}

const shadowLabels: Record<ThemeShadowPreset, string> = {
  none: 'Без тени',
  soft: 'Мягкая',
  deep: 'Глубокая',
  floating: 'Парящая',
};

const shadowPreview: Record<ThemeShadowPreset, string> = {
  none: 'none',
  soft: '0 14px 34px rgba(0, 0, 0, 0.24)',
  deep: '0 24px 58px rgba(0, 0, 0, 0.42)',
  floating: '0 28px 70px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(255, 255, 255, 0.08)',
};

const backgroundLabels: Record<ThemeDefinition['background']['style'], string> = {
  current: 'Текущий фон приложения',
  gradient: 'Градиент темы',
  generative: 'Генеративный фон',
  static: 'Статичное изображение',
};

const animationLabels: Record<ThemeDefinition['animation']['speed'], string> = {
  reduced: 'Спокойная',
  normal: 'Обычная',
  expressive: 'Выразительная',
};

const themeColorPresets: Record<ThemeColorKey, string[]> = {
  accent: ['#8b5cf6', '#64748b', '#38bdf8', '#22c55e', '#f59e0b', '#ef4444'],
  accent2: ['#22d3ee', '#94a3b8', '#a3be8c', '#f472b6', '#fb923c', '#c084fc'],
  text: ['#f8fafc', '#e5e7eb', '#cbd5e1', '#94a3b8', '#111827', '#020617'],
  danger: ['#f87171', '#ef4444', '#fb7185', '#bf616a', '#f97316', '#dc2626'],
};

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const raw = match[1].length === 3
    ? match[1].split('').map((char) => char + char).join('')
    : match[1];
  return `#${raw.toLowerCase()}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  const normalized = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((value) => Number.isNaN(value))) return `rgba(139, 92, 246, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildPaletteGradient(palette: string[]): string {
  const [accent, accent2 = accent, depth = accent, glow = accent2, danger = accent] = palette;
  return [
    `radial-gradient(circle at 14% 18%, ${hexToRgba(accent, 0.58)}, transparent 30%)`,
    `radial-gradient(circle at 84% 18%, ${hexToRgba(accent2, 0.42)}, transparent 28%)`,
    `radial-gradient(circle at 32% 76%, ${hexToRgba(glow, 0.34)}, transparent 34%)`,
    `radial-gradient(circle at 74% 82%, ${hexToRgba(danger, 0.28)}, transparent 32%)`,
    `conic-gradient(from 225deg at 52% 48%, transparent 0deg, ${hexToRgba(accent, 0.16)} 56deg, transparent 118deg, ${hexToRgba(accent2, 0.14)} 206deg, transparent 306deg)`,
    `linear-gradient(135deg, ${hexToRgba(depth, 0.98)}, ${hexToRgba(glow, 0.82)} 48%, rgba(3, 7, 18, 0.98))`,
  ].join(', ');
}

function themeToPalette(theme: ThemeDefinition): string[] {
  return [
    theme.colors.accent,
    theme.colors.accent2,
    theme.colors.surfaceStrong.startsWith('#') ? theme.colors.surfaceStrong : theme.colors.accent,
    theme.colors.surface.startsWith('#') ? theme.colors.surface : theme.colors.accent2,
    theme.colors.danger,
  ];
}

function colorWithOpacity(color: string, opacity: number): string {
  if (color.startsWith('#')) return hexToRgba(color, opacity);
  const match = color.match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return color;
  const parts = match[1].split(',').map((part) => part.trim());
  const [r, g, b] = parts;
  const sourceAlpha = parts[3] !== undefined ? Number(parts[3]) : 1;
  const nextAlpha = Number.isFinite(sourceAlpha) ? Math.max(0, Math.min(1, sourceAlpha * opacity)) : opacity;
  return `rgba(${r}, ${g}, ${b}, ${nextAlpha})`;
}

function ThemeLivePreview({ theme }: { theme: ThemeDefinition }) {
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

function LayoutLivePreview({
  layout,
  settings,
  theme,
}: {
  layout: LayoutConfig;
  settings: AppSettings;
  theme: ThemeDefinition;
}) {
  const rootColumns = Math.min(Math.max(layout.columns, 2), 12);
  const folderColumns = Math.min(Math.max(layout.folderColumns || layout.columns, 2), 12);
  const rootItems = Array.from({ length: rootColumns });
  const folderItems = Array.from({ length: settings.folderViewMode === 'list' ? 2 : folderColumns });
  const previewGap = Math.max(4, Math.min(theme.layout.spacing, 10));
  const tileRadius = Math.min(theme.tiles.radius, 34);
  const tileOpacity = theme.tiles.opacity;
  const showThumbnail = settings.tileVisualMode !== 'favicon';
  const showFavicon = settings.tileVisualMode !== 'thumbnail';
  const compactLabels = settings.tileLabelMode === 'compact';
  const contextFocusEnabled = settings.contextMenuFocusMode !== 'off';
  const rootGridDense = rootColumns > 8;
  const folderGridDense = settings.folderViewMode !== 'list' && folderColumns > 8;

  const tileStyle = {
    '--layout-preview-radius': `${tileRadius}px`,
    '--layout-preview-opacity': String(tileOpacity),
    '--layout-preview-opacity-percent': `${Math.round(tileOpacity * 100)}%`,
  } as CSSProperties;

  const renderTile = (index: number, isFolder = false) => {
    const isClone = index % 4 === 2;
    const title = isFolder
      ? (settings.folderViewMode === 'list' ? 'Документы и ссылки' : 'Папка')
      : (compactLabels ? 'Очень длинное название сайта' : 'Сайт');

    return (
      <div
        key={`${isFolder ? 'folder' : 'root'}-${index}`}
        className={`layout-preview-tile ${isFolder ? 'layout-preview-folder' : 'layout-preview-page'} ${isClone ? 'layout-preview-clone' : 'layout-preview-reference'} layout-preview-${settings.tileVisualMode} ${compactLabels ? 'layout-preview-compact-label' : 'layout-preview-full-label'}`}
        style={tileStyle}
      >
        {isFolder ? (
          <>
            {settings.showFolderModeBadge && (
              <span className="layout-preview-mode-badge">
                {isClone ? 'CLONE' : 'REF'}
              </span>
            )}
            {settings.showFolderItemCount && (
              <span className="layout-preview-count-badge">
                {isClone ? 6 : 12}
              </span>
            )}
            <div className="layout-preview-folder-grid">
              {Array.from({ length: 4 }).map((_, cellIndex) => (
                <span key={cellIndex}>{cellIndex === 1 ? 'G' : cellIndex === 2 ? 'Y' : ''}</span>
              ))}
            </div>
          </>
        ) : (
          <>
            {showThumbnail && (
              <div className="layout-preview-thumbnail">
                <span />
                <span />
                <span />
              </div>
            )}
            {showFavicon && (
              <span className={settings.tileVisualMode === 'mixed' ? 'layout-preview-favicon-badge' : 'layout-preview-icon'}>
                {index % 3 === 0 ? 'F' : 'S'}
              </span>
            )}
          </>
        )}
        <span className="layout-preview-title">{title}</span>
      </div>
    );
  };

  return (
    <aside className="layout-live-preview-panel">
      <div className="theme-live-preview-header">
        <div>
          <h3>Живая демонстрация</h3>
          <p>Показывает, как выбранные настройки будут выглядеть на странице.</p>
        </div>
        <span>
          {settings.folderViewMode === 'list' ? 'Список' : 'Сетка'}
        </span>
      </div>

      <div className="layout-live-stage">
        <section className="layout-live-section">
          <div className="layout-live-section-title">
            <strong>Главная</strong>
            <span>{layout.columns} в ряду</span>
          </div>
          <div
            className={`layout-live-grid ${rootGridDense ? 'layout-live-grid-dense' : ''}`}
            style={{
              gap: `${previewGap}px`,
              gridTemplateColumns: `repeat(${rootColumns}, minmax(0, 1fr))`,
            }}
          >
            {rootItems.map((_, index) => renderTile(index, index % 5 === 1 || index % 5 === 4))}
          </div>
        </section>

        <section className="layout-live-section layout-live-folder-section">
          <div className="layout-live-section-title">
            <strong>Открытая папка</strong>
            <span>{settings.folderViewMode === 'list' ? 'список' : `${layout.folderColumns || layout.columns} в ряду`}</span>
          </div>
          <div
            className={`layout-live-folder ${settings.folderViewMode === 'list' ? 'layout-live-folder-list' : 'layout-live-folder-grid'} ${folderGridDense ? 'layout-live-grid-dense' : ''}`}
            style={{
              gap: `${Math.min(previewGap, 14)}px`,
              gridTemplateColumns: settings.folderViewMode === 'list' ? '1fr' : `repeat(${folderColumns}, minmax(0, 1fr))`,
            }}
          >
            {folderItems.map((_, index) => renderTile(index, index % 4 === 1))}
          </div>
        </section>

        <section className={`layout-live-context-demo ${contextFocusEnabled ? 'layout-live-context-demo-active' : ''}`}>
          <div className="layout-live-section-title">
            <strong>ПКМ-фокус</strong>
            <span>
              {settings.contextMenuFocusMode === 'folder-only'
                ? 'только папки'
                : settings.contextMenuFocusMode === 'always'
                  ? 'везде'
                  : 'выключен'}
            </span>
          </div>
          <div className="layout-live-context-row">
            <div className="layout-live-context-tiles">
              <i />
              <i />
              <i />
            </div>
            <div className="layout-live-context-menu">
              <span>Открыть</span>
              <span>Изменить цвет</span>
              <span>Удалить</span>
            </div>
          </div>
        </section>
      </div>

      <div className="theme-live-metrics layout-live-metrics">
        <div>
          <span>Страницы</span>
          <strong>{settings.tileVisualMode === 'thumbnail' ? 'Эскизы' : settings.tileVisualMode === 'favicon' ? 'Иконка сайта' : 'Смешано'}</strong>
        </div>
        <div>
          <span>Подписи</span>
          <strong>{compactLabels ? '2 строки' : 'Полные'}</strong>
        </div>
        <div>
          <span>Радиус</span>
          <strong>{theme.tiles.radius}px</strong>
        </div>
      </div>
    </aside>
  );
}

function WeatherLocationField({
  value,
  onSave,
  onReset,
}: {
  value: string;
  onSave: (location: string) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!focusedRef.current || draft === value) return undefined;
    const timeout = window.setTimeout(() => onSave(draft), 650);
    return () => window.clearTimeout(timeout);
  }, [draft, onSave, value]);

  return (
    <div className="settings-inline-field mt-3 border-t border-white/5 pt-3">
      <span>Локация</span>
      <input
        value={draft}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          onSave(draft);
        }}
        onChange={(event) => setDraft(event.currentTarget.value)}
        placeholder="Авто или город, например Екатеринбург"
      />
      <div className="settings-inline-field-actions">
        <small>Пусто — автоопределение через wttr.in. Виджет открывает прогноз по клику.</small>
        <button
          type="button"
          onClick={() => {
            setDraft('');
            focusedRef.current = false;
            onReset();
          }}
        >
          Сбросить регион
        </button>
      </div>
    </div>
  );
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<Section>('themes');
  const importThemeRef = useRef<HTMLInputElement>(null);
  const importProfileRef = useRef<HTMLInputElement>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const customThemeWallpaperInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [wallpaperPaletteCount, setWallpaperPaletteCount] = useState<3 | 5>(5);
  const [wallpaperPalette, setWallpaperPalette] = useState<string[]>([]);
  const [wallpaperPaletteLoading, setWallpaperPaletteLoading] = useState(false);
  const [wallpaperThemeName, setWallpaperThemeName] = useState('');
  const [customThemesExpanded, setCustomThemesExpanded] = useState(false);
  const [customThemeWallpaperTargetId, setCustomThemeWallpaperTargetId] = useState<string | null>(null);
  const [mediaOptimizationStatus, setMediaOptimizationStatus] = useState<string | null>(null);
  const [profileTransferStatus, setProfileTransferStatus] = useState<string | null>(null);
  const [profileTransferBusy, setProfileTransferBusy] = useState(false);
  const [tileBulkColor, setTileBulkColor] = useState('#8b5cf6');
  const [tileBulkColorStatus, setTileBulkColorStatus] = useState<string | null>(null);

  const { config: layout, setColumns, setFolderColumns, setSpacing } = useLayoutStore();
  const {
    config: bg,
    setMode,
    setGenerativeType,
    setAnimationEnabled,
    setFpsLimit,
    setBlur,
    setBrightness,
    setStaticImage,
  } = useBackgroundStore();
  const {
    settings,
    setShowSearchBar,
    setShowClock,
    setShowWeather,
    setWeatherLocation,
    setWeatherDisplayMode,
    setShowPerformanceMonitor,
    setInfoCardTransparency,
    setShowPopularTabsButton,
    setShowRecentlyClosedTabsButton,
    setOptimizeMediaAssets,
    setBookmarkFolderMode,
    setSearchResultLimit,
    setShowFolderItemCount,
    setShowFolderModeBadge,
    setTileVisualMode,
    setTileLabelMode,
    setFolderViewMode,
    setContextMenuFocusMode,
    setTileOpenTarget,
    resetSettings,
  } = useSettingsStore();
  const {
    activeThemeId,
    customThemes,
    error: themeError,
    previewTheme,
    runtimeTheme,
    setTheme,
    previewThemeDefinition,
    updatePreviewTheme,
    applyPreview,
    cancelPreview,
    importThemeJson,
    exportThemeJson,
    saveCustomTheme,
    deleteCustomTheme,
  } = useThemeStore();
  const {
    applyAccentColorToAllTiles,
    clearAccentColorFromAllTiles,
    optimizeMediaAssets,
    restoreMediaAssets,
  } = useTileStore();
  const cancelPreviewRef = useRef(cancelPreview);

  const themeForEditor = previewTheme || runtimeTheme;
  const [colorDrafts, setColorDrafts] = useState<Record<ThemeColorKey, string>>({
    accent: themeForEditor.colors.accent,
    accent2: themeForEditor.colors.accent2,
    text: themeForEditor.colors.text,
    danger: themeForEditor.colors.danger,
  });

  useEffect(() => {
    setColorDrafts({
      accent: themeForEditor.colors.accent,
      accent2: themeForEditor.colors.accent2,
      text: themeForEditor.colors.text,
      danger: themeForEditor.colors.danger,
    });
  }, [
    themeForEditor.colors.accent,
    themeForEditor.colors.accent2,
    themeForEditor.colors.text,
    themeForEditor.colors.danger,
  ]);

  useEffect(() => {
    const normalizedAccent = normalizeHexColor(themeForEditor.colors.accent);
    if (!normalizedAccent) return;
    setTileBulkColor((current) => (current === '#8b5cf6' ? normalizedAccent : current));
  }, [themeForEditor.colors.accent]);

  const backgroundPreviewBaseStyle: CSSProperties = bg.staticImage
    ? { backgroundImage: `url("${bg.staticImage}")` }
    : {
        background: themeForEditor.background.gradient
          || `radial-gradient(circle at 24% 24%, ${hexToRgba(themeForEditor.colors.accent, 0.56)}, transparent 34%),
              radial-gradient(circle at 76% 34%, ${hexToRgba(themeForEditor.colors.accent2, 0.42)}, transparent 30%),
              linear-gradient(135deg, ${hexToRgba(themeForEditor.colors.accent, 0.18)}, ${hexToRgba(themeForEditor.colors.accent2, 0.14)} 48%, rgba(5, 8, 18, 0.92))`,
      };

  const backgroundPreviewLayerStyle: CSSProperties = {
    ...backgroundPreviewBaseStyle,
    filter: `blur(${bg.blur}px) brightness(${bg.brightness})`,
    transform: bg.blur > 0 ? `scale(${1 + Math.min(0.16, bg.blur / 105)})` : undefined,
  };

  const handleSave = useCallback(async () => {
    if (useThemeStore.getState().previewTheme) {
      await applyPreview();
    }
    onClose();
  }, [applyPreview, onClose]);

  const handleReset = useCallback(async () => {
    await resetSettings();
  }, [resetSettings]);

  const handleOptimizeMediaAssets = useCallback(async () => {
    await setOptimizeMediaAssets(true);
    const result = await optimizeMediaAssets();
    setMediaOptimizationStatus(
      result.optimized > 0
        ? `Оптимизировано изображений: ${result.optimized}. Если что-то не понравится, нажмите откат.`
        : 'Изображений для оптимизации не найдено. Новые загрузки будут сохраняться в оптимизированном формате.'
    );
  }, [optimizeMediaAssets, setOptimizeMediaAssets]);

  const handleRestoreMediaAssets = useCallback(async () => {
    await setOptimizeMediaAssets(false);
    const result = await restoreMediaAssets();
    setMediaOptimizationStatus(
      result.restored > 0
        ? `Откат выполнен. В старый формат возвращено изображений: ${result.restored}.`
        : 'Откатывать нечего: оптимизированных изображений в плитках не найдено.'
    );
  }, [restoreMediaAssets, setOptimizeMediaAssets]);

  const handleApplyTileBulkColor = useCallback(async () => {
    const normalizedColor = normalizeHexColor(tileBulkColor);
    if (!normalizedColor) {
      setTileBulkColorStatus('Введите цвет в формате HEX, например #8b5cf6.');
      return;
    }

    setTileBulkColor(normalizedColor);
    const result = await applyAccentColorToAllTiles(normalizedColor);
    setTileBulkColorStatus(
      result.updated > 0
        ? `Цветовой акцент применён: ${result.updated}.`
        : 'Плиток для изменения пока нет.'
    );
  }, [applyAccentColorToAllTiles, tileBulkColor]);

  const handleClearTileBulkColor = useCallback(async () => {
    const result = await clearAccentColorFromAllTiles();
    setTileBulkColorStatus(
      result.updated > 0
        ? `Цветовой акцент снят: ${result.updated}.`
        : 'Общий цветовой акцент уже не задан.'
    );
  }, [clearAccentColorFromAllTiles]);

  useEffect(() => {
    onCloseRef.current = onClose;
    cancelPreviewRef.current = cancelPreview;
  }, [cancelPreview, onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (useThemeStore.getState().previewTheme) cancelPreviewRef.current();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const timeout = window.setTimeout(() => {
      modalRef.current?.querySelector<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleExportTheme = useCallback(() => {
    const blob = new Blob([exportThemeJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${themeForEditor.name.replace(/[^a-z0-9а-яё_-]+/gi, '-').toLowerCase() || 'theme'}.theme.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [exportThemeJson, themeForEditor.name]);

  const handleImportTheme = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importThemeJson(String(reader.result || ''));
        setActiveSection('themes');
      } catch {
        // The store exposes validation errors in the theme section.
      }
    };
    reader.readAsText(file);
  }, [importThemeJson]);

  const handleExportProfile = useCallback(async () => {
    setProfileTransferBusy(true);
    setProfileTransferStatus(null);
    try {
      const exported = await exportProfileJson();
      const blob = new Blob([exported.json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = exported.filename;
      link.click();
      URL.revokeObjectURL(url);
      setProfileTransferStatus(
        `Профиль сохранён: плиток ${exported.summary.tileCount}, папок ${exported.summary.folderCount}, тем ${exported.summary.customThemeCount}, изображений ${exported.summary.mediaAssetCount}.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось экспортировать профиль.';
      setProfileTransferStatus(message);
    } finally {
      setProfileTransferBusy(false);
    }
  }, []);

  const handleImportProfile = useCallback((file: File) => {
    const accepted = window.confirm(
      'Импорт профиля заменит текущие плитки, папки, тему, фон и настройки. Продолжить?'
    );
    if (!accepted) {
      if (importProfileRef.current) importProfileRef.current.value = '';
      return;
    }

    setProfileTransferBusy(true);
    setProfileTransferStatus(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const summary = await importProfileJson(String(reader.result || ''));
        setProfileTransferStatus(
          `Профиль импортирован: плиток ${summary.tileCount}, папок ${summary.folderCount}, тем ${summary.customThemeCount}, изображений ${summary.mediaAssetCount}.`
        );
        setActiveSection('sync');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Не удалось импортировать профиль.';
        setProfileTransferStatus(message);
      } finally {
        setProfileTransferBusy(false);
        if (importProfileRef.current) importProfileRef.current.value = '';
      }
    };
    reader.onerror = () => {
      setProfileTransferStatus('Не удалось прочитать файл профиля.');
      setProfileTransferBusy(false);
      if (importProfileRef.current) importProfileRef.current.value = '';
    };
    reader.readAsText(file);
  }, []);

  const updateThemeColors = useCallback((colors: Partial<ThemeDefinition['colors']>) => {
    updatePreviewTheme({ colors });
  }, [updatePreviewTheme]);

  const updateThemeColor = useCallback((key: ThemeColorKey, value: string) => {
    const normalized = normalizeHexColor(value);
    const nextValue = normalized || value;
    setColorDrafts((current) => ({ ...current, [key]: nextValue }));
    if (normalized) {
      updateThemeColors({ [key]: normalized } as Partial<ThemeDefinition['colors']>);
    }
  }, [updateThemeColors]);

  const updateThemeGlass = useCallback((glass: Partial<ThemeDefinition['glass']>) => {
    updatePreviewTheme({ glass });
  }, [updatePreviewTheme]);

  const updateThemeTiles = useCallback((tiles: Partial<ThemeDefinition['tiles']>) => {
    updatePreviewTheme({ tiles });
  }, [updatePreviewTheme]);

  const updateThemeLayout = useCallback((layoutUpdates: Partial<ThemeDefinition['layout']>) => {
    updatePreviewTheme({ layout: layoutUpdates });
  }, [updatePreviewTheme]);

  const updateThemeBackground = useCallback((background: Partial<ThemeDefinition['background']>) => {
    updatePreviewTheme({ background });
  }, [updatePreviewTheme]);

  const updateThemeAnimation = useCallback((speed: ThemeDefinition['animation']['speed']) => {
    updatePreviewTheme({ animation: { speed } });
  }, [updatePreviewTheme]);

  const updateQuickSpacing = useCallback((spacing: number) => {
    updateThemeLayout({ spacing });
    void setSpacing(spacing);
  }, [setSpacing, updateThemeLayout]);

  const applyWallpaperPaletteToTheme = useCallback((palette = wallpaperPalette) => {
    if (palette.length === 0) return false;
    const [accent, accent2 = palette[0], surfaceBase = palette[1] || palette[0]] = palette;
    updatePreviewTheme({
      name: themeForEditor.id.startsWith('custom-')
        ? themeForEditor.name
        : `${themeForEditor.name} Adaptive`,
      colors: {
        accent,
        accent2,
        surface: hexToRgba(accent, 0.15),
        surfaceStrong: hexToRgba(surfaceBase, 0.42),
        border: hexToRgba(accent2, 0.26),
        danger: palette[4] || themeForEditor.colors.danger,
        mutedText: 'rgba(248, 250, 252, 0.56)',
      },
      background: { style: 'current' },
    });
    return true;
  }, [themeForEditor.colors.danger, themeForEditor.id, themeForEditor.name, updatePreviewTheme, wallpaperPalette]);

  const saveWallpaperPaletteTheme = useCallback(async () => {
    if (wallpaperPalette.length === 0) return;
    const [accent, accent2 = wallpaperPalette[0], surfaceBase = wallpaperPalette[1] || wallpaperPalette[0]] = wallpaperPalette;
    const fallbackName = `Палитра ${new Date().toLocaleDateString('ru-RU')}`;
    const name = wallpaperThemeName.trim() || fallbackName;
    const theme: ThemeDefinition = {
      ...themeForEditor,
      id: `user-${crypto.randomUUID()}`,
      name,
      colors: {
        ...themeForEditor.colors,
        accent,
        accent2,
        surface: hexToRgba(accent, 0.15),
        surfaceStrong: hexToRgba(surfaceBase, themeForEditor.glass.enabled ? 0.42 : 0.92),
        border: hexToRgba(accent2, 0.26),
        danger: wallpaperPalette[4] || themeForEditor.colors.danger,
        mutedText: 'rgba(248, 250, 252, 0.56)',
      },
      background: {
        style: 'gradient',
        gradient: buildPaletteGradient(wallpaperPalette),
      },
    };

    await saveCustomTheme(theme);
    await setTheme(theme.id);
    setWallpaperThemeName('');
    setActiveSection('themes');
  }, [saveCustomTheme, setTheme, themeForEditor, wallpaperPalette, wallpaperThemeName]);

  const updateCustomThemeBackground = useCallback(async (
    themeId: string,
    background: Partial<ThemeDefinition['background']>
  ) => {
    const theme = customThemes.find((candidate) => candidate.id === themeId);
    if (!theme) return;
    const nextTheme: ThemeDefinition = {
      ...theme,
      background: {
        ...theme.background,
        ...background,
      },
    };
    await saveCustomTheme(nextTheme);
  }, [customThemes, saveCustomTheme]);

  const setCustomThemeGeneratedStatic = useCallback(async (theme: ThemeDefinition) => {
    await updateCustomThemeBackground(theme.id, {
      style: 'gradient',
      gradient: buildPaletteGradient(themeToPalette(theme)),
    });
  }, [updateCustomThemeBackground]);

  const setCustomThemeGeneratedDynamic = useCallback(async (theme: ThemeDefinition) => {
    await updateCustomThemeBackground(theme.id, {
      style: 'generative',
      generatedType: theme.background.generatedType || 'particles',
    });
  }, [updateCustomThemeBackground]);

  const handleCustomThemeWallpaperFile = useCallback((file: File) => {
    const themeId = customThemeWallpaperTargetId;
    if (!themeId) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const image = String(reader.result || '');
      if (!image) return;
      const asset = await saveImageAssetFromDataUrl(image, {
        kind: 'wallpaper',
        maxSide: 1920,
        quality: 0.86,
      });
      await updateCustomThemeBackground(themeId, {
        style: 'static',
        staticImageAssetId: asset.id,
      });
      setCustomThemeWallpaperTargetId(null);
    };
    reader.onerror = () => setCustomThemeWallpaperTargetId(null);
    reader.readAsDataURL(file);
  }, [customThemeWallpaperTargetId, updateCustomThemeBackground]);

  const changeWallpaperPaletteCount = useCallback((nextCount: 3 | 5) => {
    setWallpaperPaletteCount(nextCount);
    if (bg.staticImage) {
      setWallpaperPaletteLoading(true);
      void extractImagePalette(bg.staticImage, nextCount).then((result) => {
        setWallpaperPalette(result.colors);
        setWallpaperPaletteLoading(false);
        if (result.colors.length > 0) applyWallpaperPaletteToTheme(result.colors);
      });
    }
  }, [applyWallpaperPaletteToTheme, bg.staticImage]);

  const handleWallpaperFile = useCallback((file: File) => {
    const reader = new FileReader();
    setWallpaperPaletteLoading(true);
    reader.onload = async () => {
      const image = String(reader.result || '');
      if (!image) {
        setWallpaperPaletteLoading(false);
        return;
      }
      await setMode('static');
      await setStaticImage(image);
      const result = await extractImagePalette(image, wallpaperPaletteCount);
      setWallpaperPalette(result.colors);
      setWallpaperPaletteLoading(false);
      if (result.colors.length > 0) applyWallpaperPaletteToTheme(result.colors);
    };
    reader.onerror = () => setWallpaperPaletteLoading(false);
    reader.readAsDataURL(file);
  }, [applyWallpaperPaletteToTheme, setMode, setStaticImage, wallpaperPaletteCount]);

  const renderContent = () => {
    switch (activeSection) {
      case 'themes':
        return (
          <div className="settings-theme-lab animate-[fadeIn_0.25s_ease-out]">
            <section className="settings-theme-workspace">
              <div className="settings-section-heading">
                <div>
                  <h2>Темы</h2>
                  <p>Пресеты, импорт/экспорт и безопасный редактор внешнего вида.</p>
                </div>
                <div className="settings-theme-actions">
                  <button type="button" onClick={() => importThemeRef.current?.click()}>
                    Импорт
                  </button>
                  <button type="button" onClick={handleExportTheme}>
                    Экспорт
                  </button>
                  <input
                    ref={importThemeRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) handleImportTheme(file);
                      event.currentTarget.value = '';
                    }}
                  />
                  <input
                    ref={customThemeWallpaperInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) handleCustomThemeWallpaperFile(file);
                      event.currentTarget.value = '';
                    }}
                  />
                </div>
              </div>

              {previewTheme && (
                <div className="theme-preview-banner">
                  <div>
                    <strong>Предпросмотр: {previewTheme.name}</strong>
                    <span>Тема применена временно. Сохраните ее или отмените изменения.</span>
                  </div>
                  <div>
                    <button type="button" onClick={cancelPreview}>Отмена</button>
                    <button type="button" onClick={() => void applyPreview()}>Применить</button>
                  </div>
                </div>
              )}

              {themeError && (
                <div className="theme-error-banner">
                  {themeError}
                </div>
              )}

              <div className="settings-theme-card">
                <div className="settings-card-title">
                  <h3>Пресеты</h3>
                  <p>Предпросмотр не сохраняет тему до подтверждения.</p>
                </div>
                <div className="theme-preset-grid">
                  {PRESET_THEMES.map((theme) => {
                    const active = activeThemeId === theme.id && !previewTheme;
                    const previewing = previewTheme?.id === theme.id;
                    return (
                      <article
                        key={theme.id}
                        data-testid="theme-preset-card"
                        data-theme-id={theme.id}
                        className={`theme-preset-card ${active || previewing ? 'theme-preset-card-active' : ''}`}
                      >
                        <div
                          className="theme-preset-swatch"
                          style={{
                            background: theme.background.gradient || `linear-gradient(135deg, ${theme.colors.surfaceStrong}, ${theme.colors.accent}44)`,
                          }}
                        />
                        <div className="theme-preset-info">
                          <div>
                            <h4>{theme.name}</h4>
                            <span>Пресет</span>
                          </div>
                          {active && <b>Активна</b>}
                        </div>
                        <div className="theme-preset-buttons">
                          <button type="button" data-testid="theme-preview-button" onClick={() => previewThemeDefinition(theme)}>
                            Предпросмотр
                          </button>
                          <button type="button" data-testid="theme-apply-button" onClick={() => void setTheme(theme.id)}>
                            Применить
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>

              {customThemes.length > 0 && (
                <div className="settings-theme-card">
                  <div className="settings-card-title">
                    <h3>Пользовательские темы</h3>
                    <p>Сохранённые палитры, импортированные темы и ваши собственные варианты. Первые две видны сразу, остальные раскрываются списком.</p>
                  </div>
                  <div className="theme-preset-grid">
                    {(customThemesExpanded ? customThemes : customThemes.slice(0, 2)).map((theme) => {
                      const active = activeThemeId === theme.id && !previewTheme;
                      const previewing = previewTheme?.id === theme.id;
                      const backgroundLabel = theme.background.style === 'static'
                        ? 'Свои обои'
                        : theme.background.style === 'generative'
                          ? 'Динамический фон'
                          : 'Сгенерированная статика';
                      return (
                        <article
                          key={theme.id}
                          data-testid="theme-preset-card"
                          data-theme-id={theme.id}
                          className={`theme-preset-card ${active || previewing ? 'theme-preset-card-active' : ''}`}
                        >
                          <div
                            className="theme-preset-swatch"
                            style={{
                              background: theme.background.gradient || `linear-gradient(135deg, ${theme.colors.surfaceStrong}, ${theme.colors.accent}44)`,
                            }}
                          />
                          <div className="theme-preset-info">
                            <div>
                              <h4>{theme.name}</h4>
                              <span>{backgroundLabel}</span>
                            </div>
                            {active && <b>Активна</b>}
                          </div>
                          <div className="theme-preset-buttons">
                            <button type="button" data-testid="theme-preview-button" onClick={() => previewThemeDefinition(theme)}>
                              Предпросмотр
                            </button>
                            <button type="button" data-testid="theme-apply-button" onClick={() => void setTheme(theme.id)}>
                              Применить
                            </button>
                          </div>
                          <div className="theme-custom-actions">
                            <span>Фон темы</span>
                            <div>
                              <button
                                type="button"
                                className={theme.background.style === 'gradient' ? 'theme-custom-action-active' : ''}
                                onClick={() => void setCustomThemeGeneratedStatic(theme)}
                              >
                                Статика
                              </button>
                              <button
                                type="button"
                                className={theme.background.style === 'generative' ? 'theme-custom-action-active' : ''}
                                onClick={() => void setCustomThemeGeneratedDynamic(theme)}
                              >
                                Динамика
                              </button>
                              <button
                                type="button"
                                className={theme.background.style === 'static' ? 'theme-custom-action-active' : ''}
                                onClick={() => {
                                  setCustomThemeWallpaperTargetId(theme.id);
                                  customThemeWallpaperInputRef.current?.click();
                                }}
                              >
                                Свои обои
                              </button>
                            </div>
                            <button
                              type="button"
                              className="theme-custom-delete"
                              onClick={() => void deleteCustomTheme(theme.id)}
                            >
                              Удалить тему
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {customThemes.length > 2 && (
                    <button
                      type="button"
                      className="theme-custom-expand"
                      onClick={() => setCustomThemesExpanded((value) => !value)}
                    >
                      {customThemesExpanded ? 'Свернуть пользовательские темы' : `Показать все пользовательские темы (${customThemes.length})`}
                    </button>
                  )}
                </div>
              )}

              <div className="settings-theme-card">
                <div className="settings-card-title">
                  <h3>Редактор темы</h3>
                  <p>Шрифт интерфейса использует системные настройки браузера.</p>
                </div>

                <label className="theme-editor-field theme-editor-field-wide">
                  <span>Название темы</span>
                  <input
                    value={themeForEditor.name}
                    onChange={(event) => updatePreviewTheme({ name: event.target.value })}
                    placeholder="Моя тема"
                  />
                </label>

                <div className="theme-editor-grid">
                  {([
                    ['Акцент', 'accent'],
                    ['Второй акцент', 'accent2'],
                    ['Текст', 'text'],
                    ['Опасные действия', 'danger'],
                  ] satisfies Array<[string, ThemeColorKey]>).map(([label, key]) => {
                    const colorValue = themeForEditor.colors[key].startsWith('#')
                      ? themeForEditor.colors[key].slice(0, 7)
                      : '#8b5cf6';
                    const updateColor = (value: string) => {
                      updateThemeColor(key, value);
                    };

                    return (
                      <div key={key} className="theme-editor-field">
                        <span>{label}</span>
                        <div className="theme-color-input">
                          <span className="theme-color-picker" style={{ background: colorValue }}>
                            <input
                              type="color"
                              value={colorValue}
                              onInput={(event) => updateColor(event.currentTarget.value)}
                              onChange={(event) => updateColor(event.currentTarget.value)}
                            />
                          </span>
                          <input
                            className="theme-color-hex-input"
                            value={colorDrafts[key]}
                            spellCheck={false}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setColorDrafts((current) => ({ ...current, [key]: value }));
                              const normalized = normalizeHexColor(value);
                              if (normalized) updateColor(normalized);
                            }}
                            onBlur={() => {
                              const normalized = normalizeHexColor(colorDrafts[key]);
                              if (normalized) updateColor(normalized);
                              else setColorDrafts((current) => ({ ...current, [key]: themeForEditor.colors[key] }));
                            }}
                          />
                        </div>
                        <div className="theme-color-presets" aria-label={`${label}: быстрые цвета`}>
                          {themeColorPresets[key].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              title={preset}
                              aria-label={`${label} ${preset}`}
                              className={normalizeHexColor(colorValue) === preset ? 'theme-color-preset theme-color-preset-active' : 'theme-color-preset'}
                              style={{ background: preset }}
                              onClick={() => updateColor(preset)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="theme-editor-section">
                  <ToggleSwitch
                    label="Эффект стекла"
                    description="Настройка стеклянного эффекта интерфейса"
                    checked={themeForEditor.glass.enabled}
                    onChange={(enabled) => updateThemeGlass({ enabled })}
                  />
                  <SliderControl
                    label="Размытие стекла"
                    value={themeForEditor.glass.blur}
                    min={0}
                    max={40}
                    unit="px"
                    onChange={(blur) => updateThemeGlass({ blur })}
                  />
                  <SliderControl
                    label="Прозрачность стекла"
                    value={themeForEditor.glass.opacity}
                    min={0.2}
                    max={1}
                    step={0.05}
                    valueFormatter={(value) => `${Math.round(value * 100)}%`}
                    onChange={(opacity) => updateThemeGlass({ opacity })}
                  />
                  <SliderControl
                    label="Насыщенность стекла"
                    value={themeForEditor.glass.saturation}
                    min={80}
                    max={220}
                    unit="%"
                    onChange={(saturation) => updateThemeGlass({ saturation })}
                  />
                </div>

                <div className="theme-editor-section">
                  <SliderControl
                    label="Скругление углов плиток"
                    value={themeForEditor.tiles.radius}
                    min={0}
                    max={96}
                    unit="px"
                    onChange={(radius) => updateThemeTiles({ radius })}
                  />
                  <SliderControl
                    label="Прозрачность плиток"
                    value={1 - themeForEditor.tiles.opacity}
                    min={0}
                    max={1}
                    step={0.05}
                    valueFormatter={(value) => `${Math.round(value * 100)}%`}
                    onChange={(transparency) => updateThemeTiles({ opacity: 1 - transparency })}
                  />
                  <SettingsDropdown
                    label="Стиль тени"
                    value={themeForEditor.tiles.shadow}
                    options={[
                      { value: 'none', label: shadowLabels.none },
                      { value: 'soft', label: shadowLabels.soft },
                      { value: 'deep', label: shadowLabels.deep },
                      { value: 'floating', label: shadowLabels.floating },
                    ]}
                    onChange={(value) => updateThemeTiles({ shadow: value as ThemeShadowPreset })}
                  />
                  <SliderControl
                    label="Увеличение при наведении"
                    value={themeForEditor.tiles.hoverScale}
                    min={1}
                    max={1.08}
                    step={0.005}
                    valueFormatter={(value) => `${value.toFixed(3)}x`}
                    onChange={(hoverScale) => updateThemeTiles({ hoverScale })}
                  />
                  <SliderControl
                    label="Расстояние между плитками"
                    value={themeForEditor.layout.spacing}
                    min={4}
                    max={40}
                    unit="px"
                    onChange={(spacing) => updateThemeLayout({ spacing })}
                  />
                </div>

                <div className="theme-editor-section">
                  <SettingsDropdown
                    label="Стиль фона"
                    value={themeForEditor.background.style}
                    options={[
                      { value: 'current', label: backgroundLabels.current },
                      { value: 'gradient', label: backgroundLabels.gradient },
                      { value: 'generative', label: backgroundLabels.generative },
                      { value: 'static', label: backgroundLabels.static },
                    ]}
                    onChange={(value) => updateThemeBackground({ style: value as ThemeDefinition['background']['style'] })}
                    description="Градиент темы виден в демонстрации и может стать фоном страницы."
                  />
                  {themeForEditor.background.style === 'gradient' && (
                    <label className="theme-editor-field theme-editor-field-wide">
                      <span>CSS-градиент</span>
                      <textarea
                        value={themeForEditor.background.gradient || ''}
                        onChange={(event) => updateThemeBackground({ gradient: event.target.value })}
                        placeholder="linear-gradient(135deg, #020617, #1e1b4b)"
                      />
                    </label>
                  )}

                  <SettingsDropdown
                    label="Скорость анимаций"
                    value={themeForEditor.animation.speed}
                    options={[
                      { value: 'reduced', label: animationLabels.reduced },
                      { value: 'normal', label: animationLabels.normal },
                      { value: 'expressive', label: animationLabels.expressive },
                    ]}
                    onChange={(value) => updateThemeAnimation(value as ThemeDefinition['animation']['speed'])}
                  />

                  <SettingsDropdown
                    label="Шрифт"
                    value={themeForEditor.font.family}
                    options={[
                      { value: 'system', label: 'Системный' },
                    ]}
                    onChange={() => undefined}
                    description="Шрифт интерфейса использует системные настройки браузера."
                  />
                </div>

                <div className="theme-validation-note">
                  FASP проверит тему перед применением и сохранит текущую, если файл не подходит.
                </div>
              </div>
            </section>

            <ThemeLivePreview theme={themeForEditor} />
          </div>
        );

      case 'layout':
        return (
          <div className="settings-layout-lab animate-[fadeIn_0.25s_ease-out]">
            <section className="settings-layout-workspace">
              <div className="settings-section-heading">
                <div>
                  <h2>Плитки и макет</h2>
                  <p>Размер, плотность сетки, подписи и поведение открытых папок.</p>
                </div>
              </div>

              <div className="settings-layout-controls">
                <SliderControl
                  label="Количество плиток в одном ряду"
                  value={layout.columns}
                  min={2}
                  max={12}
                  onChange={setColumns}
                />

                <SliderControl
                  label="Количество плиток в ряду внутри папок"
                  value={layout.folderColumns || layout.columns}
                  min={2}
                  max={12}
                  onChange={setFolderColumns}
                />

                <SliderControl
                  label="Отступ между плитками"
                  value={themeForEditor.layout.spacing}
                  min={4}
                  max={40}
                  unit="px"
                  onChange={updateQuickSpacing}
                />

                <SettingsDropdown
                  label="Отображение страниц"
                  value={settings.tileVisualMode}
                  options={[
                    { value: 'mixed', label: 'Смешанное' },
                    { value: 'favicon', label: 'Иконка сайта' },
                    { value: 'thumbnail', label: 'Эскизы' },
                  ]}
                  onChange={(value) => setTileVisualMode(value as typeof settings.tileVisualMode)}
                  description="Смешанный режим показывает эскиз страницы и маленькую иконку сайта. Режим иконки оставляет только значок сайта."
                />

                <SettingsDropdown
                  label="Подписи плиток"
                  value={settings.tileLabelMode}
                  options={[
                    { value: 'compact', label: 'Компактно - до 2 строк' },
                    { value: 'full', label: 'Полное название' },
                  ]}
                  onChange={(value) => setTileLabelMode(value as typeof settings.tileLabelMode)}
                  description="Выбор полного или укороченного отображения названия страницы"
                />

                <SettingsDropdown
                  label="Вид открытой папки"
                  value={settings.folderViewMode}
                  options={[
                    { value: 'grid', label: 'Сетка' },
                    { value: 'list', label: 'Список' },
                  ]}
                  onChange={(value) => setFolderViewMode(value as typeof settings.folderViewMode)}
                  description="Список удобен для папок с длинными названиями. Функционал остаётся тем же."
                />

                <SettingsDropdown
                  label="Фокус при контекстном меню"
                  value={settings.contextMenuFocusMode}
                  options={[
                    { value: 'folder-only', label: 'Только в папках' },
                    { value: 'always', label: 'Всегда' },
                    { value: 'off', label: 'Отключено' },
                  ]}
                  onChange={(value) => setContextMenuFocusMode(value as typeof settings.contextMenuFocusMode)}
                  description="Скрывает остальные плитки и содержимое выбранной плитки, пока открыто контекстное меню."
                />

                <SettingsDropdown
                  label="Открывать страницы"
                  value={settings.tileOpenTarget}
                  options={[
                    { value: 'current-tab', label: 'В этой вкладке' },
                    { value: 'new-tab', label: 'В новой вкладке' },
                    { value: 'new-window', label: 'В новом окне' },
                  ]}
                  onChange={(value) => setTileOpenTarget(value as typeof settings.tileOpenTarget)}
                  description="Выберите, где открывать страницы с главного экрана. Плитки с контейнером откроются в выбранном контейнере."
                />

                <section className="settings-theme-card settings-layout-card">
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-sm font-bold text-white/85">Цвет всех плиток</h3>
                      <p className="mt-1 text-xs leading-relaxed text-white/38">
                        Применяет общий цветовой акцент ко всем плиткам и папкам, не удаляя изображения.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex w-full min-w-[220px] items-center gap-3 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2">
                        <input
                          type="color"
                          value={tileBulkColor}
                          onChange={(event) => setTileBulkColor(event.currentTarget.value)}
                          className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0"
                          aria-label="Цвет всех плиток"
                        />
                        <input
                          type="text"
                          data-testid="tile-bulk-color-input"
                          value={tileBulkColor}
                          onChange={(event) => setTileBulkColor(event.currentTarget.value)}
                          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-white outline-none"
                          aria-label="HEX цвет всех плиток"
                        />
                      </label>
                      <button
                        type="button"
                        data-testid="tile-bulk-color-apply"
                        onClick={() => void handleApplyTileBulkColor()}
                        className="rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200"
                        style={{
                          background: 'linear-gradient(135deg, var(--fasp-accent), color-mix(in srgb, var(--fasp-accent-2) 38%, var(--fasp-accent)))',
                          color: 'var(--fasp-on-accent)',
                          boxShadow: '0 10px 24px color-mix(in srgb, var(--fasp-accent) 22%, transparent)',
                        }}
                      >
                        Применить ко всем
                      </button>
                      <button
                        type="button"
                        data-testid="tile-bulk-color-clear"
                        onClick={() => void handleClearTileBulkColor()}
                        className="rounded-xl border border-white/10 bg-white/[0.055] px-4 py-2 text-sm font-semibold text-white/68 transition-colors hover:bg-white/[0.09] hover:text-white"
                      >
                        Сбросить
                      </button>
                    </div>
                    {tileBulkColorStatus && (
                      <p className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/56">
                        {tileBulkColorStatus}
                      </p>
                    )}
                  </div>
                </section>

                <section className="settings-theme-card settings-layout-card">
                  <div className="space-y-3">
                    <ToggleSwitch
                      label="Количество элементов в папке"
                      description="Показывает маленький счетчик вложенных элементов в углу папки."
                      checked={settings.showFolderItemCount}
                      onChange={setShowFolderItemCount}
                    />
                    <div className="border-t border-white/5 pt-3">
                      <ToggleSwitch
                        label="Режим папки REF / CLONE"
                        description="Показывает бейдж режима для папок из Избранного."
                        checked={settings.showFolderModeBadge}
                        onChange={setShowFolderModeBadge}
                      />
                    </div>
                  </div>
                </section>

                <SettingsDropdown
                  label="Режим папок из Избранного"
                  value={settings.bookmarkFolderMode}
                  options={[
                    { value: 'reference', label: 'Ссылка - изменения затронут оригинальную папку' },
                    { value: 'clone', label: 'Копия - изменения не влияют на оригинальную папку' },
                  ]}
                  onChange={(v) => setBookmarkFolderMode(v as typeof settings.bookmarkFolderMode)}
                  description="Режим по умолчанию для новых папок из Избранного. Уже добавленные папки сохраняют свой режим."
                />
              </div>
            </section>

            <LayoutLivePreview
              layout={layout}
              settings={settings}
              theme={themeForEditor}
            />
          </div>
        );

      case 'background':
        return (
          <div className="animate-[fadeIn_0.25s ease-out] space-y-3">
            <h2 className="text-lg font-bold text-white">Фон</h2>
            <p className="text-sm text-white/40">Выберите и настройте фоновое изображение</p>

            <SettingsDropdown
              label="Режим"
              value={bg.mode}
              options={[
                { value: 'generative', label: 'Генеративный' },
                { value: 'static', label: 'Свои обои' },
              ]}
              onChange={(v) => setMode(v as typeof bg.mode)}
              description="Генеративный — алгоритмический фон. Свои обои — локальное изображение без сервера."
            />

            {bg.mode === 'generative' && (
              <>
                <SettingsDropdown
                  label="Тип генерации"
                  value={bg.generativeType || 'perlin'}
                  options={[
                    { value: 'perlin', label: 'Шумовые волны' },
                    { value: 'particles', label: 'Поле частиц' },
                    { value: 'fractal-flow', label: 'Фрактальный поток' },
                    { value: 'aurora', label: 'Северное сияние' },
                    { value: 'plasma', label: 'Плазменные волны' },
                    { value: 'julia', label: 'Julia Fractal' },
                    { value: 'automata', label: 'Cellular Matrix' },
                    { value: 'reaction-diffusion', label: 'Reaction Field' },
                  ]}
                  onChange={(v) => setGenerativeType(v as typeof bg.generativeType)}
                />

                <ToggleSwitch
                  label="Анимация"
                  description="Анимированный генеративный фон"
                  checked={bg.animationEnabled}
                  onChange={setAnimationEnabled}
                />

                <SliderControl
                  label="Кадров в секунду"
                  value={bg.fpsLimit}
                  min={1}
                  max={60}
                  onChange={setFpsLimit}
                />
              </>
            )}

            {bg.mode === 'static' && (
              <section className="wallpaper-panel">
                <div className="wallpaper-preview">
                  <div className="wallpaper-preview-layer" style={backgroundPreviewLayerStyle} />
                  {!bg.staticImage && <span>Обои не выбраны</span>}
                </div>
                <div className="wallpaper-controls">
                  <div>
                    <h3>Свои обои</h3>
                    <p>Изображение хранится локально. После загрузки FASP извлечет палитру и подберет акценты темы.</p>
                  </div>
                  <div className="wallpaper-actions">
                    <button type="button" onClick={() => wallpaperInputRef.current?.click()}>
                      Выбрать файл
                    </button>
                    {bg.staticImage && (
                      <button
                        type="button"
                        onClick={() => {
                          void setStaticImage('');
                          setWallpaperPalette([]);
                        }}
                      >
                        Очистить
                      </button>
                    )}
                  </div>
                  <input
                    ref={wallpaperInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) handleWallpaperFile(file);
                      event.currentTarget.value = '';
                    }}
                  />

                  <div className="wallpaper-count-control">
                    <div>
                      <span>Количество цветов палитры</span>
                      <p>Используется для адаптивных акцентов темы.</p>
                    </div>
                    <div role="group" aria-label="Количество цветов палитры">
                      {[3, 5].map((count) => (
                        <button
                          key={count}
                          type="button"
                          className={wallpaperPaletteCount === count ? 'wallpaper-count-active' : ''}
                          onClick={() => changeWallpaperPaletteCount(count as 3 | 5)}
                        >
                          {count} цвета
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="wallpaper-palette">
                    {wallpaperPaletteLoading && <span>Анализ изображения...</span>}
                    {!wallpaperPaletteLoading && wallpaperPalette.length === 0 && <span>Палитра появится после выбора изображения.</span>}
                    {!wallpaperPaletteLoading && wallpaperPalette.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={color}
                        title={color}
                        style={{ background: color }}
                        onClick={() => updateThemeColors({ accent: color })}
                      />
                    ))}
                  </div>

                  {wallpaperPalette.length > 0 && (
                    <div className="wallpaper-theme-save">
                      <label>
                        <span>Название пользовательской темы</span>
                        <input
                          value={wallpaperThemeName}
                          onChange={(event) => setWallpaperThemeName(event.currentTarget.value)}
                          placeholder="Например, Осеннее стекло"
                        />
                      </label>
                      <button
                        type="button"
                        className="wallpaper-apply-theme"
                        onClick={() => void saveWallpaperPaletteTheme()}
                      >
                        Сохранить палитру как тему
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}

            <div className="border-t border-white/5 pt-3">
              <SliderControl
                label="Размытие"
                value={bg.blur}
                min={0}
                max={20}
                unit="px"
                onChange={setBlur}
              />

              <SliderControl
                label="Яркость"
                value={bg.brightness}
                min={0.1}
                max={3}
                step={0.1}
                valueFormatter={(v) => `${Math.round(v * 100)}%`}
                onChange={setBrightness}
              />
            </div>
          </div>
        );

      case 'widgets':
        return (
          <div className="animate-[fadeIn_0.25s_ease-out] space-y-3">
            <h2 className="text-lg font-bold text-white">Виджеты</h2>
            <p className="text-sm text-white/40">Включите или отключите виджеты на главном экране</p>

            <div className="space-y-3">
              <section className="rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3">
                <ToggleSwitch
                  label="Поисковая строка"
                  description="Поиск по закладкам и открытым вкладкам"
                  checked={settings.showSearchBar}
                  onChange={setShowSearchBar}
                />

                {settings.showSearchBar && (
                  <div className="mt-3 border-t border-white/5 pt-3">
                    <SliderControl
                      label="Ширина поисковой строки"
                      value={settings.searchBarWidth ?? 60}
                      min={20}
                      max={100}
                      unit="%"
                      onChange={(v) => {
                        if (typeof useSettingsStore !== 'undefined') {
                          useSettingsStore.getState().setSearchBarWidth(v);
                        }
                      }}
                    />
                    <SliderControl
                      label="Количество результатов поиска"
                      value={settings.searchResultLimit ?? 50}
                      min={5}
                      max={100}
                      step={5}
                      valueFormatter={(value) => `${value} элементов`}
                      onChange={setSearchResultLimit}
                    />
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3">
                <ToggleSwitch
                  label="Часы"
                  description="Виджет часов с датой"
                  checked={settings.showClock}
                  onChange={setShowClock}
                />
              </section>

              <section className="rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3">
                <ToggleSwitch
                  label="Погода"
                  description="Текущая погода в вашем регионе"
                  checked={settings.showWeather}
                  onChange={setShowWeather}
                />
                {settings.showWeather && (
                  <div className="mt-3 border-t border-white/5 pt-3">
                    <SettingsDropdown
                      label="Тип отображения"
                      value={settings.weatherDisplayMode}
                      options={[
                        { value: 'inline', label: 'Строка' },
                        { value: 'card', label: 'Информационная панель' },
                      ]}
                      onChange={(value) => setWeatherDisplayMode(value as typeof settings.weatherDisplayMode)}
                      description="Строка занимает минимум места. Информационная панель показывает город, температуру и крупную иконку."
                    />
                    <WeatherLocationField
                      value={settings.weatherLocation}
                      onSave={(location) => void setWeatherLocation(location)}
                      onReset={() => void setWeatherLocation('')}
                    />
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3">
                <ToggleSwitch
                  label="Монитор производительности"
                  description="Показывает FPS, время кадра, оценку нагрузки main thread и доступную память"
                  checked={settings.showPerformanceMonitor}
                  onChange={setShowPerformanceMonitor}
                />
              </section>

              <section className="rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3">
                <SliderControl
                  label="Прозрачность фона информеров"
                  value={settings.infoCardTransparency ?? 0.32}
                  min={0}
                  max={1}
                  step={0.05}
                  valueFormatter={(value) => `${Math.round(value * 100)}%`}
                  onChange={setInfoCardTransparency}
                />
                <p className="mt-1 text-xs text-white/35">
                  Управляет фоном нижних информеров погоды и производительности. 100% оставляет только текст и символы.
                </p>
              </section>
            </div>
          </div>
        );

      case 'sync':
        return (
          <div className="animate-[fadeIn_0.25s ease-out] space-y-3">
            <h2 className="text-lg font-bold text-white">Синхронизация</h2>
            <p className="text-sm text-white/40">Перенос профиля между устройствами и резервные копии.</p>

            <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <div className="mb-4 flex items-start gap-3">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white"
                  style={{ background: 'linear-gradient(135deg, var(--fasp-accent), var(--fasp-accent-2))' }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M7 3h7l4 4v14H7V3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    <path d="M9.5 13h5M9.5 17h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white/85">Профиль стартовой страницы</h3>
                  <p className="mt-1 text-xs leading-relaxed text-white/42">
                    В профиль входят тема, сохранённые обои, плитки, папки, порядок на главной странице, макет и настройки.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  data-testid="profile-export-button"
                  onClick={() => void handleExportProfile()}
                  disabled={profileTransferBusy}
                  className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200 disabled:cursor-wait disabled:opacity-55"
                  style={{
                    background: 'linear-gradient(135deg, var(--fasp-accent), color-mix(in srgb, var(--fasp-accent-2) 38%, var(--fasp-accent)))',
                    color: 'var(--fasp-on-accent)',
                    boxShadow: '0 10px 26px color-mix(in srgb, var(--fasp-accent) 24%, transparent)',
                  }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 3v11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="m7.5 9.5 4.5 4.5 4.5-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M5 19h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Экспортировать профиль
                </button>
                <button
                  type="button"
                  data-testid="profile-import-button"
                  onClick={() => importProfileRef.current?.click()}
                  disabled={profileTransferBusy}
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-4 py-3 text-sm font-semibold text-white/72 transition-all duration-200 hover:bg-white/[0.09] hover:text-white disabled:cursor-wait disabled:opacity-55"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 21V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="m7.5 14.5 4.5-4.5 4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M5 5h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Импортировать профиль
                </button>
              </div>

              <input
                ref={importProfileRef}
                data-testid="profile-import-input"
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) handleImportProfile(file);
                }}
              />

              {profileTransferStatus && (
                <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs leading-relaxed text-white/60">
                  {profileTransferStatus}
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-start gap-3 text-white/36">
                <svg width="34" height="34" viewBox="0 0 48 48" fill="none" className="shrink-0 opacity-70" aria-hidden="true">
                  <path d="M38 22a14 14 0 0 0-27-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M10 26a14 14 0 0 0 27 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M6 14v8h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M42 34v-8h-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p className="text-sm leading-relaxed">
                  Автоматическая синхронизация через Firefox Sync и облачные сервисы будет добавлена позже.
                  Сейчас профиль можно перенести вручную одним файлом.
                </p>
              </div>
            </section>
          </div>
        );

      case 'advanced':
        return (
          <div className="animate-[fadeIn_0.25s ease-out] space-y-3">
            <h2 className="text-lg font-bold text-white">Дополнительно</h2>
            <p className="text-sm text-white/40">Экспериментальные и продвинутые настройки</p>

            <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <div className="mb-3">
                <h3 className="text-sm font-bold text-white/85">Быстрые кнопки</h3>
                <p className="mt-1 text-xs text-white/38">Прозрачные кнопки на главной странице для системных списков Firefox.</p>
              </div>
              <div className="space-y-3">
                <ToggleSwitch
                  label="Популярные вкладки"
                  description="Показывает кнопку со списком часто посещаемых страниц."
                  checked={settings.showPopularTabsButton}
                  onChange={setShowPopularTabsButton}
                />
                <div className="border-t border-white/5 pt-3">
                  <ToggleSwitch
                    label="Недавно закрытые вкладки"
                    description="Показывает кнопку со списком недавно закрытых вкладок."
                    checked={settings.showRecentlyClosedTabsButton}
                    onChange={setShowRecentlyClosedTabsButton}
                  />
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <ToggleSwitch
                label="Оптимизация пользовательских изображений"
                description="Новые изображения будут автоматически оптимизироваться, чтобы расширение работало быстрее и занимало меньше места."
                checked={settings.optimizeMediaAssets}
                onChange={setOptimizeMediaAssets}
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void handleOptimizeMediaAssets()}
                  className="rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200"
                  style={{
                    background: 'linear-gradient(135deg, var(--fasp-accent), color-mix(in srgb, var(--fasp-accent-2) 38%, var(--fasp-accent)))',
                    color: 'var(--fasp-on-accent)',
                    boxShadow: '0 10px 26px color-mix(in srgb, var(--fasp-accent) 24%, transparent)',
                  }}
                >
                  Оптимизировать существующие
                </button>
                <button
                  type="button"
                  onClick={() => void handleRestoreMediaAssets()}
                  className="rounded-xl border border-white/10 bg-white/[0.055] px-4 py-3 text-sm font-semibold text-white/72 transition-all duration-200 hover:bg-white/[0.09] hover:text-white"
                >
                  Вернуть старый формат
                </button>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-white/38">
                Восстанавливает прежний формат хранения изображений плиток.
              </p>
              {mediaOptimizationStatus && (
                <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/60">
                  {mediaOptimizationStatus}
                </p>
              )}
            </section>

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-center">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="mx-auto mb-3 opacity-30">
                <circle cx="14" cy="8" r="4" fill="currentColor" />
                <circle cx="34" cy="8" r="4" fill="currentColor" />
                <circle cx="14" cy="24" r="4" fill="currentColor" />
                <circle cx="34" cy="24" r="4" fill="currentColor" />
                <circle cx="14" cy="40" r="4" fill="currentColor" />
                <circle cx="34" cy="40" r="4" fill="currentColor" />
                <path d="M18 8h12" stroke="currentColor" strokeWidth="1.5" />
                <path d="M18 24h12" stroke="currentColor" strokeWidth="1.5" />
                <path d="M18 40h12" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <p className="text-sm text-white/30">
                CSS Injection, горячие клавиши (Alt+1…Alt+9), локальный поиск по плиткам
                и сессионные группы будут добавлены в ближайших обновлениях.
              </p>
            </div>
          </div>
        );

      case 'about':
        return (
          <div className="animate-[fadeIn_0.25s ease-out] space-y-3">
            <h2 className="text-lg font-bold text-white">О программе</h2>

            <div className="settings-about-card rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl"
                  style={{ background: 'linear-gradient(135deg, var(--fasp-accent), var(--fasp-accent-2))' }}>
                  F
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Adaptive Start Page</h3>
                  <p className="text-sm text-white/40">Версия 0.1.5</p>
                </div>
              </div>
              <p className="text-sm text-white/50 leading-relaxed">
                Полностью настраиваемая стартовая страница с плитками быстрого доступа,
                генеративными фонами, интеграцией с закладками и синхронизацией между устройствами.
              </p>
              <div className="mt-4 space-y-1.5 text-xs text-white/30">
                <p>Стек: React 19 + TypeScript + Vite + TailwindCSS 4 + Zustand</p>
                <p>Лицензия: MIT</p>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="settings-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md animate-[fadeIn_0.2s_ease-out]">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-testid="settings-modal"
        className="
          settings-modal-shell w-[min(1720px,calc(100vw-24px))] max-h-[min(980px,calc(100vh-24px))] h-[92vh] rounded-3xl
          flex shadow-2xl shadow-black/60
          glass-strong
          overflow-hidden
          animate-[scaleIn_0.25s_ease-out]
        "
      >
        {/* Left sidebar */}
        <aside className="settings-modal-sidebar w-56 shrink-0 border-r border-white/5 flex flex-col bg-white/[0.02]">
          <SettingsSidebar activeSection={activeSection} onSelect={setActiveSection} />
        </aside>

        {/* Right content area */}
        <main className="settings-modal-main flex-1 flex flex-col min-h-0">
          <div className="settings-modal-content flex-1 overflow-y-auto px-8 py-6">
            {renderContent()}
          </div>

          {/* Footer with action buttons */}
          <footer className="settings-modal-footer shrink-0 flex items-center justify-between px-8 py-4 border-t border-white/5 bg-white/[0.01]">
            <button
              type="button"
              onClick={handleReset}
              className="
                px-4 py-2 rounded-xl text-sm font-medium
                text-white/30 hover:text-red-400 hover:bg-red-400/5
                transition-all duration-200
              "
            >
              Сбросить настройки
            </button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (useThemeStore.getState().previewTheme) cancelPreview();
                  onClose();
                }}
                className="
                  px-5 py-2 rounded-xl text-sm font-medium
                  text-white/50 hover:text-white/80
                  bg-white/5 hover:bg-white/10
                  border border-white/5 hover:border-white/10
                  transition-all duration-200
                "
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="
                  px-5 py-2 rounded-xl text-sm font-semibold text-white
                  transition-all duration-200
                "
                style={{
                  background: 'linear-gradient(135deg, var(--fasp-accent), color-mix(in srgb, var(--fasp-accent-2) 38%, var(--fasp-accent)))',
                  color: 'var(--fasp-on-accent)',
                  boxShadow: '0 6px 22px color-mix(in srgb, var(--fasp-accent) 34%, transparent)',
                }}
              >
                Сохранить настройки
              </button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
