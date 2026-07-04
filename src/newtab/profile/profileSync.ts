import { create } from 'zustand';
import type {
  AppSettings,
  BackgroundConfig,
  LayoutConfig,
  PersistedState,
  ThemeDefinition,
} from '../../types';
import { normalizeBackgroundConfig, useBackgroundStore } from '../stores/backgroundStore';
import { normalizeLayoutConfig, useLayoutStore } from '../stores/layoutStore';
import { normalizeSettings, useSettingsStore } from '../stores/settingsStore';
import { normalizeTheme, PRESET_THEMES, useThemeStore } from '../stores/themeStore';
import { createPersistedGridState, normalizePersistedGridState, useTileStore } from '../stores/tilesStore';
import { PROFILE_STORAGE_KEYS, writeLocalStorageValues } from './profileTransfer';

/**
 * Optional cross-device sync of the light profile through Firefox Sync
 * (`browser.storage.sync`). Media assets never fit the sync quota, so custom
 * images and wallpapers stay local; everything else (tiles, folders, layout,
 * theme definitions, settings) is synced as chunked JSON.
 *
 * Conflict policy is last-write-wins by the `updatedAt` stamp in the meta key.
 */

const SYNC_SCHEMA_VERSION = 1;
const SYNC_META_KEY = 'fasp.sync.meta';
const SYNC_CHUNK_KEY_PREFIX = 'fasp.sync.data.';
const SYNC_ENABLED_KEY = 'fasp.sync.enabled';
const SYNC_DEVICE_KEY = 'fasp.sync.deviceId';
const SYNC_RUNTIME_KEY = 'fasp.sync.runtime';
// Firefox limits each storage.sync item to 8 KB and the whole area to 100 KB.
const SYNC_CHUNK_SIZE = 6500;
const SYNC_MAX_PAYLOAD_CHARS = 88000;
const PUSH_DEBOUNCE_MS = 1800;

interface SyncMeta {
  schemaVersion: number;
  updatedAt: number;
  deviceId: string;
  chunkCount: number;
}

interface SyncPayload {
  settings: AppSettings;
  layout: LayoutConfig;
  theme: {
    schemaVersion: 1;
    activeThemeId: string;
    customThemes: ThemeDefinition[];
  };
  background: BackgroundConfig;
  tiles: PersistedState;
}

export type ProfileSyncStatus =
  | 'unavailable'
  | 'disabled'
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'too-large'
  | 'error';

interface ProfileSyncState {
  enabled: boolean;
  status: ProfileSyncStatus;
  lastSyncedAt: number | null;
  message: string | null;

