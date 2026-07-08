import { useRef, useEffect, useCallback, useLayoutEffect, useMemo, useState } from 'react';
import type { BackgroundConfig, ThemeDefinition } from '../../../types';
import { useBackgroundStore } from '../../stores/backgroundStore';
import { useThemeStore } from '../../stores/themeStore';
import { readMediaAssetBlob } from '../../media/mediaAssets';
import { logStartupDebug } from '../../../debug/startupDebug';
import {
  createWebglBackground,
  isWebglBackgroundType,
  type WebglBackgroundHandle,
  type WebglPalette,
} from './webglBackground';

const BACKGROUND_RENDER_SCALE = 0.55;
const BACKGROUND_MAX_WIDTH = 1280;
const BACKGROUND_MAX_HEIGHT = 900;
const PIXEL_BACKGROUND_RENDER_SCALE = 0.34;
const PIXEL_BACKGROUND_MAX_WIDTH = 860;
const PIXEL_BACKGROUND_MAX_HEIGHT = 620;
const PIXEL_BACKGROUND_FPS_LIMIT = 24;
const PERLIN_BACKGROUND_FPS_LIMIT = 20;
const PIXEL_BACKGROUND_TYPES: Array<NonNullable<BackgroundConfig['generativeType']>> = [
  'perlin',
  'fractal-flow',
  'aurora',
  'plasma',
  'julia',
  'reaction-diffusion',
];
const BACKGROUND_LAYER_CLASS = 'fasp-background-layer fixed inset-0 z-0 h-full w-full bg-cover bg-center bg-no-repeat';

const THEME_STATIC_IMAGE_URL_CACHE_LIMIT = 4;
const themeStaticImageUrlCache = new Map<string, string>();
const themeStaticImageUrlPromises = new Map<string, Promise<string | undefined>>();

function touchThemeStaticImageUrl(assetId: string, url: string): void {
  themeStaticImageUrlCache.delete(assetId);
  themeStaticImageUrlCache.set(assetId, url);
  while (themeStaticImageUrlCache.size > THEME_STATIC_IMAGE_URL_CACHE_LIMIT) {
    const [oldestAssetId, oldestUrl] = themeStaticImageUrlCache.entries().next().value as [string, string];
    themeStaticImageUrlCache.delete(oldestAssetId);
    decodedBackgroundImageUrls.delete(oldestUrl);
    URL.revokeObjectURL(oldestUrl);
  }
}
const decodedBackgroundImageUrls = new Set<string>();
const decodedBackgroundImageUrlPromises = new Map<string, Promise<boolean>>();

async function loadThemeStaticImageUrl(assetId: string): Promise<string | undefined> {
  const cached = themeStaticImageUrlCache.get(assetId);
  if (cached) {
    touchThemeStaticImageUrl(assetId, cached);
    logStartupDebug('background:theme-static-url:cache-hit', { assetId });
    return cached;
  }

  const pending = themeStaticImageUrlPromises.get(assetId);
  if (pending) {
    logStartupDebug('background:theme-static-url:pending-reuse', { assetId });
    return pending;
  }

  logStartupDebug('background:theme-static-url:load-start', { assetId });
  const promise = readMediaAssetBlob(assetId)
    .then((blob) => {
      if (!blob) {
        logStartupDebug('background:theme-static-url:missing-blob', { assetId });
        return undefined;
      }
      const url = URL.createObjectURL(blob);
      touchThemeStaticImageUrl(assetId, url);
      logStartupDebug('background:theme-static-url:load-done', {
        assetId,
        blobType: blob.type,
        blobSize: blob.size,
      });
      return url;
    })
    .finally(() => {
      themeStaticImageUrlPromises.delete(assetId);
    });

  themeStaticImageUrlPromises.set(assetId, promise);
  return promise;
}

function decodeBackgroundImageUrl(url: string): Promise<boolean> {
  if (decodedBackgroundImageUrls.has(url)) {
    logStartupDebug('background:image-decode:cache-hit', { url });
    return Promise.resolve(true);
  }

  const pending = decodedBackgroundImageUrlPromises.get(url);
  if (pending) {
    logStartupDebug('background:image-decode:pending-reuse', { url });
    return pending;
  }

  logStartupDebug('background:image-decode:start', { url });
  const promise = new Promise<boolean>((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (ok) decodedBackgroundImageUrls.add(url);
      logStartupDebug(ok ? 'background:image-decode:done' : 'background:image-decode:error', { url });
      resolve(ok);
    };

    image.decoding = 'async';
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;

    if (typeof image.decode === 'function') {
      void image.decode().then(() => finish(true)).catch(() => {
        if (image.complete && image.naturalWidth > 0) finish(true);
      });
    }
  }).finally(() => {
    decodedBackgroundImageUrlPromises.delete(url);
  });

  decodedBackgroundImageUrlPromises.set(url, promise);
  return promise;
}

