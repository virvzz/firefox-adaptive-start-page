import { create } from 'zustand';
import type { ThemeDefinition, ThemeShadowPreset } from '../../types';
import { logStartupDebug } from '../../debug/startupDebug';

const STORAGE_KEY = 'fasp-theme-engine';
const THEME_SCHEMA_VERSION = 1;
const THEME_ENGINE_VERSION = '1.0.0';
const DEFAULT_THEME_ID = 'fasp-default';

type ThemeInput = Partial<ThemeDefinition> & Record<string, unknown>;
type ThemeUpdate = Omit<Partial<ThemeDefinition>, 'colors' | 'glass' | 'tiles' | 'layout' | 'background' | 'animation'> & {
  colors?: Partial<ThemeDefinition['colors']>;
  glass?: Partial<ThemeDefinition['glass']>;
  tiles?: Partial<ThemeDefinition['tiles']>;
  layout?: Partial<ThemeDefinition['layout']>;
  background?: Partial<ThemeDefinition['background']>;
  animation?: Partial<ThemeDefinition['animation']>;
};

interface PersistedThemeState {
  schemaVersion: 1;
  activeThemeId: string;
  customThemes: ThemeDefinition[];
}

interface ThemeState {
  activeThemeId: string;
  customThemes: ThemeDefinition[];
  previewTheme: ThemeDefinition | null;
  activeTheme: ThemeDefinition;
  runtimeTheme: ThemeDefinition;
  error: string | null;

  loadTheme: () => Promise<void>;
  setTheme: (id: string) => Promise<void>;
  previewThemeDefinition: (theme: unknown) => ThemeDefinition;
  updatePreviewTheme: (updates: ThemeUpdate) => void;
  applyPreview: () => Promise<void>;
  cancelPreview: () => void;
  importThemeJson: (raw: string) => ThemeDefinition;
  exportThemeJson: (id?: string) => string;
  saveCustomTheme: (theme: ThemeDefinition) => Promise<void>;
  deleteCustomTheme: (id: string) => Promise<void>;
}

const shadowValues: Record<ThemeShadowPreset, string> = {
  none: 'none',
  soft: '0 14px 34px rgba(0, 0, 0, 0.24)',
  deep: '0 24px 58px rgba(0, 0, 0, 0.42)',
  floating: '0 28px 70px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(255, 255, 255, 0.08)',
};

const DEFAULT_THEME: ThemeDefinition = {
  schemaVersion: THEME_SCHEMA_VERSION,
  engineVersion: THEME_ENGINE_VERSION,
  id: DEFAULT_THEME_ID,
  name: 'FASP Default',
  colors: {
    accent: '#8b5cf6',
    accent2: '#22d3ee',
    text: '#f8fafc',
    mutedText: 'rgba(255, 255, 255, 0.52)',
    surface: 'rgba(255, 255, 255, 0.095)',
    surfaceStrong: 'rgba(25, 29, 45, 0.76)',
    border: 'rgba(255, 255, 255, 0.14)',
    danger: '#f87171',
  },
  glass: {
    enabled: true,
    blur: 18,
    opacity: 0.9,
    saturation: 140,
  },
  tiles: {
    radius: 20,
    opacity: 0.9,
    shadow: 'deep',
    hoverScale: 1.03,
  },
  layout: {
    spacing: 12,
  },
  background: {
    style: 'current',
  },
  animation: {
    speed: 'normal',
  },
  font: {
    family: 'system',
  },
};

