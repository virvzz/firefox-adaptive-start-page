import type { Tile } from '../types';

const STORAGE_KEY = 'fasp.debug.tiles';
const OVERLAY_STORAGE_KEY = 'fasp.debug.tiles.overlay';
const CONSOLE_STORAGE_KEY = 'fasp.debug.tiles.console';
const LOG_DB_NAME = 'fasp-debug-log';
const LOG_STORE_NAME = 'entries';
const LOG_DB_VERSION = 1;
const BUFFER_LIMIT = 600;
const TRACE_BUFFER_LIMIT = 300;
const PERSIST_FLUSH_INTERVAL_MS = 180;
const PERSIST_FLUSH_BATCH_SIZE = 40;
const MAX_SANITIZE_DEPTH = 10;
const OVERLAY_CHANGE_EVENT = 'fasp-debug-overlay-change';

export interface TileDebugRecord {
  index: number;
  time: string;
  ms: number;
  event: string;
  data?: unknown;
  pointer: PointerDebugState;
}

export interface TileDebugTraceRecord {
  index: number;
  time: string;
  ms: number;
  from: string;
  to: string;
  source?: unknown;
  target?: unknown;
  reason?: string;
  summary: string;
  context?: unknown;
}

export interface DebugRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  center: {
    x: number;
    y: number;
  };
}

export interface PointerDebugState {
  x: number | null;
  y: number | null;
  buttons: number;
  button: number | null;
  leftDown: boolean;
  rightDown: boolean;
  middleDown: boolean;
  pointerType: string | null;
  eventType: string | null;
  target: unknown;
  updatedAt: string | null;
}

interface FaspDebugApi {
  enable: () => boolean;
  disable: () => boolean;
  clear: () => Promise<void>;
  clearLogFile: () => Promise<void>;
  dump: () => TileDebugRecord[];
  dumpText: () => string;
  readLogFile: () => Promise<string>;
  saveLogFile: () => Promise<string>;
  flushLogFile: () => Promise<number>;
  trace: () => TileDebugTraceRecord[];
  traceText: () => string;
  telemetry: () => unknown;
  geometry: () => unknown;
  objects: () => unknown[];
  overlay: (nextEnabled?: boolean) => boolean;
  pointer: () => PointerDebugState;
  snapshot: () => unknown;
  state: () => unknown;
  mark: (event: string, data?: unknown) => void;
  console: (nextEnabled?: boolean) => boolean;
  isEnabled: () => boolean;
  isOverlayEnabled: () => boolean;
  isConsoleEnabled: () => boolean;
}

declare global {
  interface Window {
    faspDebug?: FaspDebugApi;
  }
}

type TileLike = Partial<Tile> & {
  id: string;
  title?: string;
  type?: string;
  order?: number;
};

const records: TileDebugRecord[] = [];
const traceRecords: TileDebugTraceRecord[] = [];
let enabled = readStoredEnabled();
let overlayEnabled = readStoredOverlayEnabled();
let consoleEnabled = readStoredConsoleEnabled();
let snapshotProvider: (() => unknown) | null = null;
let pointerListenersInstalled = false;
let lifecycleFlushListenersInstalled = false;
let dragTelemetryState = 'IDLE';
let dragTelemetryContext: unknown = null;
const debugSessionId = `fasp-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(16).slice(2)}`;
let persistentDbPromise: Promise<IDBDatabase> | null = null;
let pendingPersistentRecords: TileDebugRecord[] = [];
let persistentFlushTimer: number | null = null;
let persistentFlushPromise: Promise<number> = Promise.resolve(0);
let pointerState: PointerDebugState = {
  x: null,
  y: null,
  buttons: 0,
  button: null,
  leftDown: false,
  rightDown: false,
  middleDown: false,
  pointerType: null,
  eventType: null,
  target: null,
  updatedAt: null,
};

function readStoredEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function readStoredOverlayEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(OVERLAY_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function readStoredConsoleEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(CONSOLE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function setStoredEnabled(nextEnabled: boolean): void {
  enabled = nextEnabled;
  if (nextEnabled) installPointerDebugListeners();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, nextEnabled ? '1' : '0');
    }
  } catch {
    // The runtime flag still works if storage is unavailable.
  }
}

