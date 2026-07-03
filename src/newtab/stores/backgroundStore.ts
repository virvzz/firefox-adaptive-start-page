import { create } from 'zustand';
import { openDB, type IDBPDatabase } from 'idb';
import type { BackgroundConfig } from '../../types';
import {
  deleteMediaAsset,
  readMediaAssetBlob,
  saveImageAssetFromDataUrl,
} from '../media/mediaAssets';
import { logStartupDebug } from '../../debug/startupDebug';

interface BackgroundState {
  config: BackgroundConfig;
  loading: boolean;

  loadBackground: () => Promise<void>;
  setMode: (mode: BackgroundConfig['mode']) => Promise<void>;
  setGenerativeType: (type: BackgroundConfig['generativeType']) => Promise<void>;
  setAnimationEnabled: (enabled: boolean) => Promise<void>;
  setFpsLimit: (fps: number) => Promise<void>;
  setStaticImage: (image: string) => Promise<void>;
  setBlur: (blur: number) => Promise<void>;
  setBrightness: (brightness: number) => Promise<void>;
}

const STORAGE_KEY = 'fasp-background';
const ASSET_DB_NAME = 'fasp-background-assets';
const ASSET_STORE_NAME = 'assets';
const STATIC_IMAGE_KEY = 'static-image';
const STATIC_IMAGE_LOCAL_STORAGE_KEY = 'fasp-background-static-image';

let assetDbPromise: Promise<IDBPDatabase> | null = null;
let staticImageObjectUrl: string | undefined;

export const DEFAULT_BACKGROUND_CONFIG: BackgroundConfig = {
  mode: 'generative',
  generativeType: 'perlin',
  animationEnabled: true,
  fpsLimit: 30,
  blur: 0,
  brightness: 1,
};

function stripStaticImage(config: BackgroundConfig): BackgroundConfig {
  const next = { ...config };
  delete next.staticImage;
  return next;
}

export function normalizeBackgroundConfig(config: Partial<BackgroundConfig> | null | undefined): BackgroundConfig {
  return {
    ...DEFAULT_BACKGROUND_CONFIG,
    ...(config || {}),
    fpsLimit: Math.max(1, Math.min(60, Number(config?.fpsLimit ?? DEFAULT_BACKGROUND_CONFIG.fpsLimit))),
    blur: Math.max(0, Math.min(20, Number(config?.blur ?? DEFAULT_BACKGROUND_CONFIG.blur))),
    brightness: Math.max(0.1, Math.min(3, Number(config?.brightness ?? DEFAULT_BACKGROUND_CONFIG.brightness))),
  };
}

function getAssetDb(): Promise<IDBPDatabase> {
  if (!assetDbPromise) {
    assetDbPromise = openDB(ASSET_DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
          db.createObjectStore(ASSET_STORE_NAME);
        }
      },
    });
  }
  return assetDbPromise;
}

async function readStaticImageAsset(): Promise<string | undefined> {
  try {
    const db = await getAssetDb();
    const image = await db.get(ASSET_STORE_NAME, STATIC_IMAGE_KEY);
    if (typeof image === 'string' && image) return image;
  } catch {
    // Fall through to the legacy localStorage migration path below.
  }

  const legacyImage = localStorage.getItem(STATIC_IMAGE_LOCAL_STORAGE_KEY);
  if (!legacyImage) return undefined;

  try {
    await writeStaticImageAsset(legacyImage);
    localStorage.removeItem(STATIC_IMAGE_LOCAL_STORAGE_KEY);
  } catch {
    // Keep the runtime readable for this session, but do not write new large assets to localStorage.
  }
  return legacyImage;
}

async function writeStaticImageAsset(image: string): Promise<string> {
  try {
    const asset = await saveImageAssetFromDataUrl(image, {
      kind: 'wallpaper',
      maxSide: 1920,
      quality: 0.86,
    });
    return asset.id;
  } catch (error) {
    throw new Error(`Failed to save wallpaper asset to IndexedDB: ${(error as Error).message}`);
  }
}

async function deleteStaticImageAsset(assetId?: string): Promise<void> {
  try {
    if (assetId) await deleteMediaAsset(assetId);
    const db = await getAssetDb();
    await db.delete(ASSET_STORE_NAME, STATIC_IMAGE_KEY);
  } finally {
    localStorage.removeItem(STATIC_IMAGE_LOCAL_STORAGE_KEY);
    if (staticImageObjectUrl) {
      URL.revokeObjectURL(staticImageObjectUrl);
      staticImageObjectUrl = undefined;
    }
  }
}

