import type { AppSettings, BackgroundConfig, LayoutConfig, PersistedState, ThemeDefinition } from '../../types';
import { normalizeBackgroundConfig, useBackgroundStore } from '../stores/backgroundStore';
import { normalizeLayoutConfig, useLayoutStore } from '../stores/layoutStore';
import { normalizeSettings, useSettingsStore } from '../stores/settingsStore';
import { normalizeTheme, PRESET_THEMES, useThemeStore } from '../stores/themeStore';
import { createPersistedGridState, normalizePersistedGridState, useTileStore } from '../stores/tilesStore';
import {
  blobToDataUrl,
  dataUrlToBlob,
  readMediaAsset,
  writeMediaAssetRecord,
  type MediaAssetRecord,
} from '../media/mediaAssets';

const PROFILE_SCHEMA_VERSION = 1;
const APP_NAME = 'Adaptive Start Page';
const APP_VERSION = '0.1.4';
const SURFACE_MODE_KEY = 'fasp.ui.surfaceMode';

const STORAGE_KEYS = {
  settings: 'fasp-settings',
  layout: 'fasp-layout',
  theme: 'fasp-theme-engine',
  background: 'fasp-background',
  tiles: 'fasp.grid-state',
} as const;

type UiSurfaceMode = 'modern' | 'legacy';

interface PersistedThemeState {
  schemaVersion: 1;
  activeThemeId: string;
  customThemes: ThemeDefinition[];
}

interface ProfileData {
  settings: AppSettings;
  layout: LayoutConfig;
  theme: PersistedThemeState;
  background: BackgroundConfig;
  tiles: PersistedState;
  uiSurfaceMode: UiSurfaceMode;
}

interface SerializedMediaAsset {
  id: string;
  kind: MediaAssetRecord['kind'];
  mimeType: string;
  width: number;
  height: number;
  createdAt: number;
  originalBytes?: number;
  dataUrl: string;
}

interface FaspProfile {
  profile: 'adaptive-start-page';
  schemaVersion: 1;
  appName: typeof APP_NAME;
  appVersion: string;
  exportedAt: string;
  data: ProfileData;
  mediaAssets: SerializedMediaAsset[];
}

export interface ProfileTransferSummary {
  tileCount: number;
  folderCount: number;
  customThemeCount: number;
  mediaAssetCount: number;
  hasStaticWallpaper: boolean;
}

export interface ExportedProfile {
  json: string;
  filename: string;
  summary: ProfileTransferSummary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readSurfaceMode(): UiSurfaceMode {
  try {
    return localStorage.getItem(SURFACE_MODE_KEY) === 'legacy' ? 'legacy' : 'modern';
  } catch {
    return 'modern';
  }
}

function writeSurfaceMode(mode: UiSurfaceMode): void {
  try {
    localStorage.setItem(SURFACE_MODE_KEY, mode);
    document.documentElement.classList.toggle('fasp-modern-surfaces', mode === 'modern');
  } catch {
    // Surface mode is best effort and should not block the profile import.
  }
}

function getProfileFilename(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `adaptive-start-page-profile-${timestamp}.json`;
}

function sanitizeBackgroundConfig(config: Partial<BackgroundConfig> | null | undefined): BackgroundConfig {
  const normalized = normalizeBackgroundConfig(config);
  const { staticImage: _staticImage, ...persisted } = normalized;
  return persisted;
}

function normalizeThemeState(raw: unknown): PersistedThemeState {
  if (!isRecord(raw)) throw new Error('Invalid profile theme state');
  const customThemes = Array.isArray(raw.customThemes)
    ? raw.customThemes.map((theme) => normalizeTheme(theme))
    : [];
  const activeThemeId = typeof raw.activeThemeId === 'string' && raw.activeThemeId.trim()
    ? raw.activeThemeId.trim()
    : PRESET_THEMES[0].id;

  return {
    schemaVersion: 1,
    activeThemeId,
    customThemes,
  };
}

function normalizeSurfaceMode(value: unknown): UiSurfaceMode {
  return value === 'legacy' ? 'legacy' : 'modern';
}

function normalizeMediaAsset(raw: unknown): SerializedMediaAsset | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const dataUrl = typeof raw.dataUrl === 'string' ? raw.dataUrl : '';
  if (!/^[a-z0-9:_-]{3,180}$/i.test(id) || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
    return null;
  }

  const kind = raw.kind === 'tile-image' || raw.kind === 'wallpaper' || raw.kind === 'generic'
    ? raw.kind
    : 'generic';
  const mimeType = typeof raw.mimeType === 'string' && raw.mimeType.startsWith('image/')
    ? raw.mimeType
    : dataUrl.match(/^data:([^;]+);/i)?.[1] || 'image/webp';

  return {
    id,
    kind,
    mimeType,
    width: Math.max(1, Math.round(Number(raw.width) || 1)),
    height: Math.max(1, Math.round(Number(raw.height) || 1)),
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
    originalBytes: Number.isFinite(Number(raw.originalBytes)) ? Number(raw.originalBytes) : undefined,
    dataUrl,
  };
}

