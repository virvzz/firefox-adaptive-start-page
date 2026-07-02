const STORAGE_KEY = 'fasp.debug.startup';
const CONSOLE_STORAGE_KEY = 'fasp.debug.startup.console';
const DURATION_STORAGE_KEY = 'fasp.debug.startup.duration';
const DEFAULT_TRACE_DURATION_MS = 3600;
const RECORD_LIMIT = 1200;

export interface StartupDebugRecord {
  index: number;
  ms: number;
  time: string;
  event: string;
  data?: unknown;
}

interface StartupVisualSnapshot {
  visualReady: string | null;
  theme: string | null;
  themeBackground: string | null;
  glass: string | null;
  bodyBackground: string | null;
  bootScreen: boolean;
  rootChildren: number;
  backgroundKind: string | null;
  backgroundTag: string | null;
  backgroundImage: string | null;
  backgroundColor: string | null;
  backgroundFilter: string | null;
  backgroundOpacity: string | null;
  backgroundTransform: string | null;
  canvas: {
    width: number;
    height: number;
    cssWidth: number;
    cssHeight: number;
    centerPixel: string | null;
  } | null;
}

interface StartupDebugApi {
  enable: (options?: { console?: boolean; durationMs?: number }) => boolean;
  disable: () => boolean;
  console: (nextEnabled?: boolean) => boolean;
  clear: () => void;
  dump: () => StartupDebugRecord[];
  table: () => StartupDebugRecord[];
  summary: () => unknown;
  mark: (event: string, data?: unknown) => void;
  snapshot: () => StartupVisualSnapshot;
  saveLogFile: () => string;
  isEnabled: () => boolean;
  isConsoleEnabled: () => boolean;
}

declare global {
  interface Window {
    faspStartupDebug?: StartupDebugApi;
  }
}

const records: StartupDebugRecord[] = [];
let tracingStarted = false;
let frameHandle = 0;
let mutationObserver: MutationObserver | null = null;
let paintObserver: PerformanceObserver | null = null;
let traceStartedAt = 0;
let lastVisualSignature = '';

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? round(performance.now()) : Date.now();
}

function getTraceDurationMs(): number {
  try {
    const stored = Number(localStorage.getItem(DURATION_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= 500 && stored <= 15000
      ? stored
      : DEFAULT_TRACE_DURATION_MS;
  } catch {
    return DEFAULT_TRACE_DURATION_MS;
  }
}

function urlWantsStartupDebug(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('fasp-startup-debug') === '1' || params.get('startupDebug') === '1';
  } catch {
    return false;
  }
}

export function isStartupDebugEnabled(): boolean {
  try {
    return urlWantsStartupDebug() || localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function isStartupDebugConsoleEnabled(): boolean {
  try {
    return localStorage.getItem(CONSOLE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function setStoredEnabled(nextEnabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, nextEnabled ? '1' : '0');
  } catch {
    // Runtime-only if storage is blocked.
  }
}

function setStoredConsoleEnabled(nextEnabled: boolean): boolean {
  try {
    localStorage.setItem(CONSOLE_STORAGE_KEY, nextEnabled ? '1' : '0');
  } catch {
    // Runtime-only if storage is blocked.
  }
  return nextEnabled;
}

function setStoredDuration(durationMs: number): void {
  try {
    localStorage.setItem(DURATION_STORAGE_KEY, String(Math.max(500, Math.min(15000, Math.round(durationMs)))));
  } catch {
    // Keep default duration.
  }
}

function shortenText(value: string): string {
  const withoutDataPayload = value.replace(/data:image\/[a-z0-9.+-]+;base64,[^)'",\s]+/gi, 'data:image/...;base64,[truncated]');
  if (withoutDataPayload.length <= 260) return withoutDataPayload;
  return `${withoutDataPayload.slice(0, 240)}...`;
}

function sanitize(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (depth > 8) return '[depth-limit]';
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'string') return shortenText(value);
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, seen, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, sanitize(entry, seen, depth + 1)])
  );
}

export function logStartupDebug(event: string, data?: unknown): void {
  if (!isStartupDebugEnabled()) return;

  const record: StartupDebugRecord = {
    index: records.length + 1,
    ms: nowMs(),
    time: new Date().toISOString(),
    event,
    data: sanitize(data),
  };
  records.push(record);
  if (records.length > RECORD_LIMIT) records.shift();

  if (isStartupDebugConsoleEnabled()) {
    console.info(`[FASP startup #${record.index} +${record.ms}ms] ${event}`, record.data ?? null);
  }
}

function getComputedBackground(style: CSSStyleDeclaration | null): string | null {
  if (!style) return null;
  if (style.backgroundImage && style.backgroundImage !== 'none') return shortenText(style.backgroundImage);
  if (style.backgroundColor) return style.backgroundColor;
  return null;
}

function readCanvasPixel(canvas: HTMLCanvasElement): string | null {
  if (!canvas.width || !canvas.height) return null;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(canvas.width / 2)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(canvas.height / 2)));
    const [r, g, b, a] = Array.from(ctx.getImageData(x, y, 1, 1).data);
    return `rgba(${r}, ${g}, ${b}, ${round(a / 255)})`;
  } catch {
    return null;
  }
}