function setStoredConsoleEnabled(nextEnabled: boolean): boolean {
  consoleEnabled = nextEnabled;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CONSOLE_STORAGE_KEY, nextEnabled ? '1' : '0');
    }
  } catch {
    // The runtime flag still works if storage is unavailable.
  }
  return nextEnabled;
}

export function isTileDebugConsoleEnabled(): boolean {
  return consoleEnabled || readStoredConsoleEnabled();
}

export function setTileDebugOverlayEnabled(nextEnabled: boolean): boolean {
  overlayEnabled = nextEnabled;
  if (nextEnabled) installPointerDebugListeners();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(OVERLAY_STORAGE_KEY, nextEnabled ? '1' : '0');
    }
  } catch {
    // The runtime flag still works if storage is unavailable.
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OVERLAY_CHANGE_EVENT, { detail: { enabled: nextEnabled } }));
  }

  return nextEnabled;
}

export function isTileDebugOverlayEnabled(): boolean {
  return overlayEnabled || readStoredOverlayEnabled();
}

export function getTileDebugOverlayChangeEventName(): string {
  return OVERLAY_CHANGE_EVENT;
}

function getRuntimeMs(): number {
  if (typeof performance !== 'undefined') return Math.round(performance.now());
  return Date.now();
}

function getPersistentDb(): Promise<IDBDatabase> {
  if (persistentDbPromise) return persistentDbPromise;

  persistentDbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available for FASP debug logging.'));
      return;
    }

    const request = indexedDB.open(LOG_DB_NAME, LOG_DB_VERSION);
    request.onerror = () => reject(request.error || new Error('Failed to open FASP debug log DB.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOG_STORE_NAME)) {
        const store = db.createObjectStore(LOG_STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('sessionId', 'sessionId');
        store.createIndex('time', 'time');
        store.createIndex('event', 'event');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        persistentDbPromise = null;
      };
      resolve(db);
    };
  });

  return persistentDbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
  });
}

function schedulePersistentFlush(): void {
  if (typeof window === 'undefined') return;
  if (persistentFlushTimer !== null) return;

  persistentFlushTimer = window.setTimeout(() => {
    persistentFlushTimer = null;
    void flushPersistentLog();
  }, PERSIST_FLUSH_INTERVAL_MS);
}

function queuePersistentRecord(record: TileDebugRecord): void {
  if (!shouldPersistRecord(record)) return;
  pendingPersistentRecords.push(record);
  if (pendingPersistentRecords.length >= PERSIST_FLUSH_BATCH_SIZE) {
    void flushPersistentLog();
    return;
  }
  schedulePersistentFlush();
}

function shouldPersistRecord(record: TileDebugRecord): boolean {
  if (record.event === 'telemetry:state-change') return true;
  if (record.event.startsWith('telemetry:') && !record.event.includes('drag-context')) return true;
  if (record.event === 'drag:start' || record.event === 'drag:end' || record.event === 'drag:cancel') return true;
  if (record.event === 'drag:end:action' || record.event === 'drag:end:no-op') return true;
  if (record.event.startsWith('store:create-folder:')) return true;
  if (record.event.startsWith('store:move-to-folder:')) return true;
  if (record.event.startsWith('store:reorder:')) return true;
  if (record.event.startsWith('store:remove:')) return true;
  if (record.event.startsWith('mark:')) return true;
  return false;
}