export const PRESET_THEMES: ThemeDefinition[] = [
  DEFAULT_THEME,
  {
    ...DEFAULT_THEME,
    id: 'nord-glass',
    name: 'Nord Glass',
    colors: {
      accent: '#88c0d0',
      accent2: '#a3be8c',
      text: '#eceff4',
      mutedText: 'rgba(236, 239, 244, 0.54)',
      surface: 'rgba(59, 66, 82, 0.34)',
      surfaceStrong: 'rgba(46, 52, 64, 0.82)',
      border: 'rgba(216, 222, 233, 0.16)',
      danger: '#bf616a',
    },
    glass: { enabled: true, blur: 20, opacity: 0.84, saturation: 130 },
    tiles: { radius: 18, opacity: 0.88, shadow: 'soft', hoverScale: 1.025 },
    background: { style: 'gradient', gradient: 'radial-gradient(circle at 25% 20%, #3b4252, transparent 32%), linear-gradient(135deg, #101827, #1f2937)' },
  },
  {
    ...DEFAULT_THEME,
    id: 'graphite',
    name: 'Graphite',
    colors: {
      accent: '#a1a1aa',
      accent2: '#e5e7eb',
      text: '#f4f4f5',
      mutedText: 'rgba(244, 244, 245, 0.48)',
      surface: 'rgba(255, 255, 255, 0.075)',
      surfaceStrong: 'rgba(24, 24, 27, 0.86)',
      border: 'rgba(255, 255, 255, 0.12)',
      danger: '#fb7185',
    },
    glass: { enabled: true, blur: 14, opacity: 0.92, saturation: 105 },
    tiles: { radius: 14, opacity: 0.92, shadow: 'soft', hoverScale: 1.018 },
    background: { style: 'gradient', gradient: 'linear-gradient(135deg, #09090b, #18181b 48%, #27272a)' },
  },
  {
    ...DEFAULT_THEME,
    id: 'aurora',
    name: 'Aurora',
    colors: {
      accent: '#a855f7',
      accent2: '#06b6d4',
      text: '#fdf4ff',
      mutedText: 'rgba(253, 244, 255, 0.52)',
      surface: 'rgba(168, 85, 247, 0.12)',
      surfaceStrong: 'rgba(26, 18, 44, 0.84)',
      border: 'rgba(216, 180, 254, 0.18)',
      danger: '#fb7185',
    },
    glass: { enabled: true, blur: 24, opacity: 0.86, saturation: 160 },
    tiles: { radius: 24, opacity: 0.88, shadow: 'floating', hoverScale: 1.035 },
    background: { style: 'gradient', gradient: 'radial-gradient(circle at 20% 25%, rgba(168, 85, 247, .36), transparent 32%), radial-gradient(circle at 76% 18%, rgba(6, 182, 212, .28), transparent 30%), linear-gradient(135deg, #0b1020, #201136)' },
  },
  {
    ...DEFAULT_THEME,
    id: 'mint-frost',
    name: 'Mint Frost',
    colors: {
      accent: '#5eead4',
      accent2: '#93c5fd',
      text: '#f8fafc',
      mutedText: 'rgba(226, 232, 240, 0.54)',
      surface: 'rgba(148, 163, 184, 0.11)',
      surfaceStrong: 'rgba(15, 23, 42, 0.74)',
      border: 'rgba(186, 230, 253, 0.18)',
      danger: '#fb7185',
    },
    glass: { enabled: true, blur: 22, opacity: 0.82, saturation: 145 },
    tiles: { radius: 22, opacity: 0.86, shadow: 'floating', hoverScale: 1.028 },
    background: { style: 'gradient', gradient: 'radial-gradient(circle at 18% 22%, rgba(94, 234, 212, .28), transparent 34%), radial-gradient(circle at 82% 30%, rgba(147, 197, 253, .24), transparent 32%), linear-gradient(135deg, #07111f, #132235)' },
  },
  {
    ...DEFAULT_THEME,
    id: 'ember-slate',
    name: 'Ember Slate',
    colors: {
      accent: '#fb923c',
      accent2: '#38bdf8',
      text: '#fff7ed',
      mutedText: 'rgba(255, 237, 213, 0.5)',
      surface: 'rgba(251, 146, 60, 0.08)',
      surfaceStrong: 'rgba(23, 23, 28, 0.82)',
      border: 'rgba(251, 191, 36, 0.16)',
      danger: '#f43f5e',
    },
    glass: { enabled: true, blur: 18, opacity: 0.88, saturation: 128 },
    tiles: { radius: 16, opacity: 0.9, shadow: 'deep', hoverScale: 1.024 },
    background: { style: 'gradient', gradient: 'radial-gradient(circle at 22% 28%, rgba(251, 146, 60, .24), transparent 30%), radial-gradient(circle at 76% 18%, rgba(56, 189, 248, .16), transparent 34%), linear-gradient(135deg, #0b1020, #1f1b18 52%, #111827)' },
  },
  {
    ...DEFAULT_THEME,
    id: 'orchid-cyber',
    name: 'Orchid Cyber',
    colors: {
      accent: '#e879f9',
      accent2: '#22d3ee',
      text: '#fdf4ff',
      mutedText: 'rgba(250, 232, 255, 0.52)',
      surface: 'rgba(232, 121, 249, 0.1)',
      surfaceStrong: 'rgba(20, 15, 34, 0.84)',
      border: 'rgba(103, 232, 249, 0.16)',
      danger: '#f87171',
    },
    glass: { enabled: true, blur: 26, opacity: 0.84, saturation: 170 },
    tiles: { radius: 28, opacity: 0.86, shadow: 'floating', hoverScale: 1.035 },
    background: { style: 'gradient', gradient: 'radial-gradient(circle at 24% 20%, rgba(232, 121, 249, .32), transparent 30%), radial-gradient(circle at 74% 24%, rgba(34, 211, 238, .28), transparent 30%), radial-gradient(circle at 48% 84%, rgba(129, 140, 248, .18), transparent 34%), linear-gradient(135deg, #090818, #19112d)' },
  },
  {
    ...DEFAULT_THEME,
    id: 'paper-ink',
    name: 'Paper Ink',
    colors: {
      accent: '#60a5fa',
      accent2: '#f472b6',
      text: '#f8fafc',
      mutedText: 'rgba(226, 232, 240, 0.5)',
      surface: 'rgba(255, 255, 255, 0.07)',
      surfaceStrong: 'rgba(13, 18, 28, 0.88)',
      border: 'rgba(255, 255, 255, 0.13)',
      danger: '#fb7185',
    },
    glass: { enabled: false, blur: 0, opacity: 0.94, saturation: 100 },
    tiles: { radius: 12, opacity: 0.94, shadow: 'soft', hoverScale: 1.018 },
    background: { style: 'gradient', gradient: 'linear-gradient(135deg, #05070d, #111827 52%, #1e293b)' },
    animation: { speed: 'reduced' },
  },
  {
    ...DEFAULT_THEME,
    id: 'minimal-dark',
    name: 'Minimal Dark',
    colors: {
      accent: '#64748b',
      accent2: '#94a3b8',
      text: '#f8fafc',
      mutedText: 'rgba(248, 250, 252, 0.45)',
      surface: 'rgba(255, 255, 255, 0.045)',
      surfaceStrong: 'rgba(2, 6, 23, 0.9)',
      border: 'rgba(255, 255, 255, 0.09)',
      danger: '#ef4444',
    },
    glass: { enabled: false, blur: 0, opacity: 0.96, saturation: 100 },
    tiles: { radius: 10, opacity: 0.96, shadow: 'none', hoverScale: 1.012 },
    background: { style: 'gradient', gradient: 'linear-gradient(135deg, #020617, #0f172a)' },
    animation: { speed: 'reduced' },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, number));
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function readColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) return trimmed;
  if (/^rgba?\([\d\s.,%]+\)$/i.test(trimmed)) return trimmed;
  return fallback;
}