export function getStartupVisualSnapshot(): StartupVisualSnapshot {
  const root = document.documentElement;
  const body = document.body;
  const bodyStyle = body ? getComputedStyle(body) : null;
  const layer = document.querySelector<HTMLElement>('[data-testid="background-layer"]');
  const layerStyle = layer ? getComputedStyle(layer) : null;
  const canvas = layer instanceof HTMLCanvasElement
    ? layer
    : document.querySelector<HTMLCanvasElement>('canvas[data-testid="background-layer"]');
  const canvasRect = canvas?.getBoundingClientRect();

  return {
    visualReady: root?.dataset.faspVisualReady || null,
    theme: root?.dataset.faspTheme || null,
    themeBackground: root?.dataset.faspThemeBackground || null,
    glass: root?.dataset.faspGlass || null,
    bodyBackground: getComputedBackground(bodyStyle),
    bootScreen: Boolean(document.querySelector('.app-boot-screen')),
    rootChildren: document.getElementById('root')?.childElementCount || 0,
    backgroundKind: layer?.dataset.backgroundKind || null,
    backgroundTag: layer?.tagName.toLowerCase() || null,
    backgroundImage: layerStyle?.backgroundImage && layerStyle.backgroundImage !== 'none'
      ? shortenText(layerStyle.backgroundImage)
      : null,
    backgroundColor: layerStyle?.backgroundColor || null,
    backgroundFilter: layerStyle?.filter || null,
    backgroundOpacity: layerStyle?.opacity || null,
    backgroundTransform: layerStyle?.transform || null,
    canvas: canvas
      ? {
          width: canvas.width,
          height: canvas.height,
          cssWidth: round(canvasRect?.width || 0),
          cssHeight: round(canvasRect?.height || 0),
          centerPixel: readCanvasPixel(canvas),
        }
      : null,
  };
}

function visualSignature(snapshot: StartupVisualSnapshot): string {
  return JSON.stringify({
    visualReady: snapshot.visualReady,
    theme: snapshot.theme,
    themeBackground: snapshot.themeBackground,
    glass: snapshot.glass,
    bodyBackground: snapshot.bodyBackground,
    bootScreen: snapshot.bootScreen,
    rootChildren: snapshot.rootChildren,
    backgroundKind: snapshot.backgroundKind,
    backgroundTag: snapshot.backgroundTag,
    backgroundImage: snapshot.backgroundImage,
    backgroundColor: snapshot.backgroundColor,
    backgroundFilter: snapshot.backgroundFilter,
    backgroundOpacity: snapshot.backgroundOpacity,
    backgroundTransform: snapshot.backgroundTransform,
    canvas: snapshot.canvas,
  });
}

function recordVisualChange(source: string): void {
  if (!isStartupDebugEnabled()) return;
  const snapshot = getStartupVisualSnapshot();
  const signature = visualSignature(snapshot);
  if (signature === lastVisualSignature) return;
  lastVisualSignature = signature;
  logStartupDebug('visual:change', { source, ...snapshot });
}

function installPaintObserver(): void {
  if (paintObserver || typeof PerformanceObserver === 'undefined') return;
  try {
    paintObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        logStartupDebug('performance:paint', {
          name: entry.name,
          startTime: round(entry.startTime),
          duration: round(entry.duration),
        });
      }
    });
    paintObserver.observe({ type: 'paint', buffered: true });
  } catch {
    paintObserver = null;
  }
}

function installMutationObserver(): void {
  if (mutationObserver || !document.documentElement) return;
  mutationObserver = new MutationObserver(() => recordVisualChange('mutation'));
  mutationObserver.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ['class', 'style', 'data-fasp-theme', 'data-fasp-theme-background', 'data-fasp-glass', 'data-fasp-visual-ready'],
  });
}

function startFrameSampling(): void {
  if (frameHandle) return;
  const durationMs = getTraceDurationMs();

  const tick = () => {
    recordVisualChange('raf');
    if (performance.now() - traceStartedAt <= durationMs) {
      frameHandle = window.requestAnimationFrame(tick);
      return;
    }

    frameHandle = 0;
    logStartupDebug('trace:complete', createStartupSummary());
    if (isStartupDebugConsoleEnabled()) {
      console.info('[FASP startup] summary', createStartupSummary());
    }
  };

  frameHandle = window.requestAnimationFrame(tick);
}

