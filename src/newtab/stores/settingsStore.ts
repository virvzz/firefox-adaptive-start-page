import { create } from 'zustand';
import type { AppSettings } from '../../types';

interface SettingsState {
  settings: AppSettings;
  loading: boolean;

  loadSettings: () => Promise<void>;
  setBorderRadiusDefault: (value: number) => Promise<void>;
  setTileOpacityDefault: (value: number) => Promise<void>;
  setShowSearchBar: (show: boolean) => Promise<void>;
  setShowClock: (show: boolean) => Promise<void>;
  setShowWeather: (show: boolean) => Promise<void>;
  setWeatherLocation: (location: string) => Promise<void>;
  setWeatherDisplayMode: (mode: AppSettings['weatherDisplayMode']) => Promise<void>;
  setShowPerformanceMonitor: (show: boolean) => Promise<void>;
  setInfoCardTransparency: (transparency: number) => Promise<void>;
  setShowPopularTabsButton: (show: boolean) => Promise<void>;
  setShowRecentlyClosedTabsButton: (show: boolean) => Promise<void>;
  setOptimizeMediaAssets: (enabled: boolean) => Promise<void>;
  setSearchBarWidth: (width: number) => Promise<void>;
  setSearchResultLimit: (limit: number) => Promise<void>;
  setBookmarkFolderMode: (mode: AppSettings['bookmarkFolderMode']) => Promise<void>;
  setShowFolderItemCount: (show: boolean) => Promise<void>;
  setShowFolderModeBadge: (show: boolean) => Promise<void>;
  setTileVisualMode: (mode: AppSettings['tileVisualMode']) => Promise<void>;
  setTileLabelMode: (mode: AppSettings['tileLabelMode']) => Promise<void>;
  setFolderViewMode: (mode: AppSettings['folderViewMode']) => Promise<void>;
  setContextMenuFocusMode: (mode: AppSettings['contextMenuFocusMode']) => Promise<void>;
  setTileOpenTarget: (target: AppSettings['tileOpenTarget']) => Promise<void>;
  resetSettings: () => Promise<void>;
}

const STORAGE_KEY = 'fasp-settings';
export const DEFAULT_SETTINGS: AppSettings = {
  borderRadiusDefault: 12,
  tileOpacityDefault: 0.9,
  showSearchBar: false,
  showClock: false,
  showWeather: false,
  weatherLocation: '',
  weatherDisplayMode: 'inline',
  showPerformanceMonitor: false,
  infoCardTransparency: 0.32,
  showPopularTabsButton: false,
  showRecentlyClosedTabsButton: false,
  optimizeMediaAssets: false,
  searchBarWidth: 60,
  searchResultLimit: 50,
  bookmarkFolderMode: 'reference',
  showFolderItemCount: true,
  showFolderModeBadge: true,
  tileVisualMode: 'mixed',
  tileLabelMode: 'compact',
  folderViewMode: 'grid',
  contextMenuFocusMode: 'folder-only',
  tileOpenTarget: 'current-tab',
};

async function saveSettings(settings: AppSettings): Promise<void> {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    await browser.storage.local.set({ [STORAGE_KEY]: settings });
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }
}

function clearWeatherCache(): void {
  if (typeof localStorage === 'undefined') return;

  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('fasp-weather:')) localStorage.removeItem(key);
  }
}

export function normalizeSettings(raw: Partial<AppSettings> | Record<string, unknown> | null | undefined): AppSettings {
  const source = raw || {};
  const normalized = { ...DEFAULT_SETTINGS };

  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>) {
    if (key in source) {
      normalized[key] = source[key] as never;
    }
  }

  if (normalized.weatherDisplayMode !== 'inline' && normalized.weatherDisplayMode !== 'card') {
    normalized.weatherDisplayMode = 'inline';
  }

  normalized.showPopularTabsButton = typeof source.showPopularTabsButton === 'boolean'
    ? source.showPopularTabsButton
    : DEFAULT_SETTINGS.showPopularTabsButton;
  normalized.showRecentlyClosedTabsButton = typeof source.showRecentlyClosedTabsButton === 'boolean'
    ? source.showRecentlyClosedTabsButton
    : DEFAULT_SETTINGS.showRecentlyClosedTabsButton;
  normalized.showFolderItemCount = typeof source.showFolderItemCount === 'boolean'
    ? source.showFolderItemCount
    : DEFAULT_SETTINGS.showFolderItemCount;
  normalized.showFolderModeBadge = typeof source.showFolderModeBadge === 'boolean'
    ? source.showFolderModeBadge
    : DEFAULT_SETTINGS.showFolderModeBadge;

  if (!['favicon', 'thumbnail', 'mixed'].includes(String(normalized.tileVisualMode))) {
    normalized.tileVisualMode = DEFAULT_SETTINGS.tileVisualMode;
  }
  if (!['full', 'compact'].includes(String(normalized.tileLabelMode))) {
    normalized.tileLabelMode = DEFAULT_SETTINGS.tileLabelMode;
  }
  if (!['grid', 'list'].includes(String(normalized.folderViewMode))) {
    normalized.folderViewMode = DEFAULT_SETTINGS.folderViewMode;
  }
  if (!['folder-only', 'always', 'off'].includes(String(normalized.contextMenuFocusMode))) {
    normalized.contextMenuFocusMode = DEFAULT_SETTINGS.contextMenuFocusMode;
  }
  if (!['current-tab', 'new-tab', 'new-window'].includes(String(normalized.tileOpenTarget))) {
    normalized.tileOpenTarget = DEFAULT_SETTINGS.tileOpenTarget;
  }

  if ('infoCardTransparency' in source) {
    normalized.infoCardTransparency = Number.isFinite(Number(normalized.infoCardTransparency))
      ? Math.max(0, Math.min(1, Number(normalized.infoCardTransparency)))
      : DEFAULT_SETTINGS.infoCardTransparency;
  } else if ('infoCardOpacity' in source) {
    const legacyOpacity = Number((source as Record<string, unknown>).infoCardOpacity);
    normalized.infoCardTransparency = Number.isFinite(legacyOpacity)
      ? 1 - Math.max(0, Math.min(1, legacyOpacity))
      : DEFAULT_SETTINGS.infoCardTransparency;
  }

  return normalized;
}