export function flushPersistentLog(): Promise<number> {
  if (persistentFlushTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(persistentFlushTimer);
    persistentFlushTimer = null;
  }

  const batch = pendingPersistentRecords;
  pendingPersistentRecords = [];
  if (batch.length === 0) return persistentFlushPromise.then(() => 0);

  persistentFlushPromise = persistentFlushPromise.then(async () => {
    const db = await getPersistentDb();
    const transaction = db.transaction(LOG_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(LOG_STORE_NAME);

    for (const record of batch) {
      store.add({
        sessionId: debugSessionId,
        index: record.index,
        time: record.time,
        ms: record.ms,
        event: record.event,
        line: JSON.stringify(record),
      });
    }

    await transactionDone(transaction);
    return batch.length;
  }).catch((error) => {
    // Keep logging usable even if persistent storage is temporarily unavailable.
    if (isTileDebugConsoleEnabled()) console.warn('[FASP tiles] failed to persist debug log', error);
    return 0;
  });

  return persistentFlushPromise;
}

export async function readPersistentLogText(): Promise<string> {
  await flushPersistentLog();
  const db = await getPersistentDb();
  const transaction = db.transaction(LOG_STORE_NAME, 'readonly');
  const store = transaction.objectStore(LOG_STORE_NAME);
  const entries = await requestToPromise<Array<{ line?: string }>>(store.getAll());
  await transactionDone(transaction);
  return entries.map((entry) => entry.line).filter((line): line is string => Boolean(line)).join('\n');
}

export async function clearPersistentLog(): Promise<void> {
  pendingPersistentRecords = [];
  if (persistentFlushTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(persistentFlushTimer);
    persistentFlushTimer = null;
  }
  const db = await getPersistentDb();
  const transaction = db.transaction(LOG_STORE_NAME, 'readwrite');
  transaction.objectStore(LOG_STORE_NAME).clear();
  await transactionDone(transaction);
}

function getLogFilename(): string {
  return `fasp-dnd-log-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
}

export async function savePersistentLogFile(): Promise<string> {
  const text = await readPersistentLogText();
  const filename = getLogFilename();
  const blob = new Blob([text ? `${text}\n` : ''], { type: 'application/x-ndjson;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    let downloaded = false;
    const browserWithDownloads = typeof browser !== 'undefined'
      ? browser as typeof browser & {
        downloads?: {
          download: (details: {
            url: string;
            filename: string;
            saveAs?: boolean;
            conflictAction?: 'uniquify' | 'overwrite' | 'prompt';
          }) => Promise<unknown>;
        };
      }
      : null;
    if (browserWithDownloads?.downloads?.download) {
      try {
        await browserWithDownloads.downloads.download({
          url,
          filename,
          saveAs: false,
          conflictAction: 'uniquify',
        });
        downloaded = true;
      } catch {
        downloaded = false;
      }
    }

    if (!downloaded) {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return filename;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTileLike(value: unknown): value is TileLike {
  if (!isObject(value)) return false;
  if ('rect' in value || 'mergeZoneRect' in value || 'surfaceParentId' in value || 'level' in value) return false;
  return typeof value.id === 'string' && ('type' in value || 'order' in value || 'parentId' in value);
}

function shortId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.length > 8 ? id.slice(0, 8) : id;
}

function safeHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 48);
  }
}

function summarizeEventTarget(target: EventTarget | null): unknown {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return null;

  const tileElement = target.closest<HTMLElement>('[data-tile-id]');
  const surfaceElement = target.closest<HTMLElement>('[data-tile-surface]');
  const folderPanel = target.closest<HTMLElement>('[data-folder-panel]');
  const className = typeof target.className === 'string' ? target.className : '';

  return {
    tag: target.tagName.toLowerCase(),
    className,
    tileId: tileElement?.dataset.tileId || null,
    tileType: tileElement?.dataset.tileType || null,
    tileParentId: tileElement?.dataset.tileParentId || null,
    surfaceParentId: surfaceElement?.dataset.parentId || null,
    surfaceLevel: surfaceElement?.dataset.level || null,
    folderPanelParentId: folderPanel?.dataset.parentId || null,
  };
}

function updatePointerState(event: MouseEvent | PointerEvent, eventType: string): void {
  const buttons = event.buttons ?? pointerState.buttons;
  pointerState = {
    x: round(event.clientX),
    y: round(event.clientY),
    buttons,
    button: event.button,
    leftDown: Boolean(buttons & 1),
    rightDown: Boolean(buttons & 2),
    middleDown: Boolean(buttons & 4),
    pointerType: 'pointerType' in event ? event.pointerType : 'mouse',
    eventType,
    target: summarizeEventTarget(event.target),
    updatedAt: new Date().toISOString(),
  };
}

function resetPointerButtons(eventType: string): void {
  pointerState = {
    ...pointerState,
    buttons: 0,
    button: null,
    leftDown: false,
    rightDown: false,
    middleDown: false,
    eventType,
    updatedAt: new Date().toISOString(),
  };
}

function installPointerDebugListeners(): void {
  if (typeof window === 'undefined' || pointerListenersInstalled) return;
  pointerListenersInstalled = true;

  const update = (event: MouseEvent | PointerEvent) => updatePointerState(event, event.type);
  const options: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener('pointermove', update, options);
  window.addEventListener('pointerdown', update, options);
  window.addEventListener('pointerup', update, options);
  window.addEventListener('pointercancel', update, options);
  window.addEventListener('mousemove', update, options);
  window.addEventListener('mousedown', update, options);
  window.addEventListener('mouseup', update, options);
  window.addEventListener('contextmenu', update, options);
  window.addEventListener('blur', () => resetPointerButtons('window-blur'), options);
}

export function getPointerDebugSnapshot(): PointerDebugState {
  return { ...pointerState };
}

export function getElementDebugRect(element: Element | null | undefined): DebugRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    left: round(rect.left),
    top: round(rect.top),
    right: round(rect.right),
    bottom: round(rect.bottom),
    width: round(rect.width),
    height: round(rect.height),
    center: {
      x: round(rect.left + rect.width / 2),
      y: round(rect.top + rect.height / 2),
    },
  };
}

export function getTileDebugRect(tileId: string | null | undefined): DebugRect | null {
  if (!tileId || typeof document === 'undefined') return null;
  const tileElements = document.querySelectorAll<HTMLElement>('[data-tile-id]');
  for (const element of tileElements) {
    if (element.dataset.tileId === tileId) return getElementDebugRect(element);
  }
  return null;
}

function getMergeZoneRect(rect: DebugRect | null, insetRatio = 0.18): DebugRect | null {
  if (!rect) return null;
  const insetX = rect.width * insetRatio;
  const insetY = rect.height * insetRatio;
  const left = rect.left + insetX;
  const top = rect.top + insetY;
  const width = rect.width - insetX * 2;
  const height = rect.height - insetY * 2;
  return {
    left: round(left),
    top: round(top),
    right: round(left + width),
    bottom: round(top + height),
    width: round(width),
    height: round(height),
    center: {
      x: round(left + width / 2),
      y: round(top + height / 2),
    },
  };
}

function getEdgeZoneRects(rect: DebugRect | null, centerRect: DebugRect | null): unknown {
  if (!rect || !centerRect) return null;
  return {
    top: {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: centerRect.top,
      width: rect.width,
      height: round(centerRect.top - rect.top),
    },
    right: {
      left: centerRect.right,
      top: centerRect.top,
      right: rect.right,
      bottom: centerRect.bottom,
      width: round(rect.right - centerRect.right),
      height: centerRect.height,
    },
    bottom: {
      left: rect.left,
      top: centerRect.bottom,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: round(rect.bottom - centerRect.bottom),
    },
    left: {
      left: rect.left,
      top: centerRect.top,
      right: centerRect.left,
      bottom: centerRect.bottom,
      width: round(centerRect.left - rect.left),
      height: centerRect.height,
    },
  };
}

function elementTextAttr(element: HTMLElement, attr: string): string | null {
  return element.getAttribute(attr) || null;
}

export function getTileDebugGeometrySnapshot(): unknown {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;

  const viewport = {
    width: round(window.innerWidth),
    height: round(window.innerHeight),
    scrollX: round(window.scrollX),
    scrollY: round(window.scrollY),
  };

  const surfaces = Array.from(document.querySelectorAll<HTMLElement>('[data-tile-surface]')).map((element) => ({
    parentId: element.dataset.parentId || null,
    level: element.dataset.level ? Number(element.dataset.level) : null,
    title: element.dataset.folderTitle || null,
    tileCount: element.querySelectorAll('[data-tile-id]').length,
    rect: getElementDebugRect(element),
    classes: element.className,
  }));

  const folderPanels = Array.from(document.querySelectorAll<HTMLElement>('[data-folder-panel]')).map((element) => ({
    parentId: element.dataset.parentId || null,
    level: element.dataset.level ? Number(element.dataset.level) : null,
    title: element.dataset.folderTitle || null,
    openState: element.dataset.folderState || null,
    draggingOut: element.dataset.draggingOut === 'true',
    rect: getElementDebugRect(element),
    classes: element.className,
  }));

  const folderOverlays = Array.from(document.querySelectorAll<HTMLElement>('[data-folder-overlay]')).map((element) => ({
    parentId: element.dataset.parentId || null,
    level: element.dataset.level ? Number(element.dataset.level) : null,
    title: element.dataset.folderTitle || null,
    openState: element.dataset.folderState || null,
    draggingOut: element.dataset.draggingOut === 'true',
    rect: getElementDebugRect(element),
    classes: element.className,
  }));

  const tiles = Array.from(document.querySelectorAll<HTMLElement>('[data-tile-id]')).map((element) => {
    const rect = getElementDebugRect(element);
    const folderCreateZoneRect = getMergeZoneRect(rect);
    const surfaceElement = element.closest<HTMLElement>('[data-tile-surface]');
    return {
      id: element.dataset.tileId || null,
      type: element.dataset.tileType || null,
      title: elementTextAttr(element, 'data-tile-title'),
      parentId: element.dataset.tileParentId || null,
      order: element.dataset.tileOrder ? Number(element.dataset.tileOrder) : null,
      index: element.dataset.tileOrder ? Number(element.dataset.tileOrder) : null,
      surfaceParentId: surfaceElement?.dataset.parentId || null,
      level: surfaceElement?.dataset.level ? Number(surfaceElement.dataset.level) : null,
      rect,
      hitboxRect: rect,
      mergeZoneRect: folderCreateZoneRect,
      folderCreateZoneRect,
      reorderMidpoint: rect?.center || null,
      reorderEdgeZones: getEdgeZoneRects(rect, folderCreateZoneRect),
      classes: element.className,
    };
  });

  return {
    viewport,
    pointer: getPointerDebugSnapshot(),
    surfaces,
    folderPanels,
    folderOverlays,
    tiles,
  };
}

export function summarizeTile(tile: Tile | TileLike | null | undefined): unknown {
  if (!tile) return null;
  return {
    id: shortId(tile.id),
    fullId: tile.id,
    type: tile.type,
    title: tile.title,
    parentId: tile.parentId || null,
    parentShort: shortId(tile.parentId),
    order: tile.order,
    host: safeHost(tile.url),
  };
}

export function summarizeTileOrder(tiles: Tile[]): unknown[] {
  return [...tiles]
    .sort((a, b) => a.order - b.order)
    .map((tile) => summarizeTile(tile));
}

export function summarizeTileTree(tiles: Tile[]): unknown[] {
  const childrenByParent = new Map<string, Tile[]>();

  for (const tile of tiles) {
    const parentKey = tile.parentId || 'root';
    const siblings = childrenByParent.get(parentKey) || [];
    siblings.push(tile);
    childrenByParent.set(parentKey, siblings);
  }

  const buildLevel = (parentId: string | null, depth = 0): unknown[] => {
    if (depth > 12) return ['depth-limit'];

    return (childrenByParent.get(parentId || 'root') || [])
      .sort((a, b) => a.order - b.order)
      .map((tile) => {
        const summary = summarizeTile(tile) as Record<string, unknown>;
        if (tile.type === 'folder') {
          summary.children = buildLevel(tile.id, depth + 1);
        }
        return summary;
      });
  };

  return buildLevel(null);
}

function sanitize(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (depth > MAX_SANITIZE_DEPTH) return '[depth-limit]';
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, seen, depth + 1));
  }
  if (!isObject(value)) return value;
  if (isTileLike(value)) return summarizeTile(value);
  if (seen.has(value)) return '[circular]';

  seen.add(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, sanitize(entry, seen, depth + 1)])
  );
}

export function isTileDebugEnabled(): boolean {
  return enabled || readStoredEnabled();
}

export function logTileDebug(event: string, data?: unknown): void {
  if (!isTileDebugEnabled()) return;
  installPointerDebugListeners();

  const record: TileDebugRecord = {
    index: records.length + 1,
    time: new Date().toISOString(),
    ms: getRuntimeMs(),
    event,
    data: sanitize(data),
    pointer: getPointerDebugSnapshot(),
  };
  records.push(record);
  if (records.length > BUFFER_LIMIT) records.shift();
  queuePersistentRecord(record);

  if (isTileDebugConsoleEnabled()) {
    console.info(`[FASP tiles #${record.index} +${record.ms}ms] ${event}`, {
      data: record.data ?? null,
      pointer: record.pointer,
    });
  }
}