  initialize: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  syncNow: () => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function syncAreaAvailable(): boolean {
  return typeof browser !== 'undefined' && Boolean(browser.storage?.sync);
}

async function readLocalValue(key: string): Promise<unknown> {
  try {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      const result = await browser.storage.local.get(key);
      return result[key];
    }
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

async function writeLocalValue(key: string, value: unknown): Promise<void> {
  try {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      await browser.storage.local.set({ [key]: value });
      return;
    }
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sync bookkeeping is best effort.
  }
}

async function getDeviceId(): Promise<string> {
  const stored = await readLocalValue(SYNC_DEVICE_KEY);
  if (typeof stored === 'string' && stored) return stored;
  const deviceId = crypto.randomUUID();
  await writeLocalValue(SYNC_DEVICE_KEY, deviceId);
  return deviceId;
}

async function readLastSyncedAt(): Promise<number> {
  const runtime = await readLocalValue(SYNC_RUNTIME_KEY);
  return isRecord(runtime) && typeof runtime.lastSyncedAt === 'number' ? runtime.lastSyncedAt : 0;
}

async function writeLastSyncedAt(lastSyncedAt: number): Promise<void> {
  await writeLocalValue(SYNC_RUNTIME_KEY, { lastSyncedAt });
}

function stripThemeAssets(theme: ThemeDefinition): ThemeDefinition {
  if (theme.background.style !== 'static' && !theme.background.staticImageAssetId) return theme;
  return {
    ...theme,
    background: {
      ...theme.background,
      // Wallpaper blobs stay on the source device; fall back to the gradient.
      style: theme.background.style === 'static' ? 'gradient' : theme.background.style,
      staticImageAssetId: undefined,
    },
  };
}

function stripBackgroundAssets(config: BackgroundConfig): BackgroundConfig {
  const next = { ...config };
  delete next.staticImage;
  delete next.staticImageAssetId;
  return next;
}

function stripHeavyTileFields(persisted: PersistedState): PersistedState {
  for (const item of Object.values(persisted.state.items)) {
    // Inline images are far too large for the sync quota; asset ids are kept
    // so the source device keeps rendering them.
    if (typeof item.customImage === 'string' && item.customImage.startsWith('data:')) {
      delete item.customImage;
    }
    if (typeof item.thumbnail === 'string' && item.thumbnail.startsWith('data:')) {
      delete item.thumbnail;
    }
    if (typeof item.favicon === 'string' && item.favicon.startsWith('data:')) {
      delete item.favicon;
    }
    delete item.previewImage;
  }
  return persisted;
}

function buildSyncPayload(): SyncPayload {
  const themeState = useThemeStore.getState();
  return {
    settings: normalizeSettings(useSettingsStore.getState().settings),
    layout: normalizeLayoutConfig(useLayoutStore.getState().config),
    theme: {
      schemaVersion: 1,
      activeThemeId: themeState.activeThemeId,
      customThemes: themeState.customThemes.map((theme) => stripThemeAssets(normalizeTheme(theme))),
    },
    background: stripBackgroundAssets(normalizeBackgroundConfig(useBackgroundStore.getState().config)),
    tiles: stripHeavyTileFields(createPersistedGridState(useTileStore.getState().appState)),
  };
}

function normalizeRemotePayload(raw: unknown): SyncPayload {
  if (!isRecord(raw)) throw new Error('Некорректные данные синхронизации');

  const themeRaw = isRecord(raw.theme) ? raw.theme : {};
  const customThemes = Array.isArray(themeRaw.customThemes)
    ? themeRaw.customThemes.map((theme) => normalizeTheme(theme))
    : [];
  const activeThemeId = typeof themeRaw.activeThemeId === 'string' && themeRaw.activeThemeId.trim()
    ? themeRaw.activeThemeId.trim()
    : PRESET_THEMES[0].id;

  return {
    settings: normalizeSettings(raw.settings as Partial<AppSettings>),
    layout: normalizeLayoutConfig(raw.layout as Partial<LayoutConfig>),
    theme: { schemaVersion: 1, activeThemeId, customThemes },
    background: stripBackgroundAssets(normalizeBackgroundConfig(raw.background as Partial<BackgroundConfig>)),
    tiles: normalizePersistedGridState(raw.tiles),
  };
}

function parseSyncMeta(value: unknown): SyncMeta | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== SYNC_SCHEMA_VERSION) return null;
  if (typeof value.updatedAt !== 'number' || typeof value.deviceId !== 'string') return null;
  const chunkCount = typeof value.chunkCount === 'number' ? value.chunkCount : 0;
  if (chunkCount < 1) return null;
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    updatedAt: value.updatedAt,
    deviceId: value.deviceId,
    chunkCount,
  };
}

async function readRemote(): Promise<{ meta: SyncMeta; payload: SyncPayload } | null> {
  const metaResult = await browser.storage.sync.get(SYNC_META_KEY);
  const meta = parseSyncMeta(metaResult[SYNC_META_KEY]);
  if (!meta) return null;

  const chunkKeys = Array.from({ length: meta.chunkCount }, (_, index) => `${SYNC_CHUNK_KEY_PREFIX}${index}`);
  const chunksResult = await browser.storage.sync.get(chunkKeys);
  let json = '';
  for (const key of chunkKeys) {
    const chunk = chunksResult[key];
    if (typeof chunk !== 'string') return null;
    json += chunk;
  }

  return { meta, payload: normalizeRemotePayload(JSON.parse(json)) };
}

