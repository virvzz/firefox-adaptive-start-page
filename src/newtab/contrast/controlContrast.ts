import type { AppSettings, BackgroundConfig, ThemeDefinition } from '../../types';

export type ControlContrastReason =
  | 'disabled'
  | 'custom-background'
  | 'low-accent-contrast'
  | 'muted-accent'
  | 'enabled';

export interface ControlContrastAnalysis {
  enabled: boolean;
  reason: ControlContrastReason;
  title: string;
  description: string;
  outlineColor: string;
  accentContrast: number;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseRgbColor(color: string | undefined): RgbColor | null {
  if (!color) return null;
  const trimmed = color.trim();
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
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

  const rgb = trimmed.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return null;
  const [r, g, b] = rgb[1].split(',').map((part) => Number.parseFloat(part.trim()));
  if (![r, g, b].every((value) => Number.isFinite(value))) return null;
  return { r: clampChannel(r), g: clampChannel(g), b: clampChannel(b) };
}

function relativeLuminance(color: RgbColor): number {
  const toLinear = (value: number) => {
    const normalized = Math.max(0, Math.min(255, value)) / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);
}

function contrastRatio(a: RgbColor, b: RgbColor): number {
  const light = Math.max(relativeLuminance(a), relativeLuminance(b));
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (light + 0.05) / (dark + 0.05);
}

function colorChroma(color: RgbColor): number {
  return Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
}

function hasCustomStaticBackground(background: BackgroundConfig, theme: ThemeDefinition): boolean {
  if (theme.background.style === 'static' && theme.background.staticImageAssetId) return true;
  return theme.background.style === 'current'
    && background.mode === 'static'
    && Boolean(background.staticImage || background.staticImageAssetId);
}

export function analyzeControlContrast(
  settings: Pick<AppSettings, 'adaptiveControlContrast'>,
  background: BackgroundConfig,
  theme: ThemeDefinition
): ControlContrastAnalysis {
  const accent = parseRgbColor(theme.colors.accent) || { r: 139, g: 92, b: 246 };
  const surface = parseRgbColor(theme.colors.surfaceStrong) || { r: 15, g: 23, b: 42 };
  const accentContrast = contrastRatio(accent, surface);
  const mutedAccent = colorChroma(accent) < 34;
  const customBackground = hasCustomStaticBackground(background, theme);
  const outlineColor = relativeLuminance(accent) > 0.5 ? 'rgba(2, 6, 23, 0.9)' : 'rgba(255, 255, 255, 0.94)';

  if (!settings.adaptiveControlContrast) {
    return {
      enabled: false,
      reason: 'disabled',
      title: 'Выключено',
      description: 'Стандартный вид переключателей зависит от выбранной темы.',
      outlineColor,
      accentContrast,
    };
  }

  if (customBackground) {
    return {
      enabled: true,
      reason: 'custom-background',
      title: 'Усиление включено',
      description: 'Обнаружен пользовательский фон. Переключатели получают более плотную подложку, контур и явное состояние.',
      outlineColor,
      accentContrast,
    };
  }

  if (accentContrast < 2.2) {
    return {
      enabled: true,
      reason: 'low-accent-contrast',
      title: 'Усиление включено',
      description: 'Акцент темы близок к поверхности интерфейса, поэтому состояние переключателей дополнительно выделяется.',
      outlineColor,
      accentContrast,
    };
  }

  if (mutedAccent) {
    return {
      enabled: true,
      reason: 'muted-accent',
      title: 'Усиление включено',
      description: 'Акцент темы спокойный, поэтому переключатели получают более заметный контур.',
      outlineColor,
      accentContrast,
    };
  }

  return {
    enabled: true,
    reason: 'enabled',
    title: 'Усиление включено',
    description: 'Контраст элементов управления усилен, но палитра темы сохранена.',
    outlineColor,
    accentContrast,
  };
}
