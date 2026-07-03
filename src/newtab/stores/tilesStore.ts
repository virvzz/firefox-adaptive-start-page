import { create } from 'zustand';
import { openDB, IDBPDatabase } from 'idb';
import type {
  AppState,
  BookmarkFolderMode,
  Container,
  ContainerId,
  GridItem,
  GridItemId,
  PersistedState,
  SurfaceParentId,
  Tile,
} from '../../types';
import { GRID_SCHEMA_VERSION, ROOT_CONTAINER_ID } from '../../types';
import { getScreenshotThumbnailUrl } from '../../engines/tileAppearance';
import {
  getSurfaceItems,
  isSameSurface,
  normalizeParentId,
} from '../engines/surfaceInteractionEngine';
import {
  logTileDebug,
  setTileDebugSnapshotProvider,
  summarizeTile,
  summarizeTileOrder,
  summarizeTileTree,
} from '../../debug/tileDebug';
import {
  isImageDataUrl,
  readMediaAssetAsDataUrl,
  saveImageAssetFromDataUrl,
} from '../media/mediaAssets';
import { useSettingsStore } from './settingsStore';

const LEGACY_DB_NAME = 'fasp-tiles';
const LEGACY_STORE_NAME = 'tiles';
const STORAGE_KEY = 'fasp.grid-state';

let legacyDbPromise: Promise<IDBPDatabase> | null = null;

interface TilesState {
  appState: AppState;
  tiles: Tile[];
  loading: boolean;
  error: string | null;
  openFolderIds: string[];
  undoAction: UndoAction | null;

  loadTiles: () => Promise<void>;
  addTile: (tile: Tile) => Promise<void>;
  updateTile: (id: string, updates: Partial<Tile>) => Promise<void>;
  removeTile: (id: string) => Promise<void>;
  reorderTiles: (orderedIds: string[]) => Promise<void>;
  moveTile: (tileId: string, destinationParentId: SurfaceParentId) => Promise<void>;
  moveTileToFolder: (tileId: string, folderId: SurfaceParentId) => Promise<void>;
  createFolder: (sourceTileId: string, targetTileId: string) => Promise<Tile | null>;
  createFolderFromTiles: (sourceTileId: string, targetTileId: string) => Promise<Tile | null>;
  removeTileFromFolder: (tileId: string) => Promise<void>;
  pinTile: (id: string) => Promise<void>;
  unpinTile: (id: string) => Promise<void>;
  renameTile: (id: string, title: string) => Promise<void>;
  deleteTile: (id: string) => Promise<void>;
  undoLastAction: () => Promise<void>;
  openFolder: (folderId: string, surfaceLevel?: number) => void;
  closeFolder: (surfaceLevel?: number) => void;
  setDragState: (dragState: AppState['dragState']) => void;
  syncBookmarks: () => Promise<void>;
  importBookmarks: () => Promise<void>;
  listBookmarkFolders: () => Promise<BookmarkFolderOption[]>;
  addBookmarkFolder: (
    bookmarkFolderId: string,
    mode: BookmarkFolderMode,
    destinationParentId?: SurfaceParentId
  ) => Promise<Tile | null>;
  detachBookmarkReference: (id: string) => Promise<void>;
  applyAccentColorToAllTiles: (color: string) => Promise<{ updated: number }>;
  clearAccentColorFromAllTiles: () => Promise<{ updated: number }>;
  optimizeMediaAssets: () => Promise<{ optimized: number }>;
  restoreMediaAssets: () => Promise<{ restored: number }>;
  getSurfaceItems: (parentId: SurfaceParentId) => Tile[];
  getTilesByParent: (parentId: string | null) => Tile[];
  getFolderChildren: (folderId: string) => Tile[];
  getRootTiles: () => Tile[];
}

interface BookmarkNode {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  type?: string;
  index?: number;
  dateAdded?: number;
  dateGroupModified?: number;
  children?: BookmarkNode[];
}

interface BookmarkRestoreSnapshot {
  parentBookmarkId?: string;
  index?: number;
  node: BookmarkNode;
}

interface UndoAction {
  label: string;
  appState: AppState;
  createdAt: number;
  bookmarkRestores?: BookmarkRestoreSnapshot[];
}

export interface BookmarkFolderOption {
  id: string;
  title: string;
  path: string;
  childCount: number;
}

interface TopSite {
  url: string;
  title?: string;
}

interface BookmarkWriteApi {
  create?: (details: { parentId?: string; title?: string; url?: string; index?: number; type?: string }) => Promise<BookmarkNode>;
  update?: (id: string, changes: { title?: string; url?: string }) => Promise<BookmarkNode>;
  remove?: (id: string) => Promise<void>;
  removeTree?: (id: string) => Promise<void>;
  move?: (id: string, destination: { parentId?: string; index?: number }) => Promise<BookmarkNode>;
}

function getBookmarkWriteApi(): BookmarkWriteApi | null {
  if (typeof browser === 'undefined' || !browser.bookmarks) return null;
  return browser.bookmarks as unknown as BookmarkWriteApi;
}

function createEmptyAppState(now = Date.now()): AppState {
  return {
    items: {},
    containers: {
      [ROOT_CONTAINER_ID]: {
        id: ROOT_CONTAINER_ID,
        title: 'Root',
        childrenIds: [],
        createdAt: now,
        updatedAt: now,
      },
    },
    rootContainerId: ROOT_CONTAINER_ID,
    currentContainerId: ROOT_CONTAINER_ID,
    containerStack: [ROOT_CONTAINER_ID],
    dragState: null,
  };
}

function cloneItem(item: GridItem): GridItem {
  if (item.type === 'folder') {
    return { ...item, childrenIds: [...item.childrenIds] };
  }
  return { ...item };
}

function cloneContainer(container: Container): Container {
  return {
    ...container,
    childrenIds: [...container.childrenIds],
  };
}

function cloneAppState(state: AppState): AppState {
  return {
    ...state,
    items: Object.fromEntries(
      Object.entries(state.items).map(([id, item]) => [id, cloneItem(item)])
    ),
    containers: Object.fromEntries(
      Object.entries(state.containers).map(([id, container]) => [id, cloneContainer(container)])
    ),
    containerStack: [...state.containerStack],
    dragState: state.dragState ? { ...state.dragState } : null,
  };
}

function resetTransientNavigationState(state: AppState): AppState {
  const next = normalizeAppState(cloneAppState(state));
  next.currentContainerId = ROOT_CONTAINER_ID;
  next.containerStack = [ROOT_CONTAINER_ID];
  next.dragState = null;
  return next;
}

function itemToViewItem(item: GridItem, parentId: ContainerId, order: number): Tile {
  const viewParentId = parentId === ROOT_CONTAINER_ID ? undefined : parentId;
  if (item.type === 'folder') {
    return {
      ...item,
      parentId: viewParentId,
      order,
    };
  }
  return {
    ...item,
    parentId: viewParentId,
    order,
  };
}

function appStateToTiles(state: AppState): Tile[] {
  const result: Tile[] = [];
  for (const container of Object.values(state.containers)) {
    container.childrenIds.forEach((itemId, order) => {
      const item = state.items[itemId];
      if (!item) return;
      const containerChildren = state.containers[item.id]?.childrenIds || [];
      if (item.type === 'folder') {
        result.push(itemToViewItem({ ...item, childrenIds: [...containerChildren] }, container.id, order));
      } else {
        result.push(itemToViewItem(item, container.id, order));
      }
    });
  }
  return result;
}