export async function preloadThemeStaticBackground(theme: ThemeDefinition): Promise<void> {
  const assetId = theme.background.style === 'static'
    ? theme.background.staticImageAssetId
    : undefined;
  if (!assetId) {
    logStartupDebug('background:theme-static-preload:skip', {
      themeId: theme.id,
      backgroundStyle: theme.background.style,
    });
    return;
  }
  logStartupDebug('background:theme-static-preload:start', { themeId: theme.id, assetId });
  const url = await loadThemeStaticImageUrl(assetId);
  if (url) await decodeBackgroundImageUrl(url);
  logStartupDebug('background:theme-static-preload:done', {
    themeId: theme.id,
    assetId,
    cached: themeStaticImageUrlCache.has(assetId),
  });
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface BackgroundPalette {
  baseA: RgbColor;
  baseB: RgbColor;
  baseC: RgbColor;
  accent: RgbColor;
  accent2: RgbColor;
  danger: RgbColor;
}

interface BackgroundLayerProps {
  onReady?: (kind: string) => void;
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseThemeColor(value: string | undefined, fallback: RgbColor): RgbColor {
  if (!value) return fallback;
  const trimmed = value.trim();
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
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((part) => Number.parseFloat(part.trim()));
    if ([r, g, b].every((part) => Number.isFinite(part))) {
      return { r: clampColor(r), g: clampColor(g), b: clampColor(b) };
    }
  }

  return fallback;
}

function mixColor(a: RgbColor, b: RgbColor, amount: number): RgbColor {
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: clampColor(a.r * (1 - t) + b.r * t),
    g: clampColor(a.g * (1 - t) + b.g * t),
    b: clampColor(a.b * (1 - t) + b.b * t),
  };
}