function readGradient(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (trimmed.length > 1400) return fallback;
  if (!/^(linear|radial|conic)-gradient\(/i.test(trimmed)) return fallback;
  if (/url\s*\(|expression\s*\(|@import|;|</i.test(trimmed)) return fallback;
  return trimmed;
}

function readAssetId(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!/^[a-z0-9:_-]{3,160}$/i.test(trimmed)) return fallback;
  return trimmed;
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

export function normalizeTheme(input: unknown): ThemeDefinition {
  if (!isRecord(input)) throw new Error('Theme must be an object');
  const source = input as ThemeInput;
  const base = PRESET_THEMES.find((theme) => theme.id === source.id) || DEFAULT_THEME;
  const colors: Record<string, unknown> = isRecord(source.colors) ? source.colors : {};
  const glass: Record<string, unknown> = isRecord(source.glass) ? source.glass : {};
  const tiles: Record<string, unknown> = isRecord(source.tiles) ? source.tiles : {};
  const layout: Record<string, unknown> = isRecord(source.layout) ? source.layout : {};
  const background: Record<string, unknown> = isRecord(source.background) ? source.background : {};
  const animation: Record<string, unknown> = isRecord(source.animation) ? source.animation : {};

  const schemaVersion = source.schemaVersion;
  if (schemaVersion !== undefined && schemaVersion !== THEME_SCHEMA_VERSION) {
    throw new Error(`Unsupported theme schemaVersion: ${String(schemaVersion)}`);
  }

  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    engineVersion: THEME_ENGINE_VERSION,
    id: readString(source.id, `custom-${crypto.randomUUID()}`).replace(/[^a-z0-9_-]/gi, '-').toLowerCase(),
    name: readString(source.name, 'Custom Theme').slice(0, 80),
    colors: {
      accent: readColor(colors.accent, base.colors.accent),
      accent2: readColor(colors.accent2, base.colors.accent2),
      text: readColor(colors.text, base.colors.text),
      mutedText: readColor(colors.mutedText, base.colors.mutedText),
      surface: readColor(colors.surface, base.colors.surface),
      surfaceStrong: readColor(colors.surfaceStrong, base.colors.surfaceStrong),
      border: readColor(colors.border, base.colors.border),
      danger: readColor(colors.danger, base.colors.danger),
    },
    glass: {
      enabled: typeof glass.enabled === 'boolean' ? glass.enabled : base.glass.enabled,
      blur: clampNumber(glass.blur, base.glass.blur, 0, 40),
      opacity: clampNumber(glass.opacity, base.glass.opacity, 0.2, 1),
      saturation: clampNumber(glass.saturation, base.glass.saturation, 80, 220),
    },
    tiles: {
      radius: clampNumber(tiles.radius, base.tiles.radius, 0, 96),
      opacity: clampNumber(tiles.opacity, base.tiles.opacity, 0, 1),
      shadow: readEnum(tiles.shadow, ['none', 'soft', 'deep', 'floating'] as const, base.tiles.shadow),
      hoverScale: clampNumber(tiles.hoverScale, base.tiles.hoverScale, 1, 1.08),
    },
    layout: {
      spacing: clampNumber(layout.spacing, base.layout.spacing, 4, 40),
    },
    background: {
      style: readEnum(background.style, ['current', 'gradient', 'generative', 'static'] as const, base.background.style),
      gradient: readGradient(background.gradient, base.background.gradient),
      staticImageAssetId: readAssetId(background.staticImageAssetId, base.background.staticImageAssetId),
      generatedType: readEnum(
        background.generatedType,
        ['perlin', 'particles', 'fractal-flow', 'aurora', 'plasma', 'julia', 'automata', 'reaction-diffusion'] as const,
        base.background.generatedType || 'particles'
      ),
    },
    animation: {
      speed: readEnum(animation.speed, ['reduced', 'normal', 'expressive'] as const, base.animation.speed),
    },
    font: {
      family: 'system',
    },
  };
}

function getThemeById(id: string, customThemes: ThemeDefinition[]): ThemeDefinition {
  return customThemes.find((theme) => theme.id === id)
    || PRESET_THEMES.find((theme) => theme.id === id)
    || DEFAULT_THEME;
}

function animationScale(theme: ThemeDefinition): string {
  if (theme.animation.speed === 'reduced') return '0.72';
  if (theme.animation.speed === 'expressive') return '1.18';
  return '1';
}

function applyOpacityToColor(color: string, opacity: number): string {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split('').map((char) => char + char).join('')
      : hex[1];
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  const rgba = color.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(',').map((part) => part.trim());
    const [r, g, b] = parts;
    const alpha = parts[3] !== undefined ? Number(parts[3]) : 1;
    const nextAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha * opacity)) : opacity;
    return `rgba(${r}, ${g}, ${b}, ${nextAlpha})`;
  }

  return color;
}

