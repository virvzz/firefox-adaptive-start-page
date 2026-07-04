import type { ThemeDefinition, ThemeShadowPreset } from '../../../types';

export type ThemeColorKey = 'accent' | 'accent2' | 'text' | 'danger';

export const shadowLabels: Record<ThemeShadowPreset, string> = {
  none: 'Без тени',
  soft: 'Мягкая',
  deep: 'Глубокая',
  floating: 'Парящая',
};

export const shadowPreview: Record<ThemeShadowPreset, string> = {
  none: 'none',
  soft: '0 14px 34px rgba(0, 0, 0, 0.24)',
  deep: '0 24px 58px rgba(0, 0, 0, 0.42)',
  floating: '0 28px 70px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(255, 255, 255, 0.08)',
};

export const backgroundLabels: Record<ThemeDefinition['background']['style'], string> = {
  current: 'Текущий фон приложения',
  gradient: 'Градиент темы',
  generative: 'Генеративный фон',
  static: 'Статичное изображение',
};

export const animationLabels: Record<ThemeDefinition['animation']['speed'], string> = {
  reduced: 'Спокойная',
  normal: 'Обычная',
  expressive: 'Выразительная',
};

export const themeColorPresets: Record<ThemeColorKey, string[]> = {
  accent: ['#8b5cf6', '#64748b', '#38bdf8', '#22c55e', '#f59e0b', '#ef4444'],
  accent2: ['#22d3ee', '#94a3b8', '#a3be8c', '#f472b6', '#fb923c', '#c084fc'],
  text: ['#f8fafc', '#e5e7eb', '#cbd5e1', '#94a3b8', '#111827', '#020617'],
  danger: ['#f87171', '#ef4444', '#fb7185', '#bf616a', '#f97316', '#dc2626'],
};

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const raw = match[1].length === 3
    ? match[1].split('').map((char) => char + char).join('')
    : match[1];
  return `#${raw.toLowerCase()}`;
}

export function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  const normalized = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((value) => Number.isNaN(value))) return `rgba(139, 92, 246, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildPaletteGradient(palette: string[]): string {
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

export function themeToPalette(theme: ThemeDefinition): string[] {
  return [
    theme.colors.accent,
    theme.colors.accent2,
    theme.colors.surfaceStrong.startsWith('#') ? theme.colors.surfaceStrong : theme.colors.accent,
    theme.colors.surface.startsWith('#') ? theme.colors.surface : theme.colors.accent2,
    theme.colors.danger,
  ];
}

export function colorWithOpacity(color: string, opacity: number): string {
  if (color.startsWith('#')) return hexToRgba(color, opacity);
  const match = color.match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return color;
  const parts = match[1].split(',').map((part) => part.trim());
  const [r, g, b] = parts;
  const sourceAlpha = parts[3] !== undefined ? Number(parts[3]) : 1;
  const nextAlpha = Number.isFinite(sourceAlpha) ? Math.max(0, Math.min(1, sourceAlpha * opacity)) : opacity;
  return `rgba(${r}, ${g}, ${b}, ${nextAlpha})`;
}
