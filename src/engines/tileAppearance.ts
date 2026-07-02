import type { Tile } from '../types';

function normalizeUrl(url: string): string | null {
  try {
    const trimmed = url.trim();
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(normalized).toString();
  } catch {
    return null;
  }
}

export function getFaviconUrl(url: string): string {
  const normalized = normalizeUrl(url);
  if (!normalized) return '';
  const host = new URL(normalized).hostname;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
}

export function getScreenshotThumbnailUrl(url: string): string {
  const normalized = normalizeUrl(url);
  if (!normalized) return '';
  return `https://s.wordpress.com/mshots/v1/${encodeURIComponent(normalized)}?w=480`;
}

export function getScreenshotThumbnailFallbackUrl(url: string): string {
  const normalized = normalizeUrl(url);
  if (!normalized) return '';
  return `https://image.thum.io/get/width/480/crop/360/noanimate/${encodeURI(normalized)}`;
}

/**
 * Extract dominant color from a favicon image.
 * Uses Canvas to sample pixels and find the most common color.
 */
export async function extractDominantColor(imageUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.drawImage(img, 0, 0, 16, 16);
        const imageData = ctx.getImageData(0, 0, 16, 16);
        const data = imageData.data;

        // Count color frequency
        const colorMap = new Map<string, number>();

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];

          // Skip transparent / near-white / near-black
          if (a < 200) continue;
          if (r > 245 && g > 245 && b > 245) continue;
          if (r < 15 && g < 15 && b < 15) continue;

          // Quantize to reduce noise
          const qr = Math.round(r / 32) * 32;
          const qg = Math.round(g / 32) * 32;
          const qb = Math.round(b / 32) * 32;
          const key = `${qr},${qg},${qb}`;
          colorMap.set(key, (colorMap.get(key) || 0) + 1);
        }

        if (colorMap.size === 0) {
          resolve(null);
          return;
        }

        // Sort by frequency
        const sorted = [...colorMap.entries()].sort((a, b) => b[1] - a[1]);
        const [r, g, b] = sorted[0][0].split(',').map(Number);
        const hex = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
        resolve(hex);
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

/**
 * Generate a theme color palette from a dominant color.
 */
export function generateThemeFromColor(hex: string): Tile['themeColors'] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  // Determine if light or dark
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  if (luminance > 0.6) {
    // Light theme
    return {
      primary: hex,
      secondary: lighten(hex, 20),
      text: '#1a1a2e',
    };
  }
  // Dark theme
  return {
    primary: hex,
    secondary: darken(hex, 15),
    text: '#ffffff',
  };
}

function lighten(hex: string, percent: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (num >> 16) + Math.round(255 * percent / 100));
  const g = Math.min(255, ((num >> 8) & 0x00ff) + Math.round(255 * percent / 100));
  const b = Math.min(255, (num & 0x0000ff) + Math.round(255 * percent / 100));
  return '#' + (0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function darken(hex: string, percent: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (num >> 16) - Math.round(255 * percent / 100));
  const g = Math.max(0, ((num >> 8) & 0x00ff) - Math.round(255 * percent / 100));
  const b = Math.max(0, (num & 0x0000ff) - Math.round(255 * percent / 100));
  return '#' + (0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * Fetch favicon from multiple sources.
 */
export async function getFavicon(url: string): Promise<string | null> {
  return getFaviconUrl(url) || null;
}

/**
 * Full tile appearance pipeline: favicon → dominant color → theme.
 */
export async function processTileAppearance(url: string): Promise<{
  favicon: string | null;
  dominantColor: string | null;
  themeColors: Tile['themeColors'] | undefined;
}> {
  const favicon = await getFavicon(url);
  let dominantColor: string | null = null;
  let themeColors: Tile['themeColors'] | undefined;

  if (favicon) {
    dominantColor = await extractDominantColor(favicon);
    if (dominantColor) {
      themeColors = generateThemeFromColor(dominantColor);
    }
  }

  return { favicon, dominantColor, themeColors };
}