async function loadSettings(): Promise<AppSettings> {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    const result = await browser.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) return normalizeSettings(result[STORAGE_KEY] as Record<string, unknown>);
  } else {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizeSettings(JSON.parse(stored) as Record<string, unknown>);
  }
  return DEFAULT_SETTINGS;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loading: false,

  loadSettings: async () => {
    set({ loading: true });
    try {
      const settings = await loadSettings();
      set({ settings, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setBorderRadiusDefault: async (value) => {
    const newSettings = { ...get().settings, borderRadiusDefault: Math.max(0, Math.min(96, value)) };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setTileOpacityDefault: async (value) => {
    const newSettings = { ...get().settings, tileOpacityDefault: value };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setShowSearchBar: async (show) => {
    const newSettings = { ...get().settings, showSearchBar: show };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setShowClock: async (show) => {
    const newSettings = { ...get().settings, showClock: show };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setShowWeather: async (show) => {
    const newSettings = { ...get().settings, showWeather: show };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setWeatherLocation: async (location) => {
    const normalizedLocation = location.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (normalizedLocation !== get().settings.weatherLocation) clearWeatherCache();
    const newSettings = { ...get().settings, weatherLocation: normalizedLocation };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setWeatherDisplayMode: async (mode) => {
    const newSettings = { ...get().settings, weatherDisplayMode: mode };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setShowPerformanceMonitor: async (show) => {
    const newSettings = { ...get().settings, showPerformanceMonitor: show };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setInfoCardTransparency: async (transparency) => {
    const normalizedTransparency = Math.max(
      0,
      Math.min(1, Number.isFinite(transparency) ? transparency : DEFAULT_SETTINGS.infoCardTransparency)
    );
    const newSettings = { ...get().settings, infoCardTransparency: normalizedTransparency };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setShowPopularTabsButton: async (show) => {
    const newSettings = { ...get().settings, showPopularTabsButton: show };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setShowRecentlyClosedTabsButton: async (show) => {
    const newSettings = { ...get().settings, showRecentlyClosedTabsButton: show };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setOptimizeMediaAssets: async (enabled) => {
    const newSettings = { ...get().settings, optimizeMediaAssets: enabled };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setSearchBarWidth: async (width) => {
    const newSettings = { ...get().settings, searchBarWidth: Math.max(20, Math.min(100, width)) };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setSearchResultLimit: async (limit) => {
    const normalizedLimit = Math.max(5, Math.min(100, Math.round(limit)));
    const newSettings = { ...get().settings, searchResultLimit: normalizedLimit };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setBookmarkFolderMode: async (mode) => {
    const newSettings = { ...get().settings, bookmarkFolderMode: mode };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setShowFolderItemCount: async (show) => {
    const newSettings = { ...get().settings, showFolderItemCount: show };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setShowFolderModeBadge: async (show) => {
    const newSettings = { ...get().settings, showFolderModeBadge: show };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setTileVisualMode: async (mode) => {
    const normalizedMode = mode === 'favicon' || mode === 'thumbnail' || mode === 'mixed'
      ? mode
      : DEFAULT_SETTINGS.tileVisualMode;
    const newSettings = { ...get().settings, tileVisualMode: normalizedMode };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setTileLabelMode: async (mode) => {
    const normalizedMode = mode === 'full' || mode === 'compact'
      ? mode
      : DEFAULT_SETTINGS.tileLabelMode;
    const newSettings = { ...get().settings, tileLabelMode: normalizedMode };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setFolderViewMode: async (mode) => {
    const normalizedMode = mode === 'grid' || mode === 'list'
      ? mode
      : DEFAULT_SETTINGS.folderViewMode;
    const newSettings = { ...get().settings, folderViewMode: normalizedMode };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setContextMenuFocusMode: async (mode) => {
    const normalizedMode = mode === 'folder-only' || mode === 'always' || mode === 'off'
      ? mode
      : DEFAULT_SETTINGS.contextMenuFocusMode;
    const newSettings = { ...get().settings, contextMenuFocusMode: normalizedMode };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  setTileOpenTarget: async (target) => {
    const normalizedTarget = target === 'current-tab' || target === 'new-tab' || target === 'new-window'
      ? target
      : DEFAULT_SETTINGS.tileOpenTarget;
    const newSettings = { ...get().settings, tileOpenTarget: normalizedTarget };
    set({ settings: newSettings });
    await saveSettings(newSettings);
  },

  resetSettings: async () => {
    const defaults: AppSettings = DEFAULT_SETTINGS;
    set({ settings: defaults });
    await saveSettings(defaults);
  },
}));
