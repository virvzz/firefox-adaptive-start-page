export interface ImagePaletteResult {
  colors: string[];
  dominant: string | null;
}

interface ColorBucket {
  r: number;
  g: number;
  b: number;
  count: number;
  saturation: number;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function saturationOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === 0) return 0;
  return (max - min) / max;
}

function luminanceOf(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function distance(a: ColorBucket, b: ColorBucket): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

export function extractImagePalette(source: string, count = 5): Promise<ImagePaletteResult> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const maxSide = 180;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
        canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
        canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve({ colors: [], dominant: null });
          return;
        }

        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const buckets = new Map<string, ColorBucket>();

        for (let index = 0; index < data.length; index += 16) {
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          const a = data[index + 3];
          if (a < 190) continue;

          const luminance = luminanceOf(r, g, b);
          if (luminance < 0.045 || luminance > 0.94) continue;

          const qr = Math.round(r / 24) * 24;
          const qg = Math.round(g / 24) * 24;
          const qb = Math.round(b / 24) * 24;
          const key = `${qr},${qg},${qb}`;
          const existing = buckets.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            buckets.set(key, {
              r: Math.min(255, qr),
              g: Math.min(255, qg),
              b: Math.min(255, qb),
              count: 1,
              saturation: saturationOf(qr, qg, qb),
            });
          }
        }

        const sorted = [...buckets.values()]
          .map((bucket) => ({
            ...bucket,
            score: bucket.count * (0.75 + bucket.saturation * 0.55),
          }))
          .sort((a, b) => b.score - a.score);

        const picked: ColorBucket[] = [];
        for (const bucket of sorted) {
          if (picked.every((candidate) => distance(candidate, bucket) > 42)) {
            picked.push(bucket);
          }
          if (picked.length >= count) break;
        }

        const colors = picked.map((bucket) => rgbToHex(bucket.r, bucket.g, bucket.b));
        resolve({ colors, dominant: colors[0] || null });
      } catch {
        resolve({ colors: [], dominant: null });
      }
    };
    image.onerror = () => resolve({ colors: [], dominant: null });
    image.src = source;
  });
}
