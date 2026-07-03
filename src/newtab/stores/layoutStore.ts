import { create } from 'zustand';
import type { LayoutConfig } from '../../types';

interface LayoutState {
  config: LayoutConfig;
  loading: boolean;

  loadLayout: () => Promise<void>;
  setColumns: (columns: number) => Promise<void>;
  setFolderColumns: (columns: number) => Promise<void>;
  setSpacing: (spacing: number) => Promise<void>;
}

const STORAGE_KEY = 'fasp-layout';
export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = { columns: 6, folderColumns: 6, spacing: 12 };

export function normalizeLayoutConfig(raw: Partial<LayoutConfig> | null | undefined): LayoutConfig {
  return {
    columns: Math.max(2, Math.min(12, Math.round(Number(raw?.columns ?? DEFAULT_LAYOUT_CONFIG.columns)))),
    folderColumns: Math.max(2, Math.min(12, Math.round(Number(raw?.folderColumns ?? Math.min(Number(raw?.columns ?? DEFAULT_LAYOUT_CONFIG.columns), 6))))),
    spacing: Math.max(4, Math.min(40, Math.round(Number(raw?.spacing ?? DEFAULT_LAYOUT_CONFIG.spacing)))),
  };
}

async function saveToStorage(config: LayoutConfig): Promise<void> {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    await browser.storage.local.set({ [STORAGE_KEY]: config });
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }
}

async function loadFromStorage(): Promise<LayoutConfig> {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    const result = await browser.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) return normalizeLayoutConfig(result[STORAGE_KEY] as Partial<LayoutConfig>);
  } else {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizeLayoutConfig(JSON.parse(stored) as Partial<LayoutConfig>);
  }
  return DEFAULT_LAYOUT_CONFIG;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  config: DEFAULT_LAYOUT_CONFIG,
  loading: false,

  loadLayout: async () => {
    set({ loading: true });
    try {
      const config = await loadFromStorage();
      set({ config, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setColumns: async (columns: number) => {
    const clamped = Math.max(2, Math.min(12, columns));
    const newConfig = { ...get().config, columns: clamped };
    set({ config: newConfig });
    await saveToStorage(newConfig);
  },

  setFolderColumns: async (columns: number) => {
    const clamped = Math.max(2, Math.min(12, columns));
    const newConfig = { ...get().config, folderColumns: clamped };
    set({ config: newConfig });
    await saveToStorage(newConfig);
  },

  setSpacing: async (spacing: number) => {
    const clamped = Math.max(4, Math.min(40, spacing));
    const newConfig = { ...get().config, spacing: clamped };
    set({ config: newConfig });
    await saveToStorage(newConfig);
  },
}));