function startTrace(): void {
  if (tracingStarted || !isStartupDebugEnabled()) return;
  tracingStarted = true;
  traceStartedAt = performance.now();
  lastVisualSignature = '';

  logStartupDebug('trace:start', {
    url: window.location.href,
    durationMs: getTraceDurationMs(),
    readyState: document.readyState,
    navigation: performance.getEntriesByType('navigation').map((entry) => ({
      name: entry.name,
      startTime: round(entry.startTime),
      duration: round(entry.duration),
    })),
  });
  installPaintObserver();
  installMutationObserver();
  recordVisualChange('install');
  startFrameSampling();
}

function stopTrace(): void {
  if (frameHandle) window.cancelAnimationFrame(frameHandle);
  frameHandle = 0;
  mutationObserver?.disconnect();
  mutationObserver = null;
  paintObserver?.disconnect();
  paintObserver = null;
  tracingStarted = false;
}

function createStartupSummary(): unknown {
  const visualRecords = records.filter((record) => record.event === 'visual:change');
  const backgroundKinds = [...new Set(visualRecords.map((record) => {
    const data = record.data as Record<string, unknown> | undefined;
    return data?.backgroundKind || null;
  }))];
  const themeBackgrounds = [...new Set(visualRecords.map((record) => {
    const data = record.data as Record<string, unknown> | undefined;
    return data?.themeBackground || null;
  }))];
  const firstReady = visualRecords.find((record) => {
    const data = record.data as Record<string, unknown> | undefined;
    return data?.visualReady === 'true';
  });
  const visualChanges = visualRecords.map((record) => {
    const data = record.data as Record<string, unknown> | undefined;
    return {
      ms: record.ms,
      source: data?.source,
      visualReady: data?.visualReady,
      theme: data?.theme,
      themeBackground: data?.themeBackground,
      backgroundKind: data?.backgroundKind,
      bodyBackground: data?.bodyBackground,
      canvas: data?.canvas,
    };
  });

  return {
    recordCount: records.length,
    visualChangeCount: visualRecords.length,
    firstVisualReadyMs: firstReady?.ms ?? null,
    backgroundKinds,
    themeBackgrounds,
    visualChanges,
    events: records.map((record) => ({ ms: record.ms, event: record.event })),
  };
}

function saveStartupLogFile(): string {
  const filename = `fasp-startup-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  console.info(`[FASP startup] saved ${filename}`);
  return filename;
}

function installApi(): void {
  if (typeof window === 'undefined') return;
  window.faspStartupDebug = {
    enable(options) {
      setStoredEnabled(true);
      if (options?.console !== undefined) setStoredConsoleEnabled(options.console);
      if (options?.durationMs) setStoredDuration(options.durationMs);
      console.info('[FASP startup] debug enabled. Reload the page to capture earliest startup frames.');
      startTrace();
      return true;
    },
    disable() {
      setStoredEnabled(false);
      stopTrace();
      console.info('[FASP startup] debug disabled.');
      return false;
    },
    console(nextEnabled) {
      const next = typeof nextEnabled === 'boolean' ? nextEnabled : !isStartupDebugConsoleEnabled();
      const result = setStoredConsoleEnabled(next);
      console.info(`[FASP startup] console logging ${result ? 'enabled' : 'disabled'}.`);
      return result;
    },
    clear() {
      records.length = 0;
      lastVisualSignature = '';
      console.info('[FASP startup] records cleared.');
    },
    dump() {
      const copy = [...records];
      console.info('[FASP startup] records', copy);
      return copy;
    },
    table() {
      const copy = [...records];
      console.table(copy.map((record) => ({
        index: record.index,
        ms: record.ms,
        event: record.event,
        backgroundKind: (record.data as Record<string, unknown> | undefined)?.backgroundKind,
        themeBackground: (record.data as Record<string, unknown> | undefined)?.themeBackground,
        visualReady: (record.data as Record<string, unknown> | undefined)?.visualReady,
      })));
      return copy;
    },
    summary() {
      const summary = createStartupSummary();
      console.info('[FASP startup] summary', summary);
      return summary;
    },
    mark(event, data) {
      logStartupDebug(`mark:${event}`, data);
    },
    snapshot() {
      const snapshot = getStartupVisualSnapshot();
      console.info('[FASP startup] snapshot', snapshot);
      return snapshot;
    },
    saveLogFile: saveStartupLogFile,
    isEnabled: isStartupDebugEnabled,
    isConsoleEnabled: isStartupDebugConsoleEnabled,
  };
}

export function installStartupDebug(): void {
  installApi();
  if (urlWantsStartupDebug()) setStoredEnabled(true);
  if (isStartupDebugEnabled()) startTrace();
}

