export const FALLBACK_ACCENT_COLOR = '#8b5cf6';

const STATIC_SWATCHES = [
  '#2563eb',
  '#0891b2',
  '#059669',
  '#ca8a04',
  '#ea580c',
  '#dc2626',
  '#db2777',
];

export function normalizeThemeAccentColor(value: string, fallback = FALLBACK_ACCENT_COLOR): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value.slice(0, 7) : fallback;
}

export function createThemeColorSwatches(accent: string): string[] {
  const normalizedAccent = normalizeThemeAccentColor(accent);
  return [
    normalizedAccent,
    ...STATIC_SWATCHES.filter((swatch) => swatch.toLowerCase() !== normalizedAccent.toLowerCase()),
  ];
}