function traceItemId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return shortId(value) || value;
  if (!isObject(value)) return null;
  const id = typeof value.fullId === 'string'
    ? value.fullId
    : typeof value.id === 'string'
      ? value.id
      : null;
  return shortId(id || undefined) || id;
}

function traceStepLabel(state: string, source?: unknown, target?: unknown): string {
  const sourceId = traceItemId(source);
  const targetId = traceItemId(target);
  if (sourceId && targetId) return `${state}(${sourceId} -> ${targetId})`;
  if (sourceId) return `${state}(${sourceId})`;
  if (targetId) return `${state}(${targetId})`;
  return state;
}

export function getDragTelemetrySnapshot(): unknown {
  return {
    state: dragTelemetryState,
    context: dragTelemetryContext,
    trace: [...traceRecords],
  };
}

export function resetDragTelemetry(nextState = 'IDLE'): void {
  dragTelemetryState = nextState;
  dragTelemetryContext = null;
}

export function logDragStateChange({
  to,
  from,
  source,
  target,
  reason,
  context,
}: {
  to: string;
  from?: string;
  source?: unknown;
  target?: unknown;
  reason?: string;
  context?: unknown;
}): void {
  const previousState = from || dragTelemetryState;
  dragTelemetryState = to;
  dragTelemetryContext = sanitize({
    source,
    target,
    reason,
    context,
  });

  if (!isTileDebugEnabled()) return;

  const traceRecord: TileDebugTraceRecord = {
    index: traceRecords.length + 1,
    time: new Date().toISOString(),
    ms: getRuntimeMs(),
    from: previousState,
    to,
    source: sanitize(source),
    target: sanitize(target),
    reason,
    summary: traceStepLabel(to, source, target),
    context: sanitize(context),
  };
  traceRecords.push(traceRecord);
  if (traceRecords.length > TRACE_BUFFER_LIMIT) traceRecords.shift();

  logTileDebug('telemetry:state-change', {
    from: previousState,
    to,
    source,
    target,
    reason,
    context,
  });
}