function withExactOpacity(color: string, opacity: number): string {
  const alpha = Math.max(0, Math.min(1, opacity));
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split('').map((char) => char + char).join('')
      : hex[1];
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const rgba = color.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(',').map((part) => part.trim());
    const [r, g, b] = parts;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return color;
}

function parseColorForContrast(color: string): { r: number; g: number; b: number } | null {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split('').map((char) => char + char).join('')
      : hex[1].slice(0, 6);
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
    };
  }

  const rgb = color.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return null;
  const [r, g, b] = rgb[1].split(',').map((part) => Number.parseFloat(part.trim()));
  if (![r, g, b].every((value) => Number.isFinite(value))) return null;
  return { r, g, b };
}

function readableTextOn(color: string): string {
  const rgb = parseColorForContrast(color);
  if (!rgb) return '#ffffff';
  const toLinear = (value: number) => {
    const normalized = Math.max(0, Math.min(255, value)) / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
  return luminance > 0.58 ? '#020617' : '#ffffff';
}

export function applyThemeToDocument(theme: ThemeDefinition): void {
  if (typeof document === 'undefined') return;
  logStartupDebug('theme:apply:start', {
    id: theme.id,
    backgroundStyle: theme.background.style,
    backgroundGeneratedType: theme.background.generatedType || null,
    hasStaticImageAsset: Boolean(theme.background.staticImageAssetId),
    accent: theme.colors.accent,
    accent2: theme.colors.accent2,
    glass: theme.glass.enabled,
  });
  const root = document.documentElement;
  const style = root.style;
  const durationScale = Number(animationScale(theme));
  style.setProperty('--fasp-accent', theme.colors.accent);
  style.setProperty('--fasp-accent-2', theme.colors.accent2);
  style.setProperty('--fasp-on-accent', readableTextOn(theme.colors.accent));
  style.setProperty('--fasp-on-accent-2', readableTextOn(theme.colors.accent2));
  style.setProperty('--fasp-text', theme.colors.text);
  style.setProperty('--fasp-muted-text', theme.colors.mutedText);
  const glassEnabled = theme.glass.enabled;
  const surface = glassEnabled
    ? applyOpacityToColor(theme.colors.surface, theme.glass.opacity)
    : withExactOpacity(theme.colors.surface, 0.96);
  const surfaceStrong = glassEnabled
    ? applyOpacityToColor(theme.colors.surfaceStrong, theme.glass.opacity)
    : withExactOpacity(theme.colors.surfaceStrong, 0.985);
  style.setProperty('--fasp-surface', surface);
  style.setProperty('--fasp-surface-strong', surfaceStrong);
  style.setProperty('--fasp-border', theme.colors.border);
  style.setProperty('--fasp-danger', theme.colors.danger);
  style.setProperty('--fasp-glass-blur', `${glassEnabled ? theme.glass.blur : 0}px`);
  style.setProperty('--fasp-glass-strong-blur', `${glassEnabled ? theme.glass.blur + 10 : 0}px`);
  style.setProperty('--fasp-glass-opacity', String(glassEnabled ? theme.glass.opacity : 1));
  style.setProperty('--fasp-glass-saturation', `${glassEnabled ? theme.glass.saturation : 100}%`);
  style.setProperty('--fasp-tile-radius', `${theme.tiles.radius}px`);
  style.setProperty('--fasp-tile-opacity', String(theme.tiles.opacity));
  style.setProperty('--fasp-tile-hover-scale', String(theme.tiles.hoverScale));
  style.setProperty('--fasp-tile-shadow', shadowValues[theme.tiles.shadow]);
  style.setProperty('--fasp-grid-spacing', `${theme.layout.spacing}px`);
  style.setProperty('--fasp-animation-scale', animationScale(theme));
  style.setProperty('--fasp-duration-fast', `${Math.round(160 * durationScale)}ms`);
  style.setProperty('--fasp-duration-medium', `${Math.round(360 * durationScale)}ms`);
  style.setProperty('--fasp-duration-long', `${Math.round(720 * durationScale)}ms`);
  style.setProperty('--fasp-background-gradient', theme.background.gradient || 'linear-gradient(135deg, #0f172a, #111827)');
  root.dataset.faspTheme = theme.id;
  root.dataset.faspThemeBackground = theme.background.style;
  root.dataset.faspGlass = glassEnabled ? 'on' : 'off';
  logStartupDebug('theme:apply:done', {
    id: theme.id,
    backgroundStyle: theme.background.style,
    bodyBackground: typeof getComputedStyle === 'function' && document.body
      ? getComputedStyle(document.body).backgroundImage || getComputedStyle(document.body).backgroundColor
      : null,
  });
}

async function savePersistedTheme(state: PersistedThemeState): Promise<void> {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    await browser.storage.local.set({ [STORAGE_KEY]: state });
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}

async function loadPersistedTheme(): Promise<PersistedThemeState> {
  try {
    const raw = typeof browser !== 'undefined' && browser.storage?.local
      ? (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY]
      : localStorage.getItem(STORAGE_KEY);
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!isRecord(parsed)) throw new Error('Missing persisted theme');
    const customThemes = Array.isArray(parsed.customThemes)
      ? parsed.customThemes.map((theme) => normalizeTheme(theme))
      : [];
    return {
      schemaVersion: THEME_SCHEMA_VERSION,
      activeThemeId: typeof parsed.activeThemeId === 'string' ? parsed.activeThemeId : DEFAULT_THEME_ID,
      customThemes,
    };
  } catch {
    return {
      schemaVersion: THEME_SCHEMA_VERSION,
      activeThemeId: DEFAULT_THEME_ID,
      customThemes: [],
    };
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  activeThemeId: DEFAULT_THEME_ID,
  customThemes: [],
  previewTheme: null,
  activeTheme: DEFAULT_THEME,
  runtimeTheme: DEFAULT_THEME,
  error: null,

  loadTheme: async () => {
    const persisted = await loadPersistedTheme();
    const activeTheme = getThemeById(persisted.activeThemeId, persisted.customThemes);
    logStartupDebug('theme:load:persisted', {
      activeThemeId: persisted.activeThemeId,
      resolvedThemeId: activeTheme.id,
      customThemeCount: persisted.customThemes.length,
      backgroundStyle: activeTheme.background.style,
      hasStaticImageAsset: Boolean(activeTheme.background.staticImageAssetId),
    });
    applyThemeToDocument(activeTheme);
    set({
      activeThemeId: activeTheme.id,
      customThemes: persisted.customThemes,
      activeTheme,
      runtimeTheme: activeTheme,
      previewTheme: null,
      error: null,
    });
  },

  setTheme: async (id) => {
    const activeTheme = getThemeById(id, get().customThemes);
    applyThemeToDocument(activeTheme);
    const next = {
      activeThemeId: activeTheme.id,
      customThemes: get().customThemes,
    };
    set({
      activeThemeId: activeTheme.id,
      activeTheme,
      runtimeTheme: activeTheme,
      previewTheme: null,
      error: null,
    });
    await savePersistedTheme({ schemaVersion: THEME_SCHEMA_VERSION, ...next });
  },

  previewThemeDefinition: (theme) => {
    const normalized = normalizeTheme(theme);
    applyThemeToDocument(normalized);
    set({ previewTheme: normalized, runtimeTheme: normalized, error: null });
    return normalized;
  },

  updatePreviewTheme: (updates) => {
    const current = get().previewTheme || get().runtimeTheme;
    const editingPreset = PRESET_THEMES.some((theme) => theme.id === current.id) && Object.keys(updates).length > 0;
    const next = normalizeTheme({
      ...current,
      id: editingPreset ? `custom-${current.id}` : current.id,
      name: editingPreset ? `${current.name} Custom` : current.name,
      ...updates,
      colors: { ...current.colors, ...updates.colors },
      glass: { ...current.glass, ...updates.glass },
      tiles: { ...current.tiles, ...updates.tiles },
      layout: { ...current.layout, ...updates.layout },
      background: { ...current.background, ...updates.background },
      animation: { ...current.animation, ...updates.animation },
      font: { family: 'system' },
    });
    applyThemeToDocument(next);
    set({ previewTheme: next, runtimeTheme: next, error: null });
  },

  applyPreview: async () => {
    const preview = get().previewTheme;
    if (!preview) return;
    const isPreset = PRESET_THEMES.some((theme) => theme.id === preview.id);
    const customThemes = isPreset
      ? get().customThemes
      : [
          ...get().customThemes.filter((theme) => theme.id !== preview.id),
          preview,
        ];
    await savePersistedTheme({
      schemaVersion: THEME_SCHEMA_VERSION,
      activeThemeId: preview.id,
      customThemes,
    });
    applyThemeToDocument(preview);
    set({
      activeThemeId: preview.id,
      activeTheme: preview,
      runtimeTheme: preview,
      previewTheme: null,
      customThemes,
      error: null,
    });
  },

  cancelPreview: () => {
    const activeTheme = get().activeTheme;
    applyThemeToDocument(activeTheme);
    set({ previewTheme: null, runtimeTheme: activeTheme, error: null });
  },

  importThemeJson: (raw) => {
    try {
      const normalized = normalizeTheme(JSON.parse(raw));
      get().previewThemeDefinition({
        ...normalized,
        id: normalized.id.startsWith('preset-') ? `custom-${crypto.randomUUID()}` : normalized.id,
      });
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid theme';
      applyThemeToDocument(get().activeTheme || DEFAULT_THEME);
      set({ previewTheme: null, runtimeTheme: get().activeTheme || DEFAULT_THEME, error: message });
      throw new Error(message);
    }
  },

  exportThemeJson: (id) => {
    const theme = id ? getThemeById(id, get().customThemes) : get().runtimeTheme;
    return JSON.stringify(theme, null, 2);
  },

  saveCustomTheme: async (theme) => {
    const normalized = normalizeTheme(theme);
    const customThemes = [
      ...get().customThemes.filter((candidate) => candidate.id !== normalized.id),
      normalized,
    ];
    const isActive = get().activeThemeId === normalized.id;
    if (isActive) applyThemeToDocument(normalized);
    set({
      customThemes,
      activeTheme: isActive ? normalized : get().activeTheme,
      runtimeTheme: isActive ? normalized : get().runtimeTheme,
      previewTheme: isActive ? null : get().previewTheme,
      error: null,
    });
    await savePersistedTheme({
      schemaVersion: THEME_SCHEMA_VERSION,
      activeThemeId: get().activeThemeId,
      customThemes,
    });
  },

  deleteCustomTheme: async (id) => {
    const customThemes = get().customThemes.filter((theme) => theme.id !== id);
    const activeThemeId = get().activeThemeId === id ? DEFAULT_THEME_ID : get().activeThemeId;
    const activeTheme = getThemeById(activeThemeId, customThemes);
    applyThemeToDocument(activeTheme);
    set({
      customThemes,
      activeThemeId,
      activeTheme,
      runtimeTheme: activeTheme,
      previewTheme: null,
      error: null,
    });
    await savePersistedTheme({
      schemaVersion: THEME_SCHEMA_VERSION,
      activeThemeId,
      customThemes,
    });
  },
}));

applyThemeToDocument(DEFAULT_THEME);