function rgb(color: RgbColor): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function rgba(color: RgbColor, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function createBackgroundPalette(theme: ThemeDefinition): BackgroundPalette {
  const accent = parseThemeColor(theme.colors.accent, { r: 139, g: 92, b: 246 });
  const accent2 = parseThemeColor(theme.colors.accent2, { r: 34, g: 211, b: 238 });
  const danger = parseThemeColor(theme.colors.danger, accent2);
  const surface = parseThemeColor(theme.colors.surfaceStrong, mixColor(accent, { r: 2, g: 6, b: 23 }, 0.72));

  return {
    accent,
    accent2,
    danger,
    baseA: mixColor(surface, { r: 1, g: 4, b: 13 }, 0.78),
    baseB: mixColor(accent, { r: 2, g: 6, b: 23 }, 0.68),
    baseC: mixColor(accent2, { r: 2, g: 6, b: 23 }, 0.74),
  };
}

function isPixelBackground(type: BackgroundConfig['generativeType']): boolean {
  return !type || PIXEL_BACKGROUND_TYPES.includes(type);
}

const WEBGL_BACKGROUND_MAX_WIDTH = 1920;
const WEBGL_BACKGROUND_MAX_HEIGHT = 1200;

function toWebglColor(color: RgbColor): [number, number, number] {
  return [color.r / 255, color.g / 255, color.b / 255];
}

function toWebglPalette(palette: BackgroundPalette): WebglPalette {
  return {
    baseA: toWebglColor(palette.baseA),
    baseB: toWebglColor(palette.baseB),
    baseC: toWebglColor(palette.baseC),
    accent: toWebglColor(palette.accent),
    accent2: toWebglColor(palette.accent2),
    danger: toWebglColor(palette.danger),
  };
}

function getBackgroundFpsLimit(type: BackgroundConfig['generativeType'], configuredFps: number): number {
  if (type === 'perlin' || !type) return Math.min(configuredFps, PERLIN_BACKGROUND_FPS_LIMIT);
  if (isPixelBackground(type)) return Math.min(configuredFps, PIXEL_BACKGROUND_FPS_LIMIT);
  return configuredFps;
}

export function BackgroundLayer({ onReady }: BackgroundLayerProps = {}) {
  const { config } = useBackgroundStore();
  const { runtimeTheme } = useThemeStore();
  const palette = useMemo(() => createBackgroundPalette(runtimeTheme), [runtimeTheme]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const imageDataRef = useRef<{ width: number; height: number; imageData: ImageData } | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const themeStaticAssetId = runtimeTheme.background.style === 'static'
    ? runtimeTheme.background.staticImageAssetId
    : undefined;
  const [themeStaticImageUrl, setThemeStaticImageUrl] = useState<string | undefined>(
    () => themeStaticAssetId ? themeStaticImageUrlCache.get(themeStaticAssetId) : undefined
  );
  const activeStaticImageUrl = runtimeTheme.background.style === 'static'
    ? themeStaticImageUrl
    : config.mode === 'static'
      ? config.staticImage
      : undefined;
  const [decodedStaticImageUrl, setDecodedStaticImageUrl] = useState<string | undefined>(
    () => activeStaticImageUrl && decodedBackgroundImageUrls.has(activeStaticImageUrl)
      ? activeStaticImageUrl
      : undefined
  );
  const staticImageDecoded = Boolean(activeStaticImageUrl && decodedStaticImageUrl === activeStaticImageUrl);
  const renderedKind = runtimeTheme.background.style === 'gradient' && runtimeTheme.background.gradient
    ? 'theme-gradient'
    : runtimeTheme.background.style === 'static' && themeStaticImageUrl && staticImageDecoded
      ? 'theme-static'
    : runtimeTheme.background.style === 'static'
      ? 'theme-static-pending'
      : config.mode === 'static' && config.staticImage && staticImageDecoded
        ? 'config-static'
        : config.mode === 'static' && config.staticImage
          ? 'config-static-pending'
          : 'generative';
  const notifyReady = useCallback((kind: string) => {
    logStartupDebug('background:ready', { kind });
    onReady?.(kind);
  }, [onReady]);

  useLayoutEffect(() => {
    if (renderedKind === 'generative' || renderedKind.endsWith('-pending')) return;
    notifyReady(renderedKind);
  }, [notifyReady, renderedKind]);

  useEffect(() => {
    if (!activeStaticImageUrl) {
      setDecodedStaticImageUrl(undefined);
      return undefined;
    }

    if (decodedBackgroundImageUrls.has(activeStaticImageUrl)) {
      setDecodedStaticImageUrl(activeStaticImageUrl);
      return undefined;
    }

    let cancelled = false;
    setDecodedStaticImageUrl(undefined);
    void decodeBackgroundImageUrl(activeStaticImageUrl).then((ok) => {
      if (cancelled || !ok) return;
      setDecodedStaticImageUrl(activeStaticImageUrl);
    });

    return () => {
      cancelled = true;
    };
  }, [activeStaticImageUrl]);

  useEffect(() => {
    logStartupDebug('background:component:mounted', {
      themeId: runtimeTheme.id,
      themeBackgroundStyle: runtimeTheme.background.style,
      themeStaticAssetId: themeStaticAssetId || null,
      configMode: config.mode,
      configStatic: Boolean(config.staticImage),
      configGenerativeType: config.generativeType || null,
    });
    return () => {
      logStartupDebug('background:component:unmounted');
    };
  }, []);

  useEffect(() => {
    if (!themeStaticAssetId) {
      logStartupDebug('background:theme-static-effect:clear', {
        themeId: runtimeTheme.id,
        style: runtimeTheme.background.style,
      });
      setThemeStaticImageUrl(undefined);
      return undefined;
    }

    const cached = themeStaticImageUrlCache.get(themeStaticAssetId);
    if (cached) {
      logStartupDebug('background:theme-static-effect:cache-hit', {
        themeId: runtimeTheme.id,
        assetId: themeStaticAssetId,
      });
      setThemeStaticImageUrl(cached);
      return undefined;
    }

    let cancelled = false;
    setThemeStaticImageUrl(undefined);
    logStartupDebug('background:theme-static-effect:load-start', {
      themeId: runtimeTheme.id,
      assetId: themeStaticAssetId,
    });
    void loadThemeStaticImageUrl(themeStaticAssetId).then((url) => {
      if (!url || cancelled) {
        logStartupDebug('background:theme-static-effect:load-skipped', {
          themeId: runtimeTheme.id,
          assetId: themeStaticAssetId,
          cancelled,
          hasUrl: Boolean(url),
        });
        return;
      }
      logStartupDebug('background:theme-static-effect:load-done', {
        themeId: runtimeTheme.id,
        assetId: themeStaticAssetId,
      });
      setThemeStaticImageUrl(url);
    });

    return () => {
      cancelled = true;
      logStartupDebug('background:theme-static-effect:cancel', {
        themeId: runtimeTheme.id,
        assetId: themeStaticAssetId,
      });
    };
  }, [runtimeTheme.background.style, runtimeTheme.id, themeStaticAssetId]);

  const getImageDataBuffer = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const cached = imageDataRef.current;
    if (!cached || cached.width !== w || cached.height !== h) {
      const imageData = ctx.createImageData(w, h);
      imageDataRef.current = { width: w, height: h, imageData };
      return imageData;
    }
    return cached.imageData;
  }, []);

  const drawPerlinNoise = useCallback((ctx: CanvasRenderingContext2D, time: number, w: number, h: number) => {
    const imageData = getImageDataBuffer(ctx, w, h);
    const data = imageData.data;

    // Simple 2D noise approximation using sine waves
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;

        // Layered sine waves simulating Perlin-like noise
        const nx = x / w;
        const ny = y / h;

        let val = 0;
        val += Math.sin(nx * 6.283 + time * 0.3 + Math.cos(ny * 3.141 + time * 0.2) * 2) * 0.3;
        val += Math.sin(ny * 8.202 + time * 0.4 + Math.sin(nx * 4.712 + time * 0.15) * 1.5) * 0.3;
        val += Math.sin((nx * 3 + ny * 5) * 3.141 + time * 0.25) * 0.2;
        val += Math.sin(nx * 12.566 + ny * 8.37 + time * 0.18) * 0.1;
        val += Math.sin(ny * 6.283 - nx * 4.189 + time * 0.22) * 0.1;
        val += Math.cos(nx * 7.5 + ny * 9.3) * Math.sin(time * 0.12) * 0.08;
        val = (val + 1) / 2; // normalize 0..1

        const accentBlend = (Math.sin(nx * 3 + ny * 2 + time * 0.1) + 1) / 2;
        const targetR = palette.accent.r * (1 - accentBlend) + palette.accent2.r * accentBlend;
        const targetG = palette.accent.g * (1 - accentBlend) + palette.accent2.g * accentBlend;
        const targetB = palette.accent.b * (1 - accentBlend) + palette.accent2.b * accentBlend;
        const intensity = 0.18 + val * 0.62;

        data[idx] = clampColor(palette.baseA.r * (1 - intensity) + targetR * intensity);
        data[idx + 1] = clampColor(palette.baseA.g * (1 - intensity) + targetG * intensity);
        data[idx + 2] = clampColor(palette.baseA.b * (1 - intensity) + targetB * intensity);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [getImageDataBuffer, palette]);

  const drawParticles = useCallback((ctx: CanvasRenderingContext2D, time: number, w: number, h: number) => {
    // Draw dark gradient background first
    const bgGrad = ctx.createLinearGradient(0, 0, w, h);
    bgGrad.addColorStop(0, rgb(palette.baseA));
    bgGrad.addColorStop(0.5, rgb(palette.baseB));
    bgGrad.addColorStop(1, rgb(palette.baseC));
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Keep motion slow and low-contrast to avoid physical display ghosting on bright particles.
    const slowTime = time * 0.22;
    const particleCount = 80;
    for (let i = 0; i < particleCount; i++) {
      const seed = i * 127.1 + 311.7;
      const px = ((Math.sin(slowTime * (0.3 + i * 0.017) + seed) + 1) / 2) * w;
      const py = ((Math.cos(slowTime * (0.4 + i * 0.013) + seed * 1.3) + 1) / 2) * h;
      const size = 2 + Math.abs(Math.sin(slowTime * 0.5 + i)) * 3;
      const alpha = 0.18 + Math.abs(Math.sin(slowTime * 0.7 + i * 0.3)) * 0.24;

      const particleMix = (Math.sin(i * 1.7 + slowTime * 0.2) + 1) / 2;
      const particleColor = mixColor(mixColor(palette.accent, palette.accent2, particleMix), palette.baseC, 0.16);
      const glowRadius = size * 3.6;

      const glow = ctx.createRadialGradient(px, py, 0, px, py, glowRadius);
      glow.addColorStop(0, rgba(particleColor, alpha * 0.12));
      glow.addColorStop(0.42, rgba(particleColor, alpha * 0.08));
      glow.addColorStop(1, rgba(particleColor, 0));
      ctx.beginPath();
      ctx.arc(px, py, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      const core = ctx.createRadialGradient(px, py, 0, px, py, size * 1.15);
      core.addColorStop(0, rgba(particleColor, Math.min(0.72, alpha + 0.16)));
      core.addColorStop(0.58, rgba(particleColor, alpha * 0.92));
      core.addColorStop(1, rgba(particleColor, alpha * 0.46));
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fillStyle = core;
      ctx.fill();
    }

    // Connection lines between nearby particles
    ctx.strokeStyle = rgba(mixColor(palette.accent, palette.accent2, 0.5), 0.08);
    ctx.lineWidth = 0.5;
    for (let i = 0; i < particleCount; i += 3) {
      const seedA = i * 127.1 + 311.7;
      const seedB = (i + 1) * 127.1 + 311.7;
      const ax = ((Math.sin(slowTime * (0.3 + i * 0.017) + seedA) + 1) / 2) * w;
      const ay = ((Math.cos(slowTime * (0.4 + i * 0.013) + seedA * 1.3) + 1) / 2) * h;
      const bx = ((Math.sin(slowTime * (0.3 + (i + 1) * 0.017) + seedB) + 1) / 2) * w;
      const by = ((Math.cos(slowTime * (0.4 + (i + 1) * 0.013) + seedB * 1.3) + 1) / 2) * h;
      const dist = Math.hypot(ax - bx, ay - by);
      if (dist < 200) {
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
  }, [palette]);

  const drawFractalFlow = useCallback((ctx: CanvasRenderingContext2D, time: number, w: number, h: number) => {
    const imageData = getImageDataBuffer(ctx, w, h);
    const data = imageData.data;
    const slowTime = time * 0.6;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const nx = x / w;
        const ny = y / h;

        // Fractal flow field using multiple overlapping sine waves
        let val = 0;
        val += Math.sin(nx * 10 + slowTime * 0.5) * Math.cos(ny * 8 + slowTime * 0.3) * 0.5;
        val += Math.sin(ny * 12 - slowTime * 0.4) * Math.cos(nx * 6 + slowTime * 0.35) * 0.4;
        val += Math.sin((nx * 5 + ny * 7) * Math.PI + slowTime * 0.25) * 0.3;
        val += Math.sin(nx * 15 + ny * 10 + slowTime * 0.2) * 0.2;
        val = (val + 1.6) / 3.2;

        const accentBlend = (Math.sin((nx + ny) * 3 + slowTime * 0.3) + 1) / 2;
        const targetR = palette.accent.r * (1 - accentBlend) + palette.accent2.r * accentBlend;
        const targetG = palette.accent.g * (1 - accentBlend) + palette.accent2.g * accentBlend;
        const targetB = palette.accent.b * (1 - accentBlend) + palette.accent2.b * accentBlend;
        const intensity = 0.16 + val * 0.7;

        data[idx] = clampColor(palette.baseA.r * (1 - intensity) + targetR * intensity);
        data[idx + 1] = clampColor(palette.baseA.g * (1 - intensity) + targetG * intensity);
        data[idx + 2] = clampColor(palette.baseA.b * (1 - intensity) + targetB * intensity);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [getImageDataBuffer, palette]);

  const drawAurora = useCallback((ctx: CanvasRenderingContext2D, time: number, w: number, h: number) => {
    const imageData = getImageDataBuffer(ctx, w, h);
    const data = imageData.data;
    const slowTime = time * 0.3;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const nx = x / w;
        const ny = y / h;

        // Aurora borealis effect: horizontal bands with vertical gradients
        let val = 0;
        val += Math.sin(ny * 8 + slowTime * 0.7) * Math.cos(nx * 3 - slowTime * 0.5 + ny * 2) * 0.6;
        val += Math.sin(ny * 15 - slowTime * 0.4 + nx * 2) * 0.3;
        val += Math.cos(nx * 6 + slowTime * 0.3) * Math.sin(ny * 4 + slowTime * 0.6) * 0.4;
        val += Math.sin((nx + ny) * 10 + slowTime * 0.25) * 0.2;
        // Vertical fade
        val *= Math.sin(ny * Math.PI) * 1.2;
        val = (val + 0.8) / 1.6;

        const accentBlend = (Math.cos(nx * 3 + slowTime * 0.3) + 1) / 2;
        const targetR = palette.accent2.r * (1 - accentBlend) + palette.accent.r * accentBlend;
        const targetG = palette.accent2.g * (1 - accentBlend) + palette.accent.g * accentBlend;
        const targetB = palette.accent2.b * (1 - accentBlend) + palette.accent.b * accentBlend;
        const intensity = 0.12 + val * 0.76;

        data[idx] = clampColor(palette.baseA.r * (1 - intensity) + targetR * intensity);
        data[idx + 1] = clampColor(palette.baseA.g * (1 - intensity) + targetG * intensity);
        data[idx + 2] = clampColor(palette.baseA.b * (1 - intensity) + targetB * intensity);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [getImageDataBuffer, palette]);

  const drawPlasmaWaves = useCallback((ctx: CanvasRenderingContext2D, time: number, w: number, h: number) => {
    const imageData = getImageDataBuffer(ctx, w, h);
    const data = imageData.data;
    const slowTime = time * 0.5;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const cx = x - w / 2;
        const cy = y - h / 2;
        const dist = Math.sqrt(cx * cx + cy * cy);
        const angle = Math.atan2(cy, cx);

        // Plasma waves using distance and angle
        let val = 0;
        val += Math.sin(dist * 0.03 + slowTime * 0.8) * 0.5;
        val += Math.cos(angle * 4 + slowTime * 0.4) * 0.3;
        val += Math.sin(dist * 0.05 - slowTime * 0.6 + angle * 2) * 0.4;
        val += Math.cos(dist * 0.02 + angle * 5) * Math.sin(slowTime * 0.3) * 0.3;
        val = (val + 1.2) / 2.4;

        const dangerMix = (Math.cos(angle * 3 + slowTime * 0.35) + 1) / 2;
        const hotR = palette.accent.r * (1 - dangerMix) + palette.danger.r * dangerMix;
        const hotG = palette.accent.g * (1 - dangerMix) + palette.danger.g * dangerMix;
        const hotB = palette.accent.b * (1 - dangerMix) + palette.danger.b * dangerMix;
        const coolR = palette.baseC.r * 0.66 + palette.accent2.r * 0.34;
        const coolG = palette.baseC.g * 0.66 + palette.accent2.g * 0.34;
        const coolB = palette.baseC.b * 0.66 + palette.accent2.b * 0.34;
        const intensity = 0.1 + val * 0.82;

        data[idx] = clampColor(coolR * (1 - intensity) + hotR * intensity);
        data[idx + 1] = clampColor(coolG * (1 - intensity) + hotG * intensity);
        data[idx + 2] = clampColor(coolB * (1 - intensity) + hotB * intensity);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [getImageDataBuffer, palette]);

  const drawJuliaSet = useCallback((ctx: CanvasRenderingContext2D, time: number, w: number, h: number) => {
    const imageData = getImageDataBuffer(ctx, w, h);
    const data = imageData.data;
    const slowTime = time * 0.18;
    const cRe = -0.78 + Math.sin(slowTime) * 0.04;
    const cIm = 0.156 + Math.cos(slowTime * 0.8) * 0.035;
    const zoom = 1.25 + Math.sin(slowTime * 0.6) * 0.08;
    const maxIter = 22;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        let zx = ((x / w) - 0.5) * 3.1 / zoom;
        let zy = ((y / h) - 0.5) * 2.25 / zoom;
        let iter = 0;

        while (zx * zx + zy * zy < 4 && iter < maxIter) {
          const nextX = zx * zx - zy * zy + cRe;
          zy = 2 * zx * zy + cIm;
          zx = nextX;
          iter += 1;
        }

        const t = iter / maxIter;
        const edge = Math.pow(t, 1.8);
        const glow = Math.sin(t * Math.PI);
        const colorA = mixColor(palette.baseA, palette.accent, edge);
        const colorB = mixColor(palette.accent2, palette.danger, glow * 0.35);
        const color = mixColor(colorA, colorB, glow * 0.42);

        data[idx] = color.r;
        data[idx + 1] = color.g;
        data[idx + 2] = color.b;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [getImageDataBuffer, palette]);

  const drawAutomata = useCallback((ctx: CanvasRenderingContext2D, time: number, w: number, h: number) => {
    const bgGrad = ctx.createLinearGradient(0, 0, w, h);
    bgGrad.addColorStop(0, rgb(palette.baseA));
    bgGrad.addColorStop(0.58, rgb(mixColor(palette.baseB, palette.baseC, 0.35)));
    bgGrad.addColorStop(1, rgb(palette.baseC));
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    const cellSize = Math.max(14, Math.min(26, Math.round(w / 42)));
    const columns = Math.ceil(w / cellSize) + 1;
    const rows = Math.ceil(h / cellSize) + 1;
    const step = Math.floor(time * 2.2);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const seed = Math.sin((x + step) * 12.9898 + (y - step) * 78.233) * 43758.5453;
        const pulse = (Math.sin(time * 1.8 + x * 0.7 + y * 0.43) + 1) / 2;
        const alive = seed - Math.floor(seed) > 0.68 - pulse * 0.08;
        if (!alive) continue;

        const px = x * cellSize + Math.sin(time * 0.6 + y) * 2;
        const py = y * cellSize + Math.cos(time * 0.5 + x) * 2;
        const color = mixColor(palette.accent, palette.accent2, pulse);
        ctx.fillStyle = rgba(color, 0.16 + pulse * 0.22);
        ctx.fillRect(px, py, cellSize * 0.72, cellSize * 0.72);
        ctx.strokeStyle = rgba(color, 0.16);
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, cellSize * 0.72, cellSize * 0.72);
      }
    }
  }, [palette]);

  const drawReactionDiffusion = useCallback((ctx: CanvasRenderingContext2D, time: number, w: number, h: number) => {
    const imageData = getImageDataBuffer(ctx, w, h);
    const data = imageData.data;
    const slowTime = time * 0.42;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const nx = x / w;
        const ny = y / h;
        const cx = nx - 0.5;
        const cy = ny - 0.5;
        const dist = Math.sqrt(cx * cx + cy * cy);

        const cells =
          Math.sin((nx * 18 + Math.sin(ny * 9 + slowTime)) * Math.PI) +
          Math.cos((ny * 16 + Math.cos(nx * 8 - slowTime * 0.8)) * Math.PI);
        const rings = Math.sin(dist * 64 - slowTime * 3.4);
        const veins = Math.sin((nx + ny) * 28 + Math.sin((nx - ny) * 12 + slowTime));
        const val = (cells * 0.42 + rings * 0.34 + veins * 0.24 + 1.6) / 3.2;
        const clamped = Math.max(0, Math.min(1, val));
        const t = clamped * clamped * (3 - 2 * clamped);
        const color = mixColor(
          mixColor(palette.baseA, palette.accent, t),
          mixColor(palette.accent2, palette.danger, 0.24),
          Math.max(0, Math.sin(t * Math.PI)) * 0.34
        );

        data[idx] = color.r;
        data[idx + 1] = color.g;
        data[idx + 2] = color.b;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [getImageDataBuffer, palette]);

  useLayoutEffect(() => {
    const themeStaticVisual = runtimeTheme.background.style === 'gradient'
      || (runtimeTheme.background.style === 'static' && runtimeTheme.background.staticImageAssetId);
    if (themeStaticVisual) return;
    if (runtimeTheme.background.style !== 'generative' && config.mode === 'static' && config.staticImage) return;

    const canvas = canvasRef.current;
    if (!canvas) {
      logStartupDebug('background:canvas-effect:skip-missing-canvas');
      return;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const activeGenerativeType = runtimeTheme.background.style === 'generative'
      ? (runtimeTheme.background.generatedType || 'particles')
      : config.generativeType;
    const resolvedType = activeGenerativeType || 'perlin';
    const pixelBackground = isPixelBackground(activeGenerativeType);

    // Per-pixel effects run as fragment shaders when WebGL is available; the
    // canvas-2d implementations stay as the fallback and render the draw-call
    // based effects (particles, automata).
    let webglHandle: WebglBackgroundHandle | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    if (!webglFailed && isWebglBackgroundType(resolvedType)) {
      webglHandle = createWebglBackground(canvas, resolvedType, toWebglPalette(palette));
      if (!webglHandle) {
        logStartupDebug('background:canvas-effect:webgl-unavailable', { type: resolvedType });
        // Remount the canvas so a fresh element can hand out a 2d context.
        setWebglFailed(true);
        return;
      }
    } else {
      ctx = canvas.getContext('2d');
      if (!ctx) {
        logStartupDebug('background:canvas-effect:skip-missing-context');
        return;
      }
    }

    // The GPU renders at (capped) full resolution while the CPU keeps the
    // downscaled buffer; the shader pattern scale is pinned to the CPU buffer
    // size via simWidth/simHeight, so both renderers look the same.
    const fpsLimit = webglHandle
      ? Math.max(1, Math.min(60, config.fpsLimit))
      : getBackgroundFpsLimit(activeGenerativeType, config.fpsLimit);
    logStartupDebug('background:canvas-effect:start', {
      themeId: runtimeTheme.id,
      themeBackgroundStyle: runtimeTheme.background.style,
      activeGenerativeType,
      pixelBackground,
      renderer: webglHandle ? 'webgl' : 'canvas2d',
      fpsLimit,
      animationEnabled: config.animationEnabled,
      prefersReducedMotion,
    });

    const getSimSize = (): { width: number; height: number } => {
      const renderScale = pixelBackground ? PIXEL_BACKGROUND_RENDER_SCALE : BACKGROUND_RENDER_SCALE;
      const maxWidth = pixelBackground ? PIXEL_BACKGROUND_MAX_WIDTH : BACKGROUND_MAX_WIDTH;
      const maxHeight = pixelBackground ? PIXEL_BACKGROUND_MAX_HEIGHT : BACKGROUND_MAX_HEIGHT;
      const scale = Math.min(
        renderScale,
        maxWidth / Math.max(1, window.innerWidth),
        maxHeight / Math.max(1, window.innerHeight)
      );
      return {
        width: Math.max(1, Math.floor(window.innerWidth * scale)),
        height: Math.max(1, Math.floor(window.innerHeight * scale)),
      };
    };

    const resize = () => {
      const simSize = getSimSize();
      const width = webglHandle
        ? Math.max(1, Math.min(window.innerWidth, WEBGL_BACKGROUND_MAX_WIDTH))
        : simSize.width;
      const height = webglHandle
        ? Math.max(1, Math.min(window.innerHeight, WEBGL_BACKGROUND_MAX_HEIGHT))
        : simSize.height;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        imageDataRef.current = null;
        logStartupDebug('background:canvas:resize', {
          width,
          height,
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight,
          renderer: webglHandle ? 'webgl' : 'canvas2d',
        });
      }
      webglHandle?.resize(width, height, simSize.width, simSize.height);
    };
    resize();
    window.addEventListener('resize', resize);

    let drawFn = drawPerlinNoise;
    if (activeGenerativeType === 'particles') drawFn = drawParticles;
    else if (activeGenerativeType === 'fractal-flow') drawFn = drawFractalFlow;
    else if (activeGenerativeType === 'aurora') drawFn = drawAurora;
    else if (activeGenerativeType === 'plasma') drawFn = drawPlasmaWaves;
    else if (activeGenerativeType === 'julia') drawFn = drawJuliaSet;
    else if (activeGenerativeType === 'automata') drawFn = drawAutomata;
    else if (activeGenerativeType === 'reaction-diffusion') drawFn = drawReactionDiffusion;

    const drawFrame = (timeSeconds: number) => {
      if (webglHandle) {
        webglHandle.render(timeSeconds);
      } else if (ctx) {
        drawFn(ctx, timeSeconds, canvas.width, canvas.height);
      }
    };

    const render = (timestamp: number) => {
      if (document.visibilityState === 'hidden') {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      const fpsInterval = 1000 / fpsLimit;
      const elapsed = timestamp - lastTimeRef.current;

      if (elapsed > fpsInterval) {
        lastTimeRef.current = timestamp - (elapsed % fpsInterval);
        drawFrame(timestamp * 0.001);

        // Blur / brightness are applied through the CSS filter on the element.
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    // Draw one frame immediately
    drawFrame(0);
    logStartupDebug('background:canvas:first-frame', {
      width: canvas.width,
      height: canvas.height,
      renderer: webglHandle ? 'webgl' : 'canvas2d',
      animated: !prefersReducedMotion && config.animationEnabled,
    });
    notifyReady('generative');
    if (!prefersReducedMotion && config.animationEnabled) {
      animFrameRef.current = requestAnimationFrame(render);
    }

    return () => {
      window.removeEventListener('resize', resize);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      webglHandle?.dispose();
      logStartupDebug('background:canvas-effect:cleanup');
    };
  }, [config.mode, config.staticImage, config.generativeType, config.animationEnabled, config.fpsLimit, runtimeTheme.background.generatedType, runtimeTheme.background.staticImageAssetId, runtimeTheme.background.style, runtimeTheme.id, palette, webglFailed, drawPerlinNoise, drawParticles, drawFractalFlow, drawAurora, drawPlasmaWaves, drawJuliaSet, drawAutomata, drawReactionDiffusion, notifyReady]);

  const filterStyle = `blur(${config.blur}px) brightness(${config.brightness})`;

  if (runtimeTheme.background.style === 'gradient' && runtimeTheme.background.gradient) {
    return (
      <div
        data-testid="background-layer"
        data-background-kind="theme-gradient"
        className={BACKGROUND_LAYER_CLASS}
        style={{
          background: runtimeTheme.background.gradient,
          filter: filterStyle,
          transform: config.blur > 0 ? 'scale(1.03)' : undefined,
        }}
      />
    );
  }

  if (runtimeTheme.background.style === 'static' && themeStaticImageUrl && staticImageDecoded) {
    return (
      <div
        data-testid="background-layer"
        data-background-kind="theme-static"
        className={BACKGROUND_LAYER_CLASS}
        style={{
          backgroundImage: `url("${themeStaticImageUrl}")`,
          filter: filterStyle,
          transform: config.blur > 0 ? 'scale(1.03)' : undefined,
        }}
      />
    );
  }

  if (runtimeTheme.background.style === 'static') {
    return (
      <div
        data-testid="background-layer"
        data-background-kind="theme-static-pending"
        className={BACKGROUND_LAYER_CLASS}
        style={{
          background: runtimeTheme.background.gradient || 'var(--fasp-background-gradient)',
          filter: filterStyle,
          transform: config.blur > 0 ? 'scale(1.03)' : undefined,
        }}
      />
    );
  }

  if (config.mode === 'static' && config.staticImage && staticImageDecoded) {
    return (
      <div
        data-testid="background-layer"
        data-background-kind="config-static"
        className={BACKGROUND_LAYER_CLASS}
        style={{
          backgroundImage: `url("${config.staticImage}")`,
          filter: filterStyle,
          transform: config.blur > 0 ? 'scale(1.03)' : undefined,
        }}
      />
    );
  }

  if (config.mode === 'static' && config.staticImage) {
    return (
      <div
        data-testid="background-layer"
        data-background-kind="config-static-pending"
        className={BACKGROUND_LAYER_CLASS}
        style={{
          background: runtimeTheme.background.gradient || 'var(--fasp-background-gradient)',
          filter: filterStyle,
          transform: config.blur > 0 ? 'scale(1.03)' : undefined,
        }}
      />
    );
  }

  const generativeTypeForRender = runtimeTheme.background.style === 'generative'
    ? (runtimeTheme.background.generatedType || 'particles')
    : config.generativeType;
  // A canvas element permanently binds to its first context type, so the
  // renderer switch (webgl <-> 2d) has to remount the element.
  const canvasRendererKey = !webglFailed && isWebglBackgroundType(generativeTypeForRender || 'perlin')
    ? 'webgl'
    : 'canvas2d';

  return (
    <canvas
      key={canvasRendererKey}
      ref={canvasRef}
      data-testid="background-layer"
      data-background-kind="generative"
      data-background-renderer={canvasRendererKey}
      className="fasp-background-layer fixed inset-0 w-full h-full z-0"
      style={{ filter: filterStyle }}
    />
  );
}