export function logDragDecision(event: string, data?: unknown): void {
  logTileDebug(`telemetry:${event}`, data);
}

export function logDragContext(data?: unknown): void {
  dragTelemetryContext = sanitize(data);
  logTileDebug('telemetry:drag-context', data);
}

function formatTraceText(): string {
  if (traceRecords.length === 0) return dragTelemetryState;
  const lines: string[] = [traceRecords[0].from];
  for (const record of traceRecords) {
    const reason = record.reason ? ` (${record.reason})` : '';
    lines.push(' ↓' + reason);
    lines.push(record.summary);
  }
  return lines.join('\n');
}

export function setTileDebugSnapshotProvider(provider: () => unknown): void {
  snapshotProvider = provider;
  installTileDebugApi();
}

function installTileDebugApi(): void {
  if (typeof window === 'undefined') return;
  if (isTileDebugEnabled() || isTileDebugOverlayEnabled()) {
    installPointerDebugListeners();
  }
  if (!lifecycleFlushListenersInstalled) {
    lifecycleFlushListenersInstalled = true;
    window.addEventListener('pagehide', () => {
      void flushPersistentLog();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flushPersistentLog();
    });
  }

  window.faspDebug = {
    enable() {
      setStoredEnabled(true);
      console.info('[FASP tiles] debug enabled. Events are persisted to IndexedDB log. Use faspDebug.saveLogFile() to download JSONL.');
      return true;
    },
    disable() {
      setStoredEnabled(false);
      void flushPersistentLog();
      console.info('[FASP tiles] debug disabled.');
      return false;
    },
    async clear() {
      records.length = 0;
      traceRecords.length = 0;
      resetDragTelemetry();
      await clearPersistentLog();
      console.info('[FASP tiles] debug buffers and persistent log cleared.');
    },
    async clearLogFile() {
      await clearPersistentLog();
      records.length = 0;
      traceRecords.length = 0;
      resetDragTelemetry();
      console.info('[FASP tiles] persistent debug log cleared.');
    },
    dump() {
      const copy = [...records];
      console.info('[FASP tiles] debug dump', copy);
      return copy;
    },
    dumpText() {
      const text = JSON.stringify(records, null, 2);
      console.info(text);
      return text;
    },
    async readLogFile() {
      const text = await readPersistentLogText();
      console.info(`[FASP tiles] persistent log loaded: ${text.length} chars`);
      return text;
    },
    async saveLogFile() {
      const filename = await savePersistentLogFile();
      console.info(`[FASP tiles] persistent log saved as ${filename}`);
      return filename;
    },
    async flushLogFile() {
      const count = await flushPersistentLog();
      console.info(`[FASP tiles] persistent log flushed: ${count} records`);
      return count;
    },
    trace() {
      const copy = [...traceRecords];
      console.info('[FASP tiles] drag trace', copy);
      return copy;
    },
    traceText() {
      const text = formatTraceText();
      console.info(text);
      return text;
    },
    telemetry() {
      const telemetry = {
        records: [...records],
        trace: [...traceRecords],
        traceText: formatTraceText(),
        drag: getDragTelemetrySnapshot(),
        geometry: getTileDebugGeometrySnapshot(),
        pointer: getPointerDebugSnapshot(),
        state: snapshotProvider ? sanitize(snapshotProvider()) : null,
      };
      console.info('[FASP tiles] telemetry', telemetry);
      return telemetry;
    },
    geometry() {
      const geometry = getTileDebugGeometrySnapshot();
      console.info('[FASP tiles] geometry', geometry);
      return geometry;
    },
    objects() {
      const geometry = getTileDebugGeometrySnapshot() as { tiles?: unknown[] } | null;
      const objects = geometry?.tiles || [];
      console.info('[FASP tiles] objects', objects);
      return objects;
    },
    overlay(nextEnabled?: boolean) {
      const next = typeof nextEnabled === 'boolean' ? nextEnabled : !isTileDebugOverlayEnabled();
      const result = setTileDebugOverlayEnabled(next);
      console.info(`[FASP tiles] debug overlay ${result ? 'enabled' : 'disabled'}.`);
      return result;
    },
    pointer() {
      const pointer = getPointerDebugSnapshot();
      console.info('[FASP tiles] pointer', pointer);
      return pointer;
    },
    snapshot() {
      const snapshot = {
        state: snapshotProvider ? sanitize(snapshotProvider()) : null,
        geometry: getTileDebugGeometrySnapshot(),
        pointer: getPointerDebugSnapshot(),
        drag: getDragTelemetrySnapshot(),
      };
      console.info('[FASP tiles] snapshot', snapshot);
      return snapshot;
    },
    state() {
      const state = snapshotProvider ? sanitize(snapshotProvider()) : null;
      console.info('[FASP tiles] current tile state', state);
      return state;
    },
    mark(event: string, data?: unknown) {
      logTileDebug(`mark:${event}`, data);
    },
    console(nextEnabled?: boolean) {
      const next = typeof nextEnabled === 'boolean' ? nextEnabled : !isTileDebugConsoleEnabled();
      const result = setStoredConsoleEnabled(next);
      console.info(`[FASP tiles] console event logging ${result ? 'enabled' : 'disabled'}.`);
      return result;
    },
    isEnabled: isTileDebugEnabled,
    isOverlayEnabled: isTileDebugOverlayEnabled,
    isConsoleEnabled: isTileDebugConsoleEnabled,
  };
}

installTileDebugApi();