async function createStaticImageUrl(assetId: string | undefined): Promise<string | undefined> {
  if (!assetId) return undefined;
  const blob = await readMediaAssetBlob(assetId);
  if (!blob) return undefined;
  if (staticImageObjectUrl) URL.revokeObjectURL(staticImageObjectUrl);
  staticImageObjectUrl = URL.createObjectURL(blob);
  return staticImageObjectUrl;
}

async function saveConfig(config: BackgroundConfig): Promise<void> {
  const persistedConfig = stripStaticImage(config);
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    await browser.storage.local.set({ [STORAGE_KEY]: persistedConfig });
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedConfig));
  }
}

async function loadConfig(): Promise<BackgroundConfig> {
  let storedConfig: Partial<BackgroundConfig> | null = null;
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    const result = await browser.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) storedConfig = result[STORAGE_KEY] as BackgroundConfig;
  } else {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) storedConfig = JSON.parse(stored) as BackgroundConfig;
  }

  let config = normalizeBackgroundConfig(storedConfig);
  logStartupDebug('background:config:loaded-persisted', {
    hasStoredConfig: Boolean(storedConfig),
    mode: config.mode,
    generativeType: config.generativeType || null,
    staticImageAssetId: config.staticImageAssetId || null,
    hasLegacyStaticImage: Boolean(storedConfig?.staticImage),
    blur: config.blur,
    brightness: config.brightness,
  });
  if (typeof storedConfig?.staticImage === 'string' && storedConfig.staticImage) {
    try {
      const staticImageAssetId = await writeStaticImageAsset(storedConfig.staticImage);
      config = { ...config, staticImageAssetId };
    } catch {
      // If migration fails, still strip the large value from browser.storage.local.
    }
    await saveConfig(config);
  }

  if (!config.staticImageAssetId) {
    const legacyImage = await readStaticImageAsset();
    if (legacyImage) {
      try {
        const staticImageAssetId = await writeStaticImageAsset(legacyImage);
        config = { ...config, staticImageAssetId };
        await saveConfig(config);
      } catch {
        return { ...config, staticImage: legacyImage };
      }
    }
  }

  const staticImage = await createStaticImageUrl(config.staticImageAssetId);
  const result = staticImage ? { ...config, staticImage } : stripStaticImage(config);
  logStartupDebug('background:config:ready', {
    mode: result.mode,
    generativeType: result.generativeType || null,
    staticImageAssetId: result.staticImageAssetId || null,
    hasStaticImageUrl: Boolean(result.staticImage),
    blur: result.blur,
    brightness: result.brightness,
  });
  return result;
}

export const useBackgroundStore = create<BackgroundState>((set, get) => ({
  config: DEFAULT_BACKGROUND_CONFIG,
  loading: false,

  loadBackground: async () => {
    set({ loading: true });
    try {
      const config = await loadConfig();
      set({ config, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setMode: async (mode) => {
    const newConfig = { ...get().config, mode };
    set({ config: newConfig });
    await saveConfig(newConfig);
  },

  setGenerativeType: async (type) => {
    const newConfig = { ...get().config, generativeType: type };
    set({ config: newConfig });
    await saveConfig(newConfig);
  },

  setAnimationEnabled: async (enabled) => {
    const newConfig = { ...get().config, animationEnabled: enabled };
    set({ config: newConfig });
    await saveConfig(newConfig);
  },

  setFpsLimit: async (fps) => {
    const newConfig = { ...get().config, fpsLimit: Math.max(1, Math.min(60, fps)) };
    set({ config: newConfig });
    await saveConfig(newConfig);
  },

  setStaticImage: async (image) => {
    const previousAssetId = get().config.staticImageAssetId;
    if (image) {
      const staticImageAssetId = await writeStaticImageAsset(image);
      const staticImage = await createStaticImageUrl(staticImageAssetId);
      if (previousAssetId && previousAssetId !== staticImageAssetId) {
        await deleteMediaAsset(previousAssetId);
      }
      const newConfig = { ...get().config, staticImage, staticImageAssetId };
      set({ config: newConfig });
      await saveConfig(newConfig);
      return;
    }

    await deleteStaticImageAsset(previousAssetId);
    const newConfig = stripStaticImage(get().config);
    delete newConfig.staticImageAssetId;
    set({ config: newConfig });
    await saveConfig(newConfig);
  },

  setBlur: async (blur) => {
    const newConfig = { ...get().config, blur: Math.max(0, Math.min(20, blur)) };
    set({ config: newConfig });
    await saveConfig(newConfig);
  },

  setBrightness: async (brightness) => {
    const newConfig = { ...get().config, brightness: Math.max(0.1, Math.min(3, brightness)) };
    set({ config: newConfig });
    await saveConfig(newConfig);
  },
}));