function normalizeAppState(input: AppState): AppState {
  const now = Date.now();
  const state = cloneAppState(input);
  state.rootContainerId = ROOT_CONTAINER_ID;

  if (!state.containers[ROOT_CONTAINER_ID]) {
    state.containers[ROOT_CONTAINER_ID] = {
      id: ROOT_CONTAINER_ID,
      title: 'Root',
      childrenIds: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  for (const item of Object.values(state.items)) {
    if (item.type !== 'folder') continue;
    if (!state.containers[item.id]) {
      state.containers[item.id] = {
        id: item.id,
        title: item.title,
        childrenIds: [...(item.childrenIds || [])],
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    }
  }

  const seen = new Set<string>();
  for (const container of Object.values(state.containers)) {
    const nextChildren: string[] = [];
    for (const childId of container.childrenIds) {
      if (seen.has(childId)) continue;
      if (!state.items[childId]) continue;
      seen.add(childId);
      nextChildren.push(childId);
    }
    container.childrenIds = nextChildren;
    container.updatedAt = container.updatedAt || now;
  }

  for (const [itemId, item] of Object.entries(state.items)) {
    if (!seen.has(itemId)) {
      state.containers[ROOT_CONTAINER_ID].childrenIds.push(itemId);
      seen.add(itemId);
    }
    if (item.type === 'folder') {
      item.childrenIds = [...(state.containers[item.id]?.childrenIds || [])];
    }
  }

  for (const [containerId, container] of Object.entries(state.containers)) {
    if (containerId === ROOT_CONTAINER_ID) continue;
    const item = state.items[containerId];
    if (!item || item.type !== 'folder') {
      delete state.containers[containerId];
    } else {
      container.title = item.title;
    }
  }

  state.containerStack = (state.containerStack || [ROOT_CONTAINER_ID]).filter((id) => state.containers[id]);
  if (state.containerStack.length === 0) state.containerStack = [ROOT_CONTAINER_ID];
  state.currentContainerId = state.containers[state.currentContainerId]
    ? state.currentContainerId
    : state.containerStack[state.containerStack.length - 1] || ROOT_CONTAINER_ID;

  return state;
}

function findContainerIdForItem(state: AppState, itemId: GridItemId): ContainerId | null {
  for (const container of Object.values(state.containers)) {
    if (container.childrenIds.includes(itemId)) return container.id;
  }
  return null;
}

function collectItemAndDescendantIds(state: AppState, itemId: GridItemId, result = new Set<GridItemId>()): Set<GridItemId> {
  if (result.has(itemId)) return result;
  result.add(itemId);
  const item = state.items[itemId];
  if (item?.type === 'folder') {
    for (const childId of state.containers[itemId]?.childrenIds || []) {
      collectItemAndDescendantIds(state, childId, result);
    }
  }
  return result;
}

function removeItemIds(state: AppState, idsToRemove: Set<GridItemId>): void {
  for (const container of Object.values(state.containers)) {
    container.childrenIds = container.childrenIds.filter((childId) => !idsToRemove.has(childId));
    container.updatedAt = Date.now();
  }
  for (const itemId of idsToRemove) {
    delete state.items[itemId];
    delete state.containers[itemId];
  }
  state.containerStack = state.containerStack.filter((containerId) => !idsToRemove.has(containerId));
  if (state.containerStack.length === 0) state.containerStack = [ROOT_CONTAINER_ID];
  state.currentContainerId = state.containerStack[state.containerStack.length - 1] || ROOT_CONTAINER_ID;
}

function removeGeneratedStartupItems(state: AppState): AppState {
  const next = cloneAppState(state);
  const idsToRemove = new Set<GridItemId>();

  for (const [itemId, item] of Object.entries(next.items)) {
    if (item.source === 'top-site' || (item.source === 'bookmark' && !item.bookmarkMode)) {
      collectItemAndDescendantIds(next, itemId, idsToRemove);
    }
  }

  removeItemIds(next, idsToRemove);
  return normalizeAppState(next);
}

function isContainerDescendantOf(state: AppState, containerId: ContainerId, ancestorFolderId: GridItemId): boolean {
  let parent = findContainerIdForItem(state, containerId);
  while (parent) {
    if (parent === ancestorFolderId) return true;
    if (parent === ROOT_CONTAINER_ID) return false;
    parent = findContainerIdForItem(state, parent);
  }
  return false;
}

function parentOf(tile: Tile | undefined): SurfaceParentId {
  return normalizeParentId(tile?.parentId);
}

function parentOrderSnapshot(tiles: Tile[], parentId: SurfaceParentId | undefined): unknown[] {
  return summarizeTileOrder(getSurfaceItems(tiles, normalizeParentId(parentId)));
}

function sortIdsByPinnedQueue(state: AppState, ids: GridItemId[]): GridItemId[] {
  const pinned = ids
    .filter((id) => state.items[id]?.pinnedAt)
    .sort((a, b) => (state.items[a]?.pinnedAt || 0) - (state.items[b]?.pinnedAt || 0));
  const pinnedSet = new Set(pinned);
  return [...pinned, ...ids.filter((id) => !pinnedSet.has(id))];
}

function makeBookmarkItemId(bookmarkId: string): string {
  return `bookmark:${bookmarkId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readGridItemSource(value: unknown): 'manual' | 'bookmark' | 'top-site' {
  return value === 'bookmark' || value === 'top-site' ? value : 'manual';
}

function readBookmarkMode(value: unknown): BookmarkFolderMode | undefined {
  return value === 'reference' || value === 'clone' ? value : undefined;
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function createSiteItem({
  id,
  title,
  url,
  source = 'manual',
  bookmarkId,
  bookmarkMode,
  pinnedAt,
  createdAt,
  updatedAt,
  thumbnail,
  customImage,
  customImageAssetId,
}: {
  id: string;
  title: string;
  url: string;
  source?: 'manual' | 'bookmark' | 'top-site';
  bookmarkId?: string;
  bookmarkMode?: BookmarkFolderMode;
  pinnedAt?: number;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  customImage?: string;
  customImageAssetId?: string;
}): Tile {
  return {
    id,
    type: 'tile',
    title,
    url,
    thumbnail,
    customImage,
    customImageAssetId,
    source,
    bookmarkId,
    bookmarkMode,
    pinnedAt,
    order: 0,
    createdAt,
    updatedAt,
  };
}

function createFolderItem({
  id,
  title,
  childrenIds = [],
  source = 'manual',
  bookmarkId,
  bookmarkMode,
  pinnedAt,
  createdAt,
  updatedAt,
}: {
  id: string;
  title: string;
  childrenIds?: string[];
  source?: 'manual' | 'bookmark' | 'top-site';
  bookmarkId?: string;
  bookmarkMode?: BookmarkFolderMode;
  pinnedAt?: number;
  createdAt: number;
  updatedAt: number;
}): Tile {
  return {
    id,
    type: 'folder',
    title,
    childrenIds,
    source,
    bookmarkId,
    bookmarkMode,
    pinnedAt,
    order: 0,
    createdAt,
    updatedAt,
  };
}

function legacyTileToItem(tile: Record<string, unknown>): GridItem {
  const now = Date.now();
  const type = tile.type === 'folder' ? 'folder' : 'tile';
  const base = {
    id: String(tile.id || crypto.randomUUID()),
    title: String(tile.title || 'Untitled'),
    favicon: typeof tile.favicon === 'string' ? tile.favicon : undefined,
    previewImage: typeof tile.previewImage === 'string' ? tile.previewImage : undefined,
    thumbnail: typeof tile.thumbnail === 'string' ? tile.thumbnail : undefined,
    customImage: typeof tile.customImage === 'string' ? tile.customImage : undefined,
    customImageAssetId: typeof tile.customImageAssetId === 'string' ? tile.customImageAssetId : undefined,
    dominantColor: typeof tile.dominantColor === 'string' ? tile.dominantColor : undefined,
    tileAccentColor: typeof tile.tileAccentColor === 'string' ? tile.tileAccentColor : undefined,
    containerCookieStoreId: typeof tile.containerCookieStoreId === 'string' ? tile.containerCookieStoreId : undefined,
    containerName: typeof tile.containerName === 'string' ? tile.containerName : undefined,
    containerColor: typeof tile.containerColor === 'string' ? tile.containerColor : undefined,
    themeColors: isRecord(tile.themeColors) ? tile.themeColors as GridItem['themeColors'] : undefined,
    source: readGridItemSource(tile.source),
    bookmarkId: typeof tile.bookmarkId === 'string' ? tile.bookmarkId : undefined,
    bookmarkMode: readBookmarkMode(tile.bookmarkMode),
    pinnedAt: typeof tile.pinnedAt === 'number' ? tile.pinnedAt : undefined,
    createdAt: typeof tile.createdAt === 'number' ? tile.createdAt : now,
    updatedAt: typeof tile.updatedAt === 'number' ? tile.updatedAt : now,
    order: typeof tile.order === 'number' ? tile.order : 0,
    glassmorphism: typeof tile.glassmorphism === 'boolean' ? tile.glassmorphism : undefined,
    borderRadius: typeof tile.borderRadius === 'number' ? tile.borderRadius : undefined,
    opacity: typeof tile.opacity === 'number' ? tile.opacity : undefined,
  };

  if (type === 'folder') {
    return {
      ...base,
      type: 'folder',
      childrenIds: [],
    };
  }

  return {
    ...base,
    type: 'tile',
    url: typeof tile.url === 'string' ? tile.url : '',
  };
}

function tilesToAppState(tiles: Array<Record<string, unknown>>): AppState {
  const now = Date.now();
  const state = createEmptyAppState(now);
  const itemsWithView = tiles
    .map((tile) => ({
      raw: tile,
      item: legacyTileToItem(tile),
      parentId: typeof tile.parentId === 'string' ? tile.parentId : null,
      order: typeof tile.order === 'number' ? tile.order : 0,
    }))
    .filter(({ item }) => item.type === 'folder' || (item.type === 'tile' && Boolean(item.url)));

  for (const { item } of itemsWithView) {
    state.items[item.id] = item;
    if (item.type === 'folder') {
      state.containers[item.id] = {
        id: item.id,
        title: item.title,
        childrenIds: [],
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    }
  }

  for (const containerId of [ROOT_CONTAINER_ID, ...Object.keys(state.containers).filter((id) => id !== ROOT_CONTAINER_ID)]) {
    const children = itemsWithView
      .filter(({ parentId }) => (containerId === ROOT_CONTAINER_ID ? !parentId : parentId === containerId))
      .sort((a, b) => a.order - b.order)
      .map(({ item }) => item.id);
    if (children.length > 0 || containerId === ROOT_CONTAINER_ID) {
      state.containers[containerId].childrenIds = children;
    }
  }

  return normalizeAppState(state);
}

function legacyTilesFromUnknown(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return toRecordArray(value);
  if (!isRecord(value)) return [];
  if (Array.isArray(value.tiles)) return toRecordArray(value.tiles);
  if (isRecord(value.tiles)) return Object.values(value.tiles).filter(isRecord);
  return [];
}

function appStateRecordToLegacyTiles(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || !isRecord(value.items)) return [];
  const items = value.items;
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  if (isRecord(value.containers)) {
    for (const [containerId, rawContainer] of Object.entries(value.containers)) {
      if (!isRecord(rawContainer)) continue;
      const childIds = readStringArray(rawContainer.childrenIds);
      childIds.forEach((childId, order) => {
        const rawItem = items[childId];
        if (!isRecord(rawItem)) return;
        seen.add(childId);
        rows.push({
          ...rawItem,
          id: childId,
          parentId: containerId === ROOT_CONTAINER_ID ? undefined : containerId,
          order,
        });
      });
    }
  }

  for (const [itemId, rawItem] of Object.entries(items)) {
    if (seen.has(itemId) || !isRecord(rawItem)) continue;
    rows.push({
      ...rawItem,
      id: itemId,
      parentId: typeof rawItem.parentId === 'string' ? rawItem.parentId : undefined,
      order: typeof rawItem.order === 'number' ? rawItem.order : rows.length,
    });
  }

  return rows;
}

function coerceAppStateRecord(value: unknown): AppState | null {
  if (!isRecord(value) || !isRecord(value.items) || !isRecord(value.containers)) return null;

  const now = Date.now();
  const state = createEmptyAppState(now);
  state.items = {};

  for (const [itemId, rawItem] of Object.entries(value.items)) {
    if (!isRecord(rawItem)) continue;
    const item = legacyTileToItem({ ...rawItem, id: itemId });
    if (item.type === 'folder') {
      item.childrenIds = readStringArray(rawItem.childrenIds);
    }
    state.items[itemId] = item;
  }

  state.containers = {
    [ROOT_CONTAINER_ID]: {
      id: ROOT_CONTAINER_ID,
      title: 'Root',
      childrenIds: [],
      createdAt: now,
      updatedAt: now,
    },
  };

  for (const [containerId, rawContainer] of Object.entries(value.containers)) {
    if (!isRecord(rawContainer)) continue;
    const isRoot = containerId === ROOT_CONTAINER_ID;
    if (!isRoot && state.items[containerId]?.type !== 'folder') continue;
    state.containers[containerId] = {
      id: containerId,
      title: typeof rawContainer.title === 'string'
        ? rawContainer.title
        : state.items[containerId]?.title || (isRoot ? 'Root' : 'Folder'),
      parentId: typeof rawContainer.parentId === 'string' ? rawContainer.parentId : undefined,
      childrenIds: readStringArray(rawContainer.childrenIds),
      createdAt: typeof rawContainer.createdAt === 'number' ? rawContainer.createdAt : now,
      updatedAt: typeof rawContainer.updatedAt === 'number' ? rawContainer.updatedAt : now,
    };
  }

  state.rootContainerId = ROOT_CONTAINER_ID;
  state.containerStack = readStringArray(value.containerStack);
  if (state.containerStack.length === 0) state.containerStack = [ROOT_CONTAINER_ID];
  state.currentContainerId = typeof value.currentContainerId === 'string'
    ? value.currentContainerId
    : state.containerStack[state.containerStack.length - 1] || ROOT_CONTAINER_ID;
  state.dragState = null;

  return normalizeAppState(state);
}

function migrateUnknownState(value: unknown, schemaVersion: number): AppState | null {
  if (schemaVersion >= GRID_SCHEMA_VERSION) {
    const appState = coerceAppStateRecord(value);
    if (appState) return appState;
  }

  const directTiles = legacyTilesFromUnknown(value);
  const appStateTiles = directTiles.length > 0 ? directTiles : appStateRecordToLegacyTiles(value);
  if (appStateTiles.length === 0) return null;

  const migrated = tilesToAppState(appStateTiles);
  return schemaVersion < GRID_SCHEMA_VERSION
    ? removeGeneratedStartupItems(migrated)
    : migrated;
}

function migratePersistedState(persisted: PersistedState, origin: string): AppState | null {
  const state = migrateUnknownState((persisted as PersistedState & { state: unknown }).state, persisted.schemaVersion);
  if (!state) {
    logTileDebug('store:migrate:skipped', {
      origin,
      schemaVersion: persisted.schemaVersion,
      reason: 'unrecognized-state-shape',
    });
    return null;
  }

  if (persisted.schemaVersion < GRID_SCHEMA_VERSION) {
    logTileDebug('store:migrate:success', {
      origin,
      fromSchemaVersion: persisted.schemaVersion,
      toSchemaVersion: GRID_SCHEMA_VERSION,
      count: appStateToTiles(state).length,
      root: parentOrderSnapshot(appStateToTiles(state), null),
    });
  }

  return normalizeAppState(state);
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedState>;
  return typeof candidate.schemaVersion === 'number' && Boolean(candidate.state);
}

async function readPersistedState(): Promise<AppState | null> {
  try {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      const result = await browser.storage.local.get(STORAGE_KEY);
      const persisted = result[STORAGE_KEY];
      if (isPersistedState(persisted)) {
        const state = migratePersistedState(persisted, 'browser.storage.local');
        if (!state) return null;
        if (persisted.schemaVersion < GRID_SCHEMA_VERSION) await writePersistedState(state);
        return state;
      }
    }
  } catch {
    // Fall through to localStorage for development previews.
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isPersistedState(parsed)) {
        const state = migratePersistedState(parsed, 'localStorage');
        if (state) {
          if (parsed.schemaVersion < GRID_SCHEMA_VERSION) await writePersistedState(state);
          return state;
        }
      }
    }
  } catch {
    // Fall through to legacy IndexedDB.
  }

  const legacyTiles = await readLegacyTiles();
  if (legacyTiles.length === 0) return null;
  const state = removeGeneratedStartupItems(tilesToAppState(legacyTiles));
  await writePersistedState(state);
  logTileDebug('store:migrate:success', {
    origin: 'indexedDB:fasp-tiles',
    fromSchemaVersion: 'legacy',
    toSchemaVersion: GRID_SCHEMA_VERSION,
    count: appStateToTiles(state).length,
    root: parentOrderSnapshot(appStateToTiles(state), null),
  });
  return state;
}

async function writePersistedState(state: AppState): Promise<void> {
  const persisted: PersistedState = {
    schemaVersion: GRID_SCHEMA_VERSION,
    state: resetTransientNavigationState(state),
  };

  if (typeof browser !== 'undefined' && browser.storage?.local) {
    await browser.storage.local.set({ [STORAGE_KEY]: persisted });
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

export function createPersistedGridState(state: AppState): PersistedState {
  return {
    schemaVersion: GRID_SCHEMA_VERSION,
    state: resetTransientNavigationState(state),
  };
}

export function normalizePersistedGridState(value: unknown): PersistedState {
  if (!isPersistedState(value)) {
    throw new Error('Invalid profile grid state');
  }

  const state = migratePersistedState(value, 'profile-import');
  if (!state) {
    throw new Error('Unsupported profile grid state');
  }

  return createPersistedGridState(state);
}

async function optimizeAppStateMedia(state: AppState): Promise<{ state: AppState; optimized: number }> {
  const next = cloneAppState(state);
  let optimized = 0;

  for (const item of Object.values(next.items)) {
    if (!isImageDataUrl(item.customImage)) continue;
    try {
      const asset = await saveImageAssetFromDataUrl(item.customImage, {
        kind: 'tile-image',
        maxSide: 768,
        quality: 0.82,
      });
      item.customImageAssetId = asset.id;
      item.customImage = undefined;
      item.thumbnail = undefined;
      item.updatedAt = Date.now();
      optimized += 1;
    } catch {
      // Keep legacy image untouched if one asset fails to encode.
    }
  }

  return { state: normalizeAppState(next), optimized };
}

async function restoreAppStateMedia(state: AppState): Promise<{ state: AppState; restored: number }> {
  const next = cloneAppState(state);
  let restored = 0;

  for (const item of Object.values(next.items)) {
    if (!item.customImageAssetId || item.customImage) continue;
    const dataUrl = await readMediaAssetAsDataUrl(item.customImageAssetId);
    if (!dataUrl) continue;
    item.customImage = dataUrl;
    item.customImageAssetId = undefined;
    item.updatedAt = Date.now();
    restored += 1;
  }

  return { state: normalizeAppState(next), restored };
}

function getLegacyDb(): Promise<IDBPDatabase> {
  if (!legacyDbPromise) {
    legacyDbPromise = openDB(LEGACY_DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
          const store = db.createObjectStore(LEGACY_STORE_NAME, { keyPath: 'id' });
          store.createIndex('order', 'order');
          store.createIndex('parentId', 'parentId');
        }
      },
    });
  }
  return legacyDbPromise;
}

async function readLegacyTiles(): Promise<Array<Record<string, unknown>>> {
  try {
    const db = await getLegacyDb();
    return await db.getAll(LEGACY_STORE_NAME) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

function findToolbarNode(nodes: BookmarkNode[]): BookmarkNode | null {
  for (const node of nodes) {
    if (node.id === 'toolbar_____') return node;
    const nested = node.children ? findToolbarNode(node.children) : null;
    if (nested) return nested;
  }
  return null;
}

function findBookmarkNode(nodes: BookmarkNode[], bookmarkId: string): BookmarkNode | null {
  for (const node of nodes) {
    if (node.id === bookmarkId) return node;
    const nested = node.children ? findBookmarkNode(node.children, bookmarkId) : null;
    if (nested) return nested;
  }
  return null;
}

async function readBookmarkRoots(): Promise<BookmarkNode[]> {
  try {
    if (typeof browser !== 'undefined' && browser.bookmarks?.getSubTree) {
      const toolbar = await browser.bookmarks.getSubTree('toolbar_____') as BookmarkNode[];
      if (toolbar?.[0]?.children) return toolbar[0].children;
    }
  } catch {
    // Fallback below.
  }

  try {
    if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
      const tree = await browser.runtime.sendMessage({ type: 'get-bookmarks' }) as BookmarkNode[];
      const toolbar = findToolbarNode(tree || []);
      return toolbar?.children || [];
    }
  } catch {
    // Fallback below.
  }

  try {
    if (typeof browser !== 'undefined' && browser.bookmarks?.getTree) {
      const tree = await browser.bookmarks.getTree() as BookmarkNode[];
      const toolbar = findToolbarNode(tree || []);
      return toolbar?.children || [];
    }
  } catch {
    return [];
  }

  return [];
}

async function readBookmarkTree(): Promise<BookmarkNode[]> {
  try {
    if (typeof browser !== 'undefined' && browser.bookmarks?.getTree) {
      return await browser.bookmarks.getTree() as BookmarkNode[];
    }
  } catch {
    // Fallback below.
  }

  try {
    if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
      return await browser.runtime.sendMessage({ type: 'get-bookmarks' }) as BookmarkNode[];
    }
  } catch {
    return [];
  }

  return [];
}

async function readBookmarkSubTree(bookmarkId: string): Promise<BookmarkNode | null> {
  try {
    if (typeof browser !== 'undefined' && browser.bookmarks?.getSubTree) {
      const subtree = await browser.bookmarks.getSubTree(bookmarkId) as BookmarkNode[];
      return subtree[0] || null;
    }
  } catch {
    // Fallback below.
  }

  const tree = await readBookmarkTree();
  return findBookmarkNode(tree, bookmarkId);
}

function cloneBookmarkNode(node: BookmarkNode): BookmarkNode {
  return {
    ...node,
    children: node.children?.map(cloneBookmarkNode),
  };
}

async function createBookmarkRestoreSnapshot(item: GridItem | undefined): Promise<BookmarkRestoreSnapshot | null> {
  if (!isBookmarkReferenceItem(item)) return null;
  const node = await readBookmarkSubTree(item.bookmarkId);
  if (!node) return null;

  return {
    parentBookmarkId: node.parentId,
    index: node.index,
    node: cloneBookmarkNode(node),
  };
}

async function restoreBookmarkNode(
  snapshot: BookmarkRestoreSnapshot,
  node: BookmarkNode = snapshot.node,
  parentBookmarkId = snapshot.parentBookmarkId,
  index = snapshot.index
): Promise<BookmarkNode | null> {
  const bookmarks = getBookmarkWriteApi();
  if (!bookmarks?.create) return null;

  const details: { parentId?: string; title?: string; url?: string; index?: number; type?: string } = {
    parentId: parentBookmarkId,
    index,
  };
  if (node.type === 'separator') {
    details.type = 'separator';
  } else {
    details.title = node.title || 'Untitled';
    if (node.url) details.url = node.url;
  }

  const created = await bookmarks.create(details);
  if (!node.url && node.type !== 'separator') {
    for (const [childIndex, child] of (node.children || []).entries()) {
      await restoreBookmarkNode(snapshot, child, created.id, child.index ?? childIndex);
    }
  }

  return created;
}

function listBookmarkFoldersFromNodes(nodes: BookmarkNode[], basePath = 'Избранное'): BookmarkFolderOption[] {
  const result: BookmarkFolderOption[] = [];

  const visit = (node: BookmarkNode, path: string) => {
    if (node.url || node.type === 'separator') return;
    const title = node.title || 'Untitled folder';
    const nextPath = path ? `${path} / ${title}` : title;
    const children = node.children || [];
    result.push({
      id: node.id,
      title,
      path: nextPath,
      childCount: children.filter((child) => child.url || (child.children && child.type !== 'separator')).length,
    });
    for (const child of children) visit(child, nextPath);
  };

  for (const node of nodes) visit(node, basePath);
  return result;
}

function bookmarksToAppState(nodes: BookmarkNode[]): AppState | null {
  const now = Date.now();
  const state = createEmptyAppState(now);

  const visit = (children: BookmarkNode[], containerId: ContainerId): string[] => {
    return [...children]
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .flatMap((node) => {
        if (node.url) {
          if (node.url.startsWith('place:')) return [];
          const id = makeBookmarkItemId(node.id);
          state.items[id] = createSiteItem({
            id,
            title: node.title || node.url,
            url: node.url,
            source: 'bookmark',
            bookmarkId: node.id,
            createdAt: node.dateAdded || now,
            updatedAt: now,
            thumbnail: getScreenshotThumbnailUrl(node.url),
          });
          return [id];
        }

        if (!node.children || node.type === 'separator') return [];

        const id = makeBookmarkItemId(node.id);
        const childIds = visit(node.children, id);
        state.items[id] = createFolderItem({
          id,
          title: node.title || 'Bookmarks',
          childrenIds: childIds,
          source: 'bookmark',
          bookmarkId: node.id,
          createdAt: node.dateAdded || now,
          updatedAt: node.dateGroupModified || now,
        });
        state.containers[id] = {
          id,
          title: node.title || 'Bookmarks',
          parentId: containerId,
          childrenIds: childIds,
          createdAt: node.dateAdded || now,
          updatedAt: node.dateGroupModified || now,
        };
        return [id];
      });
  };

  state.containers[ROOT_CONTAINER_ID].childrenIds = visit(nodes, ROOT_CONTAINER_ID);
  if (state.containers[ROOT_CONTAINER_ID].childrenIds.length === 0) return null;
  return normalizeAppState(state);
}

async function importTopSitesState(): Promise<AppState | null> {
  try {
    if (typeof browser === 'undefined' || !browser.topSites) return null;

    const sites = await browser.topSites.get({ includeFavicon: false, limit: 16 }) as TopSite[];
    const filtered = sites
      .filter((site) => site.url && !site.url.startsWith('place:'))
      .slice(0, 12);
    if (filtered.length === 0) return null;

    const now = Date.now();
    const state = createEmptyAppState(now);
    state.containers[ROOT_CONTAINER_ID].childrenIds = filtered.map((site) => {
      const url = normalizeUrl(site.url);
      const id = crypto.randomUUID();
      state.items[id] = createSiteItem({
        id,
        title: site.title || new URL(url).hostname.replace('www.', ''),
        url,
        source: 'top-site',
        createdAt: now,
        updatedAt: now,
        thumbnail: getScreenshotThumbnailUrl(url),
      });
      return id;
    });
    return normalizeAppState(state);
  } catch {
    return null;
  }
}

function mergeBookmarkState(current: AppState, bookmarkState: AppState): AppState {
  const next = cloneAppState(bookmarkState);

  for (const [itemId, item] of Object.entries(current.items)) {
    if (item.source === 'bookmark') continue;
    next.items[itemId] = cloneItem(item);
    if (item.type === 'folder') {
      const currentContainer = current.containers[itemId];
      next.containers[itemId] = currentContainer
        ? {
            ...cloneContainer(currentContainer),
            childrenIds: currentContainer.childrenIds.filter((childId) => current.items[childId]?.source !== 'bookmark'),
          }
        : {
            id: itemId,
            title: item.title,
            childrenIds: [],
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          };
    }
  }

  for (const [containerId, container] of Object.entries(current.containers)) {
    const targetContainer = next.containers[containerId] || next.containers[ROOT_CONTAINER_ID];
    for (const childId of container.childrenIds) {
      const child = current.items[childId];
      if (!child || child.source === 'bookmark') continue;
      if (!next.items[childId]) next.items[childId] = cloneItem(child);
      if (!targetContainer.childrenIds.includes(childId)) targetContainer.childrenIds.push(childId);
    }
  }

  next.containerStack = current.containerStack.filter((containerId) => next.containers[containerId]);
  if (next.containerStack.length === 0) next.containerStack = [ROOT_CONTAINER_ID];
  next.currentContainerId = next.containers[current.currentContainerId]
    ? current.currentContainerId
    : next.containerStack[next.containerStack.length - 1] || ROOT_CONTAINER_ID;
  next.dragState = current.dragState ? { ...current.dragState } : null;

  return normalizeAppState(next);
}

async function importBookmarkState(): Promise<AppState | null> {
  const roots = await readBookmarkRoots();
  return bookmarksToAppState(roots);
}

function addBookmarkNodeToState({
  state,
  node,
  parentContainerId,
  mode,
}: {
  state: AppState;
  node: BookmarkNode;
  parentContainerId: ContainerId;
  mode: BookmarkFolderMode;
}): GridItemId | null {
  const now = Date.now();
  const source = mode === 'reference' ? 'bookmark' : 'manual';
  const id = mode === 'reference' ? makeBookmarkItemId(node.id) : crypto.randomUUID();
  const title = node.title || node.url || 'Untitled';

  if (node.url) {
    state.items[id] = createSiteItem({
      id,
      title,
      url: normalizeUrl(node.url),
      source,
      bookmarkId: mode === 'reference' ? node.id : undefined,
      bookmarkMode: mode === 'reference' ? 'reference' : mode === 'clone' ? 'clone' : undefined,
      createdAt: node.dateAdded || now,
      updatedAt: now,
      thumbnail: getScreenshotThumbnailUrl(node.url),
    });
    return id;
  }

  if (node.type === 'separator') return null;

  const childIds = (node.children || [])
    .map((child) => addBookmarkNodeToState({
      state,
      node: child,
      parentContainerId: id,
      mode,
    }))
    .filter((childId): childId is GridItemId => Boolean(childId));

  state.items[id] = createFolderItem({
    id,
    title,
    childrenIds: childIds,
    source,
    bookmarkId: mode === 'reference' ? node.id : undefined,
    bookmarkMode: mode === 'reference' ? 'reference' : mode === 'clone' ? 'clone' : undefined,
    createdAt: node.dateAdded || now,
    updatedAt: node.dateGroupModified || now,
  });
  state.containers[id] = {
    id,
    title,
    parentId: parentContainerId,
    childrenIds: childIds,
    createdAt: node.dateAdded || now,
    updatedAt: node.dateGroupModified || now,
  };
  return id;
}

function cloneItemSubtreeToLocal(state: AppState, itemId: GridItemId): GridItemId | null {
  const item = state.items[itemId];
  if (!item) return null;

  const now = Date.now();
  const nextId = crypto.randomUUID();
  const bookmarkMode = item.source === 'bookmark' || item.bookmarkMode === 'reference'
    ? 'clone'
    : item.bookmarkMode === 'clone'
      ? 'clone'
      : undefined;

  if (item.type === 'tile') {
    state.items[nextId] = createSiteItem({
      id: nextId,
      title: item.title,
      url: item.url,
      source: 'manual',
      bookmarkMode,
      pinnedAt: item.pinnedAt,
      createdAt: now,
      updatedAt: now,
      thumbnail: item.thumbnail,
      customImage: item.customImage,
      customImageAssetId: item.customImageAssetId,
    });
    return nextId;
  }

  const childIds = (state.containers[item.id]?.childrenIds || [])
    .map((childId) => cloneItemSubtreeToLocal(state, childId))
    .filter((childId): childId is GridItemId => Boolean(childId));

  state.items[nextId] = createFolderItem({
    id: nextId,
    title: item.title,
    childrenIds: childIds,
    source: 'manual',
    bookmarkMode,
    pinnedAt: item.pinnedAt,
    createdAt: now,
    updatedAt: now,
  });
  state.containers[nextId] = {
    id: nextId,
    title: item.title,
    childrenIds: childIds,
    createdAt: now,
    updatedAt: now,
  };
  return nextId;
}

function insertItemIntoContainer(state: AppState, containerId: ContainerId, itemId: GridItemId): void {
  const container = state.containers[containerId];
  if (!container) return;
  for (const candidate of Object.values(state.containers)) {
    candidate.childrenIds = candidate.childrenIds.filter((childId) => childId !== itemId);
  }
  container.childrenIds.push(itemId);
  container.childrenIds = sortIdsByPinnedQueue(state, container.childrenIds);
  container.updatedAt = Date.now();
}

function getReferenceRootFolderIds(state: AppState): GridItemId[] {
  return Object.values(state.items)
    .filter((item) => item.type === 'folder' && item.source === 'bookmark' && item.bookmarkMode === 'reference' && item.bookmarkId)
    .filter((item) => {
      const parentContainerId = findContainerIdForItem(state, item.id);
      if (!parentContainerId || parentContainerId === ROOT_CONTAINER_ID) return true;
      const parentItem = state.items[parentContainerId];
      return !(parentItem?.source === 'bookmark' && parentItem.bookmarkMode === 'reference');
    })
    .map((item) => item.id);
}

function isBookmarkReferenceItem(item: GridItem | undefined): item is GridItem & { bookmarkId: string } {
  return Boolean(item?.source === 'bookmark' && item.bookmarkMode === 'reference' && item.bookmarkId);
}

function isInsideBookmarkReferenceContainer(state: AppState, itemId: GridItemId): boolean {
  const parentContainerId = findContainerIdForItem(state, itemId);
  if (!parentContainerId || parentContainerId === ROOT_CONTAINER_ID) return false;
  return isBookmarkReferenceItem(state.items[parentContainerId]);
}

async function updateBrowserBookmark(item: GridItem | undefined, updates: Partial<Tile>): Promise<void> {
  if (!isBookmarkReferenceItem(item)) return;
  const bookmarks = getBookmarkWriteApi();
  if (!bookmarks?.update) return;

  const details: { title?: string; url?: string } = {};
  if (typeof updates.title === 'string') details.title = updates.title;
  if (item.type === 'tile' && typeof updates.url === 'string') details.url = updates.url;
  if (Object.keys(details).length === 0) return;
  await bookmarks.update(item.bookmarkId, details);
}

async function removeBrowserBookmark(item: GridItem | undefined): Promise<void> {
  if (!isBookmarkReferenceItem(item)) return;
  const bookmarks = getBookmarkWriteApi();
  if (!bookmarks) return;
  if (item.type === 'folder' && bookmarks.removeTree) {
    await bookmarks.removeTree(item.bookmarkId);
    return;
  }
  if (bookmarks.remove) await bookmarks.remove(item.bookmarkId);
}

async function createBrowserBookmarkFromTile(parentBookmarkId: string, tile: Tile, index?: number): Promise<BookmarkNode | null> {
  const bookmarks = getBookmarkWriteApi();
  if (!bookmarks?.create) return null;
  const details: { parentId: string; title: string; url?: string; index?: number } = {
    parentId: parentBookmarkId,
    title: tile.title || 'Untitled',
    index,
  };
  if (tile.type === 'tile') details.url = normalizeUrl(tile.url);
  return await bookmarks.create(details);
}

async function addLocalItemToBookmarkReference(
  state: AppState,
  itemId: GridItemId,
  parentBookmarkId: string,
  index?: number
): Promise<GridItemId | null> {
  const item = state.items[itemId];
  if (!item) return null;

  const created = await createBrowserBookmarkFromTile(parentBookmarkId, item, index);
  if (!created) return null;

  const now = Date.now();
  const nextId = makeBookmarkItemId(created.id);

  if (item.type === 'tile') {
    state.items[nextId] = createSiteItem({
      id: nextId,
      title: item.title,
      url: item.url,
      source: 'bookmark',
      bookmarkId: created.id,
      bookmarkMode: 'reference',
      createdAt: item.createdAt || now,
      updatedAt: now,
      thumbnail: item.thumbnail,
      customImage: item.customImage,
      customImageAssetId: item.customImageAssetId,
    });
    return nextId;
  }

  const childIds: GridItemId[] = [];
  const sourceChildIds = state.containers[item.id]?.childrenIds || [];
  for (const [childIndex, childId] of sourceChildIds.entries()) {
    const nextChildId = await addLocalItemToBookmarkReference(state, childId, created.id, childIndex);
    if (nextChildId) childIds.push(nextChildId);
  }

  state.items[nextId] = createFolderItem({
    id: nextId,
    title: item.title,
    childrenIds: childIds,
    source: 'bookmark',
    bookmarkId: created.id,
    bookmarkMode: 'reference',
    createdAt: item.createdAt || now,
    updatedAt: now,
  });
  state.containers[nextId] = {
    id: nextId,
    title: item.title,
    childrenIds: childIds,
    createdAt: item.createdAt || now,
    updatedAt: now,
  };
  return nextId;
}

async function moveBrowserBookmark(item: GridItem | undefined, parentBookmarkId: string, index?: number): Promise<void> {
  if (!isBookmarkReferenceItem(item)) return;
  const bookmarks = getBookmarkWriteApi();
  if (!bookmarks?.move) return;
  await bookmarks.move(item.bookmarkId, { parentId: parentBookmarkId, index });
}

async function initializeBackgroundBookmarkListener(): Promise<void> {
  try {
    if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
      await browser.runtime.sendMessage({ type: 'init' });
    }
  } catch {
    // The new tab can still work without a live background listener.
  }
}

export const useTileStore = create<TilesState>((set, get) => {
  const commitAppState = async (nextState: AppState) => {
    let normalized = normalizeAppState(nextState);
    if (useSettingsStore.getState().settings.optimizeMediaAssets) {
      const result = await optimizeAppStateMedia(normalized);
      normalized = result.state;
    }
    const tiles = appStateToTiles(normalized);
    set({
      appState: normalized,
      tiles,
      openFolderIds: normalized.containerStack.slice(1),
      error: null,
      undoAction: null,
    });
    await writePersistedState(normalized);
  };

  return {
    appState: createEmptyAppState(),
    tiles: [],
    loading: false,
    error: null,
    openFolderIds: [],
    undoAction: null,

    loadTiles: async () => {
      logTileDebug('store:load:start');
      set({ loading: true, error: null });
      await initializeBackgroundBookmarkListener();

      try {
        let appState = await readPersistedState();
        let source: 'storage' | 'empty' = 'storage';

        if (!appState) {
          appState = createEmptyAppState();
          source = 'empty';
          await writePersistedState(appState);
        }

        const normalized = resetTransientNavigationState(appState);
        const hadStoredRuntimeState = appState.containerStack.length > 1
          || appState.currentContainerId !== ROOT_CONTAINER_ID
          || appState.dragState !== null;
        const tiles = appStateToTiles(normalized);
        set({
          appState: normalized,
          tiles,
          openFolderIds: normalized.containerStack.slice(1),
          loading: false,
          error: null,
        });
        if (hadStoredRuntimeState) {
          await writePersistedState(normalized);
        }
        logTileDebug('store:load:success', {
          source,
          count: tiles.length,
          root: parentOrderSnapshot(tiles, null),
          tree: summarizeTileTree(tiles),
        });
      } catch (err) {
        set({ error: (err as Error).message, loading: false });
        logTileDebug('store:load:error', err);
      }
    },

    addTile: async (tile: Tile) => {
      const now = Date.now();
      const parentId = normalizeParentId(tile.parentId);
      const containerId = parentId || ROOT_CONTAINER_ID;
      const state = cloneAppState(get().appState);
      const parentItem = parentId ? state.items[parentId] : undefined;
      const browserBookmark = isBookmarkReferenceItem(parentItem)
        ? await createBrowserBookmarkFromTile(parentItem.bookmarkId, tile, state.containers[containerId]?.childrenIds.length)
        : null;
      const itemId = browserBookmark ? makeBookmarkItemId(browserBookmark.id) : (tile.id || crypto.randomUUID());
      const itemSource = browserBookmark ? 'bookmark' : (tile.source || 'manual');
      const item = tile.type === 'folder'
        ? createFolderItem({
            id: itemId,
            title: tile.title,
            childrenIds: tile.childrenIds || [],
            source: itemSource,
            bookmarkId: browserBookmark?.id || tile.bookmarkId,
            bookmarkMode: browserBookmark ? 'reference' : tile.bookmarkMode,
            createdAt: tile.createdAt || now,
            updatedAt: now,
          })
        : createSiteItem({
            id: itemId,
            title: tile.title,
            url: tile.url,
            source: itemSource,
            bookmarkId: browserBookmark?.id || tile.bookmarkId,
            bookmarkMode: browserBookmark ? 'reference' : tile.bookmarkMode,
            createdAt: tile.createdAt || now,
            updatedAt: now,
            thumbnail: tile.thumbnail,
            customImage: tile.customImage,
            customImageAssetId: tile.customImageAssetId,
          });

      state.items[item.id] = {
        ...item,
        glassmorphism: tile.glassmorphism,
        borderRadius: tile.borderRadius,
        opacity: tile.opacity,
        dominantColor: tile.dominantColor,
        tileAccentColor: tile.tileAccentColor,
        containerCookieStoreId: tile.containerCookieStoreId,
        containerName: tile.containerName,
        containerColor: tile.containerColor,
      };
      if (!state.containers[containerId]) {
        state.containers[containerId] = {
          id: containerId,
          title: 'Container',
          childrenIds: [],
          createdAt: now,
          updatedAt: now,
        };
      }
      state.containers[containerId].childrenIds.push(item.id);
      state.containers[containerId].childrenIds = sortIdsByPinnedQueue(state, state.containers[containerId].childrenIds);
      if (item.type === 'folder') {
        state.containers[item.id] = {
          id: item.id,
          title: item.title,
          parentId: containerId,
          childrenIds: [...item.childrenIds],
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }

      logTileDebug('store:add:start', {
        tile: summarizeTile(item),
        parentBefore: parentOrderSnapshot(get().tiles, parentId),
      });
      await commitAppState(state);
      logTileDebug('store:add:success', {
        tile: summarizeTile(item),
        parentAfter: parentOrderSnapshot(get().tiles, parentId),
      });
    },

    updateTile: async (id: string, updates: Partial<Tile>) => {
      const state = cloneAppState(get().appState);
      const item = state.items[id];
      logTileDebug('store:update:start', { id, updates });
      if (!item) {
        logTileDebug('store:update:missing', { id });
        return;
      }
      await updateBrowserBookmark(item, updates);

      const nextItem = {
        ...item,
        ...updates,
        id,
        type: item.type,
        updatedAt: Date.now(),
      } as GridItem;
      if (nextItem.type === 'folder') {
        nextItem.childrenIds = [...(state.containers[id]?.childrenIds || nextItem.childrenIds || [])];
        if (state.containers[id]) {
          state.containers[id].title = nextItem.title;
          state.containers[id].updatedAt = nextItem.updatedAt;
        }
      }
      delete (nextItem as Partial<Tile>).parentId;
      state.items[id] = nextItem;

      await commitAppState(state);
      logTileDebug('store:update:success', {
        after: summarizeTile(state.items[id]),
      });
    },

    removeTile: async (id: string) => {
      const previous = get().appState;
      const state = cloneAppState(previous);
      const item = state.items[id];
      const deletesBrowserBookmark = isInsideBookmarkReferenceContainer(state, id);
      const bookmarkRestore = deletesBrowserBookmark
        ? await createBookmarkRestoreSnapshot(item)
        : null;
      if (deletesBrowserBookmark) {
        await removeBrowserBookmark(state.items[id]);
      }
      const idsToDelete = collectItemAndDescendantIds(state, id);
      logTileDebug('store:remove:start', { id, idsToDelete: [...idsToDelete] });

      removeItemIds(state, idsToDelete);

      await commitAppState(state);
      if (item && (!deletesBrowserBookmark || bookmarkRestore)) {
        set({
          undoAction: {
            label: item.type === 'folder' ? `Вернуть папку «${item.title}»` : `Вернуть плитку «${item.title}»`,
            appState: cloneAppState(previous),
            createdAt: Date.now(),
            bookmarkRestores: bookmarkRestore ? [bookmarkRestore] : undefined,
          },
        });
      }
      logTileDebug('store:remove:success', {
        deletedIds: [...idsToDelete],
        tree: summarizeTileTree(get().tiles),
      });
    },

    deleteTile: async (id: string) => {
      await get().removeTile(id);
    },

    undoLastAction: async () => {
      const undoAction = get().undoAction;
      if (!undoAction) return;
      if (undoAction.bookmarkRestores?.length) {
        for (const snapshot of undoAction.bookmarkRestores) {
          await restoreBookmarkNode(snapshot);
        }
        set({ undoAction: null });
        await get().syncBookmarks();
        logTileDebug('store:undo:success', {
          label: undoAction.label,
          createdAt: undoAction.createdAt,
          bookmarkRestores: undoAction.bookmarkRestores.length,
          tree: summarizeTileTree(get().tiles),
        });
        return;
      }
      await commitAppState(cloneAppState(undoAction.appState));
      set({ undoAction: null });
      logTileDebug('store:undo:success', {
        label: undoAction.label,
        createdAt: undoAction.createdAt,
        tree: summarizeTileTree(get().tiles),
      });
    },

    renameTile: async (id: string, title: string) => {
      await get().updateTile(id, { title });
    },

    reorderTiles: async (orderedIds: string[]) => {
      const state = cloneAppState(get().appState);
      const sourceContainerId = findContainerIdForItem(state, orderedIds[0]);
      if (!sourceContainerId) return;
      const container = state.containers[sourceContainerId];
      const orderedSet = new Set(orderedIds);
      const remaining = container.childrenIds.filter((id) => !orderedSet.has(id));
      container.childrenIds = sortIdsByPinnedQueue(state, [...orderedIds, ...remaining].filter((id) => state.items[id]));
      container.updatedAt = Date.now();
      const sourceFolder = sourceContainerId === ROOT_CONTAINER_ID ? undefined : state.items[sourceContainerId];
      if (isBookmarkReferenceItem(sourceFolder)) {
        for (const [index, itemId] of container.childrenIds.entries()) {
          await moveBrowserBookmark(state.items[itemId], sourceFolder.bookmarkId, index);
        }
      }

      logTileDebug('store:reorder:start', {
        parentId: sourceContainerId === ROOT_CONTAINER_ID ? null : sourceContainerId,
        orderedIds,
        before: parentOrderSnapshot(get().tiles, sourceContainerId === ROOT_CONTAINER_ID ? null : sourceContainerId),
      });
      await commitAppState(state);
      logTileDebug('store:reorder:committed', {
        parentId: sourceContainerId === ROOT_CONTAINER_ID ? null : sourceContainerId,
        orderedIds,
      });
    },

    moveTile: async (tileId: string, destinationParentId: SurfaceParentId) => {
      const state = cloneAppState(get().appState);
      const item = state.items[tileId];
      const destinationContainerId = destinationParentId || ROOT_CONTAINER_ID;
      const sourceContainerId = findContainerIdForItem(state, tileId);

      logTileDebug('store:move-to-folder:start', {
        tileId,
        folderId: destinationParentId,
        tile: summarizeTile(item),
        sourceBefore: parentOrderSnapshot(get().tiles, sourceContainerId === ROOT_CONTAINER_ID ? null : sourceContainerId),
        destinationBefore: parentOrderSnapshot(get().tiles, destinationParentId),
      });

      if (!item || !sourceContainerId || !state.containers[destinationContainerId]) {
        logTileDebug('store:move-to-folder:missing-target', { tileId, destinationParentId });
        return;
      }
      if (destinationContainerId !== ROOT_CONTAINER_ID) {
        const destinationFolder = state.items[destinationContainerId];
        if (!destinationFolder || destinationFolder.type !== 'folder' || destinationFolder.id === tileId) {
          logTileDebug('store:move-to-folder:invalid-folder', { tileId, destinationParentId });
          return;
        }
      }
      if (item.type === 'folder' && isContainerDescendantOf(state, destinationContainerId, item.id)) {
        logTileDebug('store:move-to-folder:cycle-blocked', { tileId, destinationParentId });
        return;
      }

      const destinationFolder = destinationContainerId === ROOT_CONTAINER_ID ? undefined : state.items[destinationContainerId];
      const sourceFolder = sourceContainerId === ROOT_CONTAINER_ID ? undefined : state.items[sourceContainerId];
      if (isBookmarkReferenceItem(sourceFolder) && isBookmarkReferenceItem(item) && !isBookmarkReferenceItem(destinationFolder)) {
        const localCopyId = cloneItemSubtreeToLocal(state, tileId);
        if (!localCopyId) return;
        await removeBrowserBookmark(item);
        removeItemIds(state, collectItemAndDescendantIds(state, tileId));
        insertItemIntoContainer(state, destinationContainerId, localCopyId);
        await commitAppState(state);
        logTileDebug('store:move-to-folder:committed', {
          tileId: localCopyId,
          originalTileId: tileId,
          folderId: destinationParentId,
          referenceDetached: true,
        });
        return;
      }

      if (isBookmarkReferenceItem(destinationFolder) && !isBookmarkReferenceItem(item)) {
        const newId = await addLocalItemToBookmarkReference(
          state,
          tileId,
          destinationFolder.bookmarkId,
          state.containers[destinationContainerId].childrenIds.length
        );
        if (!newId) return;
        removeItemIds(state, collectItemAndDescendantIds(state, tileId));
        insertItemIntoContainer(state, destinationContainerId, newId);
        await commitAppState(state);
        logTileDebug('store:move-to-folder:committed', {
          tileId: newId,
          folderId: destinationParentId,
          referenceCreated: true,
        });
        return;
      }

      if (isBookmarkReferenceItem(destinationFolder) && isBookmarkReferenceItem(item)) {
        await moveBrowserBookmark(item, destinationFolder.bookmarkId, state.containers[destinationContainerId].childrenIds.length);
      }

      state.containers[sourceContainerId].childrenIds = state.containers[sourceContainerId].childrenIds.filter((id) => id !== tileId);
      state.containers[destinationContainerId].childrenIds.push(tileId);
      state.containers[sourceContainerId].childrenIds = sortIdsByPinnedQueue(state, state.containers[sourceContainerId].childrenIds);
      state.containers[destinationContainerId].childrenIds = sortIdsByPinnedQueue(state, state.containers[destinationContainerId].childrenIds);
      state.containers[sourceContainerId].updatedAt = Date.now();
      state.containers[destinationContainerId].updatedAt = Date.now();
      if (item.type === 'folder' && state.containers[item.id]) {
        state.containers[item.id].parentId = destinationContainerId;
      }
      item.updatedAt = Date.now();

      await commitAppState(state);
      logTileDebug('store:move-to-folder:committed', {
        tileId,
        folderId: destinationParentId,
      });
    },

    moveTileToFolder: async (tileId: string, folderId: SurfaceParentId) => {
      await get().moveTile(tileId, folderId);
    },

    removeTileFromFolder: async (tileId: string) => {
      await get().moveTile(tileId, null);
    },

    pinTile: async (id: string) => {
      const state = cloneAppState(get().appState);
      const item = state.items[id];
      const sourceContainerId = findContainerIdForItem(state, id);
      if (!item || !sourceContainerId) return;

      item.pinnedAt = item.pinnedAt || Date.now();
      item.updatedAt = Date.now();
      const container = state.containers[sourceContainerId];
      container.childrenIds = sortIdsByPinnedQueue(state, container.childrenIds.filter((childId) => state.items[childId]));
      container.updatedAt = Date.now();

      const sourceFolder = sourceContainerId === ROOT_CONTAINER_ID ? undefined : state.items[sourceContainerId];
      if (isBookmarkReferenceItem(sourceFolder)) {
        for (const [index, itemId] of container.childrenIds.entries()) {
          await moveBrowserBookmark(state.items[itemId], sourceFolder.bookmarkId, index);
        }
      }

      await commitAppState(state);
      logTileDebug('store:pin:committed', {
        id,
        parentId: sourceContainerId === ROOT_CONTAINER_ID ? null : sourceContainerId,
        pinnedAt: item.pinnedAt,
        order: parentOrderSnapshot(get().tiles, sourceContainerId === ROOT_CONTAINER_ID ? null : sourceContainerId),
      });
    },

    unpinTile: async (id: string) => {
      const state = cloneAppState(get().appState);
      const item = state.items[id];
      const sourceContainerId = findContainerIdForItem(state, id);
      if (!item || !sourceContainerId) return;

      delete item.pinnedAt;
      item.updatedAt = Date.now();
      const container = state.containers[sourceContainerId];
      container.childrenIds = sortIdsByPinnedQueue(state, container.childrenIds.filter((childId) => state.items[childId]));
      container.updatedAt = Date.now();

      const sourceFolder = sourceContainerId === ROOT_CONTAINER_ID ? undefined : state.items[sourceContainerId];
      if (isBookmarkReferenceItem(sourceFolder)) {
        for (const [index, itemId] of container.childrenIds.entries()) {
          await moveBrowserBookmark(state.items[itemId], sourceFolder.bookmarkId, index);
        }
      }

      await commitAppState(state);
      logTileDebug('store:unpin:committed', {
        id,
        parentId: sourceContainerId === ROOT_CONTAINER_ID ? null : sourceContainerId,
        order: parentOrderSnapshot(get().tiles, sourceContainerId === ROOT_CONTAINER_ID ? null : sourceContainerId),
      });
    },

    createFolder: async (sourceTileId: string, targetTileId: string) => {
      const state = cloneAppState(get().appState);
      const source = state.items[sourceTileId];
      const target = state.items[targetTileId];
      const sourceContainerId = findContainerIdForItem(state, sourceTileId);
      const targetContainerId = findContainerIdForItem(state, targetTileId);

      logTileDebug('store:create-folder:start', {
        sourceTileId,
        targetTileId,
        source: summarizeTile(source),
        target: summarizeTile(target),
        parentBefore: parentOrderSnapshot(get().tiles, sourceContainerId === ROOT_CONTAINER_ID ? null : sourceContainerId),
      });

      if (!source || !target || source.type !== 'tile' || target.type !== 'tile') {
        logTileDebug('store:create-folder:type-blocked', {
          source: summarizeTile(source),
          target: summarizeTile(target),
        });
        return null;
      }
      if (!sourceContainerId || sourceContainerId !== targetContainerId) {
        logTileDebug('store:create-folder:parent-mismatch', {
          source: summarizeTile(source),
          target: summarizeTile(target),
        });
        return null;
      }

      const now = Date.now();
      const container = state.containers[sourceContainerId];
      const sourceIndex = container.childrenIds.indexOf(sourceTileId);
      const targetIndex = container.childrenIds.indexOf(targetTileId);
      const insertIndex = Math.min(sourceIndex, targetIndex);
      const parentFolder = sourceContainerId === ROOT_CONTAINER_ID ? undefined : state.items[sourceContainerId];
      const bookmarks = getBookmarkWriteApi();
      const createdBookmarkFolder = isBookmarkReferenceItem(parentFolder)
        && isBookmarkReferenceItem(source)
        && isBookmarkReferenceItem(target)
        && bookmarks?.create
        ? await bookmarks.create({
            parentId: parentFolder.bookmarkId,
            title: 'Новая папка',
            index: insertIndex,
          })
        : null;

      if (createdBookmarkFolder && bookmarks?.move && isBookmarkReferenceItem(source) && isBookmarkReferenceItem(target)) {
        await bookmarks.move(target.bookmarkId, { parentId: createdBookmarkFolder.id, index: 0 });
        await bookmarks.move(source.bookmarkId, { parentId: createdBookmarkFolder.id, index: 1 });
      }

      const folder = createFolderItem({
        id: createdBookmarkFolder ? makeBookmarkItemId(createdBookmarkFolder.id) : crypto.randomUUID(),
        title: 'Новая папка',
        childrenIds: [targetTileId, sourceTileId],
        source: createdBookmarkFolder ? 'bookmark' : 'manual',
        bookmarkId: createdBookmarkFolder?.id,
        bookmarkMode: createdBookmarkFolder ? 'reference' : undefined,
        createdAt: now,
        updatedAt: now,
      });

      container.childrenIds = container.childrenIds.filter((id) => id !== sourceTileId && id !== targetTileId);
      container.childrenIds.splice(insertIndex, 0, folder.id);
      container.updatedAt = now;
      state.items[folder.id] = folder;
      state.containers[folder.id] = {
        id: folder.id,
        title: folder.title,
        parentId: sourceContainerId,
        childrenIds: [targetTileId, sourceTileId],
        createdAt: now,
        updatedAt: now,
      };
      source.updatedAt = now;
      target.updatedAt = now;

      await commitAppState(state);
      logTileDebug('store:create-folder:committed', {
        folder: summarizeTile(folder),
        tree: summarizeTileTree(get().tiles),
      });
      return appStateToTiles(get().appState).find((tile) => tile.id === folder.id) || null;
    },

    createFolderFromTiles: async (sourceTileId: string, targetTileId: string) => {
      return get().createFolder(sourceTileId, targetTileId);
    },

    openFolder: (folderId: string, surfaceLevel = 0) => {
      const state = cloneAppState(get().appState);
      if (!state.containers[folderId]) return;
      state.containerStack = [...state.containerStack.slice(0, surfaceLevel + 1), folderId];
      state.currentContainerId = folderId;
      state.dragState = null;
      const normalized = normalizeAppState(state);
      set({
        appState: normalized,
        tiles: appStateToTiles(normalized),
        openFolderIds: normalized.containerStack.slice(1),
      });
      void writePersistedState(normalized);
    },

    closeFolder: (surfaceLevel = 0) => {
      const state = cloneAppState(get().appState);
      state.containerStack = state.containerStack.slice(0, surfaceLevel + 1);
      if (state.containerStack.length === 0) state.containerStack = [ROOT_CONTAINER_ID];
      state.currentContainerId = state.containerStack[state.containerStack.length - 1] || ROOT_CONTAINER_ID;
      state.dragState = null;
      const normalized = normalizeAppState(state);
      set({
        appState: normalized,
        tiles: appStateToTiles(normalized),
        openFolderIds: normalized.containerStack.slice(1),
      });
      void writePersistedState(normalized);
    },

    setDragState: (dragState) => {
      const state = cloneAppState(get().appState);
      state.dragState = dragState;
      const normalized = normalizeAppState(state);
      set({ appState: normalized });
    },

    syncBookmarks: async () => {
      const current = get().appState;
      const referenceRootIds = getReferenceRootFolderIds(current);
      if (referenceRootIds.length === 0) return;

      const state = cloneAppState(current);
      for (const rootId of referenceRootIds) {
        const currentRoot = state.items[rootId];
        if (!isBookmarkReferenceItem(currentRoot)) continue;
        const parentContainerId = findContainerIdForItem(state, rootId) || ROOT_CONTAINER_ID;
        const parentContainer = state.containers[parentContainerId];
        const insertIndex = Math.max(0, parentContainer?.childrenIds.indexOf(rootId) ?? parentContainer?.childrenIds.length ?? 0);
        const subtree = await readBookmarkSubTree(currentRoot.bookmarkId);
        if (!subtree) continue;
        const pinnedAt = currentRoot.pinnedAt;

        const idsToReplace = collectItemAndDescendantIds(state, rootId);
        removeItemIds(state, idsToReplace);
        const nextRootId = addBookmarkNodeToState({
          state,
          node: subtree,
          parentContainerId,
          mode: 'reference',
        });
        if (!nextRootId || !state.containers[parentContainerId]) continue;
        if (pinnedAt && state.items[nextRootId]) {
          state.items[nextRootId].pinnedAt = pinnedAt;
        }
        state.containers[parentContainerId].childrenIds.splice(insertIndex, 0, nextRootId);
        state.containers[parentContainerId].childrenIds = sortIdsByPinnedQueue(
          state,
          state.containers[parentContainerId].childrenIds
        );
        state.containers[parentContainerId].updatedAt = Date.now();
      }

      await commitAppState(state);
      logTileDebug('store:bookmarks:sync', {
        count: referenceRootIds.length,
        tree: summarizeTileTree(get().tiles),
      });
    },

    importBookmarks: async () => {
      logTileDebug('store:bookmarks:import', {
        count: 0,
        reason: 'disabled-auto-import',
        tree: summarizeTileTree(get().tiles),
      });
    },

    listBookmarkFolders: async () => {
      const roots = await readBookmarkRoots();
      return listBookmarkFoldersFromNodes(roots);
    },

    addBookmarkFolder: async (bookmarkFolderId, mode, destinationParentId = null) => {
      const subtree = await readBookmarkSubTree(bookmarkFolderId);
      if (!subtree || subtree.url || subtree.type === 'separator') return null;

      const state = cloneAppState(get().appState);
      const containerId = destinationParentId || ROOT_CONTAINER_ID;
      if (!state.containers[containerId]) return null;

      const rootId = addBookmarkNodeToState({
        state,
        node: subtree,
        parentContainerId: containerId,
        mode,
      });
      if (!rootId) return null;

      insertItemIntoContainer(state, containerId, rootId);
      await commitAppState(state);
      logTileDebug('store:bookmarks:add-folder', {
        bookmarkFolderId,
        mode,
        rootId,
        destinationParentId,
      });
      return appStateToTiles(get().appState).find((tile) => tile.id === rootId) || null;
    },

    detachBookmarkReference: async (id: string) => {
      const state = cloneAppState(get().appState);
      const item = state.items[id];
      const parentContainerId = findContainerIdForItem(state, id);
      if (!item || !parentContainerId || !isBookmarkReferenceItem(item)) return;
      if (isInsideBookmarkReferenceContainer(state, id)) return;

      const parentContainer = state.containers[parentContainerId];
      if (!parentContainer) return;
      const insertIndex = Math.max(0, parentContainer.childrenIds.indexOf(id));
      const localCopyId = cloneItemSubtreeToLocal(state, id);
      if (!localCopyId) return;

      const idsToRemove = collectItemAndDescendantIds(state, id);
      removeItemIds(state, idsToRemove);

      const nextParentContainer = state.containers[parentContainerId];
      if (!nextParentContainer) return;
      nextParentContainer.childrenIds.splice(insertIndex, 0, localCopyId);
      nextParentContainer.updatedAt = Date.now();
      if (state.containers[localCopyId]) {
        state.containers[localCopyId].parentId = parentContainerId;
      }

      await commitAppState(state);
      logTileDebug('store:bookmarks:detach-reference', {
        id,
        localCopyId,
        parentContainerId,
      });
    },

    applyAccentColorToAllTiles: async (color: string) => {
      const normalizedColor = color.trim();
      if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalizedColor)) return { updated: 0 };

      const state = cloneAppState(get().appState);
      let updated = 0;
      const now = Date.now();
      for (const item of Object.values(state.items)) {
        item.tileAccentColor = normalizedColor;
        item.updatedAt = now;
        updated += 1;
      }

      await commitAppState(state);
      logTileDebug('store:accent-color:applied', { color: normalizedColor, updated });
      return { updated };
    },

    clearAccentColorFromAllTiles: async () => {
      const state = cloneAppState(get().appState);
      let updated = 0;
      const now = Date.now();
      for (const item of Object.values(state.items)) {
        if (!item.tileAccentColor) continue;
        item.tileAccentColor = undefined;
        item.updatedAt = now;
        updated += 1;
      }

      await commitAppState(state);
      logTileDebug('store:accent-color:cleared', { updated });
      return { updated };
    },

    optimizeMediaAssets: async () => {
      const result = await optimizeAppStateMedia(get().appState);
      await writePersistedState(result.state);
      set({
        appState: result.state,
        tiles: appStateToTiles(result.state),
        openFolderIds: result.state.containerStack.slice(1),
        error: null,
      });
      logTileDebug('store:media:optimized', { optimized: result.optimized });
      return { optimized: result.optimized };
    },

    restoreMediaAssets: async () => {
      const result = await restoreAppStateMedia(get().appState);
      await writePersistedState(result.state);
      set({
        appState: result.state,
        tiles: appStateToTiles(result.state),
        openFolderIds: result.state.containerStack.slice(1),
        error: null,
      });
      logTileDebug('store:media:restored', { restored: result.restored });
      return { restored: result.restored };
    },

    getSurfaceItems: (parentId: SurfaceParentId) => {
      return getSurfaceItems(get().tiles, parentId);
    },

    getTilesByParent: (parentId: string | null) => {
      return get().getSurfaceItems(parentId);
    },

    getFolderChildren: (folderId: string) => {
      return get().getTilesByParent(folderId);
    },

    getRootTiles: () => {
      return get().getTilesByParent(null);
    },
  };
});

setTileDebugSnapshotProvider(() => {
  const { appState, tiles, loading, error, openFolderIds } = useTileStore.getState();
  return {
    loading,
    error,
    schemaVersion: GRID_SCHEMA_VERSION,
    currentContainerId: appState.currentContainerId,
    openFolderIds,
    containerCount: Object.keys(appState.containers).length,
    itemCount: Object.keys(appState.items).length,
    count: tiles.length,
    root: parentOrderSnapshot(tiles, null),
    tree: summarizeTileTree(tiles),
  };
});