async function applyRemotePayload(payload: SyncPayload): Promise<void> {
  await writeLocalStorageValues({
    [PROFILE_STORAGE_KEYS.settings]: payload.settings,
    [PROFILE_STORAGE_KEYS.layout]: payload.layout,
    [PROFILE_STORAGE_KEYS.theme]: payload.theme,
    [PROFILE_STORAGE_KEYS.background]: payload.background,
    [PROFILE_STORAGE_KEYS.tiles]: payload.tiles,
  });

  await Promise.all([
    useSettingsStore.getState().loadSettings(),
    useLayoutStore.getState().loadLayout(),
    useThemeStore.getState().loadTheme(),
    useBackgroundStore.getState().loadBackground(),
    useTileStore.getState().loadTiles(),
  ]);
}

let deviceIdPromise: Promise<string> | null = null;
let listenersAttached = false;
let applyingRemote = false;
let pushTimer: number | null = null;
let lastSyncedJson: string | null = null;
let syncQueue: Promise<void> = Promise.resolve();

function enqueueSyncTask(task: () => Promise<void>): Promise<void> {
  syncQueue = syncQueue.then(task, task);
  return syncQueue;
}

function resolveDeviceId(): Promise<string> {
  if (!deviceIdPromise) deviceIdPromise = getDeviceId();
  return deviceIdPromise;
}