function normalizeProfile(raw: unknown): FaspProfile {
  if (!isRecord(raw)) throw new Error('Profile file must contain a JSON object');
  if (raw.profile !== 'adaptive-start-page' || raw.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    throw new Error('Unsupported profile format');
  }
  if (!isRecord(raw.data)) throw new Error('Profile data is missing');

  const data = raw.data;
  const mediaAssets = Array.isArray(raw.mediaAssets)
    ? raw.mediaAssets.map(normalizeMediaAsset).filter((asset): asset is SerializedMediaAsset => Boolean(asset))
    : [];

  return {
    profile: 'adaptive-start-page',
    schemaVersion: PROFILE_SCHEMA_VERSION,
    appName: APP_NAME,
    appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : APP_VERSION,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date().toISOString(),
    data: {
      settings: normalizeSettings(data.settings as Partial<AppSettings>),
      layout: normalizeLayoutConfig(data.layout as Partial<LayoutConfig>),
      theme: normalizeThemeState(data.theme),
      background: sanitizeBackgroundConfig(data.background as Partial<BackgroundConfig>),
      tiles: normalizePersistedGridState(data.tiles),
      uiSurfaceMode: normalizeSurfaceMode(data.uiSurfaceMode),
    },
    mediaAssets,
  };
}

function collectReferencedAssetIds(data: ProfileData): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) ids.add(value.trim());
  };

  add(data.background.staticImageAssetId);
  for (const theme of data.theme.customThemes) add(theme.background.staticImageAssetId);
  for (const item of Object.values(data.tiles.state.items)) add(item.customImageAssetId);

  return [...ids];
}

async function serializeMediaAssets(assetIds: string[]): Promise<SerializedMediaAsset[]> {
  const assets: SerializedMediaAsset[] = [];
  for (const assetId of assetIds) {
    const record = await readMediaAsset(assetId);
    if (!record) continue;
    assets.push({
      id: record.id,
      kind: record.kind,
      mimeType: record.mimeType,
      width: record.width,
      height: record.height,
      createdAt: record.createdAt,
      originalBytes: record.originalBytes,
      dataUrl: await blobToDataUrl(record.blob),
    });
  }
  return assets;
}

async function writeLocalStorageValues(values: Record<string, unknown>): Promise<void> {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    await browser.storage.local.set(values);
    return;
  }

  for (const [key, value] of Object.entries(values)) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

function summarizeProfile(data: ProfileData, mediaAssetCount: number): ProfileTransferSummary {
  const items = Object.values(data.tiles.state.items);
  return {
    tileCount: items.filter((item) => item.type === 'tile').length,
    folderCount: items.filter((item) => item.type === 'folder').length,
    customThemeCount: data.theme.customThemes.length,
    mediaAssetCount,
    hasStaticWallpaper: Boolean(data.background.staticImageAssetId),
  };
}

export async function exportProfileJson(): Promise<ExportedProfile> {
  const settings = normalizeSettings(useSettingsStore.getState().settings);
  const layout = normalizeLayoutConfig(useLayoutStore.getState().config);
  const themeState: PersistedThemeState = {
    schemaVersion: 1,
    activeThemeId: useThemeStore.getState().activeThemeId,
    customThemes: useThemeStore.getState().customThemes.map((theme) => normalizeTheme(theme)),
  };
  const background = sanitizeBackgroundConfig(useBackgroundStore.getState().config);
  const tiles = createPersistedGridState(useTileStore.getState().appState);

  const data: ProfileData = {
    settings,
    layout,
    theme: themeState,
    background,
    tiles,
    uiSurfaceMode: readSurfaceMode(),
  };
  const mediaAssets = await serializeMediaAssets(collectReferencedAssetIds(data));
  const profile: FaspProfile = {
    profile: 'adaptive-start-page',
    schemaVersion: PROFILE_SCHEMA_VERSION,
    appName: APP_NAME,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
    mediaAssets,
  };

  return {
    json: JSON.stringify(profile, null, 2),
    filename: getProfileFilename(),
    summary: summarizeProfile(data, mediaAssets.length),
  };
}

export async function importProfileJson(rawJson: string): Promise<ProfileTransferSummary> {
  const profile = normalizeProfile(JSON.parse(rawJson) as unknown);

  for (const asset of profile.mediaAssets) {
    const blob = dataUrlToBlob(asset.dataUrl);
    await writeMediaAssetRecord({
      id: asset.id,
      kind: asset.kind,
      blob,
      mimeType: blob.type || asset.mimeType,
      width: asset.width,
      height: asset.height,
      createdAt: asset.createdAt,
      originalBytes: asset.originalBytes,
    });
  }

  await writeLocalStorageValues({
    [STORAGE_KEYS.settings]: profile.data.settings,
    [STORAGE_KEYS.layout]: profile.data.layout,
    [STORAGE_KEYS.theme]: profile.data.theme,
    [STORAGE_KEYS.background]: profile.data.background,
    [STORAGE_KEYS.tiles]: profile.data.tiles,
  });
  writeSurfaceMode(profile.data.uiSurfaceMode);

  await Promise.all([
    useSettingsStore.getState().loadSettings(),
    useLayoutStore.getState().loadLayout(),
    useThemeStore.getState().loadTheme(),
    useBackgroundStore.getState().loadBackground(),
    useTileStore.getState().loadTiles(),
  ]);

  return summarizeProfile(profile.data, profile.mediaAssets.length);
}