export const useProfileSyncStore = create<ProfileSyncState>((set, get) => {
  const pushLocalPayload = async (): Promise<void> => {
    const json = JSON.stringify(buildSyncPayload());
    if (json === lastSyncedJson) {
      set({ status: 'synced' });
      return;
    }
    if (json.length > SYNC_MAX_PAYLOAD_CHARS) {
      set({
        status: 'too-large',
        message: 'Профиль слишком большой для Firefox Sync (лимит около 100 КБ). Уменьшите число плиток или используйте экспорт в файл.',
      });
      return;
    }

    const deviceId = await resolveDeviceId();
    const previousMeta = parseSyncMeta((await browser.storage.sync.get(SYNC_META_KEY))[SYNC_META_KEY]);
    const chunks: string[] = [];
    for (let offset = 0; offset < json.length; offset += SYNC_CHUNK_SIZE) {
      chunks.push(json.slice(offset, offset + SYNC_CHUNK_SIZE));
    }

    const meta: SyncMeta = {
      schemaVersion: SYNC_SCHEMA_VERSION,
      updatedAt: Date.now(),
      deviceId,
      chunkCount: chunks.length,
    };
    const values: Record<string, unknown> = { [SYNC_META_KEY]: meta };
    chunks.forEach((chunk, index) => {
      values[`${SYNC_CHUNK_KEY_PREFIX}${index}`] = chunk;
    });

    await browser.storage.sync.set(values);
    if (previousMeta && previousMeta.chunkCount > chunks.length) {
      const staleKeys = Array.from(
        { length: previousMeta.chunkCount - chunks.length },
        (_, index) => `${SYNC_CHUNK_KEY_PREFIX}${chunks.length + index}`
      );
      await browser.storage.sync.remove(staleKeys);
    }

    lastSyncedJson = json;
    await writeLastSyncedAt(meta.updatedAt);
    set({ status: 'synced', lastSyncedAt: meta.updatedAt, message: null });
  };

  const applyRemoteIfNewer = async (): Promise<boolean> => {
    const remote = await readRemote();
    if (!remote) return false;
    const lastSyncedAt = await readLastSyncedAt();
    if (remote.meta.updatedAt <= lastSyncedAt) return false;

    applyingRemote = true;
    try {
      await applyRemotePayload(remote.payload);
      lastSyncedJson = JSON.stringify(buildSyncPayload());
    } finally {
      applyingRemote = false;
    }
    await writeLastSyncedAt(remote.meta.updatedAt);
    set({ status: 'synced', lastSyncedAt: remote.meta.updatedAt, message: null });
    return true;
  };

  const reconcile = async (): Promise<void> => {
    if (!get().enabled || !syncAreaAvailable()) return;
    set({ status: 'syncing', message: null });
    try {
      const applied = await applyRemoteIfNewer();
      if (!applied) await pushLocalPayload();
    } catch (error) {
      set({
        status: 'error',
        message: error instanceof Error ? error.message : 'Не удалось синхронизировать профиль.',
      });
    }
  };

  const schedulePush = (): void => {
    if (!get().enabled || applyingRemote || !syncAreaAvailable()) return;
    if (pushTimer !== null) window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => {
      pushTimer = null;
      void enqueueSyncTask(async () => {
        if (!get().enabled || applyingRemote) return;
        set({ status: 'syncing' });
        try {
          await pushLocalPayload();
        } catch (error) {
          set({
            status: 'error',
            message: error instanceof Error ? error.message : 'Не удалось отправить профиль в Firefox Sync.',
          });
        }
      });
    }, PUSH_DEBOUNCE_MS);
  };

  const attachListeners = (): void => {
    if (listenersAttached) return;
    listenersAttached = true;

    useSettingsStore.subscribe((state, previous) => {
      if (state.settings !== previous.settings) schedulePush();
    });
    useLayoutStore.subscribe((state, previous) => {
      if (state.config !== previous.config) schedulePush();
    });
    useBackgroundStore.subscribe((state, previous) => {
      if (state.config !== previous.config) schedulePush();
    });
    useThemeStore.subscribe((state, previous) => {
      if (state.activeThemeId !== previous.activeThemeId || state.customThemes !== previous.customThemes) {
        schedulePush();
      }
    });
    useTileStore.subscribe((state, previous) => {
      if (state.appState !== previous.appState && !state.loading) schedulePush();
    });

    if (typeof browser !== 'undefined' && browser.storage?.onChanged) {
      browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'sync' || !changes[SYNC_META_KEY] || !get().enabled) return;
        const meta = parseSyncMeta(changes[SYNC_META_KEY].newValue);
        if (!meta) return;
        void enqueueSyncTask(async () => {
          const deviceId = await resolveDeviceId();
          if (meta.deviceId === deviceId) return;
          try {
            await applyRemoteIfNewer();
          } catch {
            // A later change or manual sync retries this.
          }
        });
      });
    }
  };

  return {
    enabled: false,
    status: 'idle',
    lastSyncedAt: null,
    message: null,

    initialize: async () => {
      if (!syncAreaAvailable()) {
        set({ status: 'unavailable' });
        return;
      }

      const [enabled, lastSyncedAt] = await Promise.all([
        readLocalValue(SYNC_ENABLED_KEY),
        readLastSyncedAt(),
      ]);
      const isEnabled = enabled === true;
      set({
        enabled: isEnabled,
        status: isEnabled ? 'idle' : 'disabled',
        lastSyncedAt: lastSyncedAt || null,
      });
      attachListeners();
      if (isEnabled) await enqueueSyncTask(reconcile);
    },

    setEnabled: async (enabled: boolean) => {
      if (!syncAreaAvailable()) {
        set({ status: 'unavailable', enabled: false });
        return;
      }
      await writeLocalValue(SYNC_ENABLED_KEY, enabled);
      set({ enabled, status: enabled ? 'idle' : 'disabled', message: null });
      attachListeners();
      if (enabled) await enqueueSyncTask(reconcile);
    },

    syncNow: async () => {
      await enqueueSyncTask(reconcile);
    },
  };
});
