import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BackgroundLayer, preloadThemeStaticBackground } from './components/Background/BackgroundLayer';
import { TileGrid } from './components/LayoutEngine/TileGrid';
import { useBackgroundStore } from './stores/backgroundStore';
import { useLayoutStore } from './stores/layoutStore';
import { useSettingsStore } from './stores/settingsStore';
import { useThemeStore } from './stores/themeStore';
import { useTileStore } from './stores/tilesStore';
import { logStartupDebug } from '../debug/startupDebug';

const SettingsPanel = lazy(() => import('./components/Settings/SettingsPanel').then((module) => ({
  default: module.SettingsPanel,
})));

function ClockWidget() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="clock-widget flex items-baseline gap-4 select-none">
      <span className="text-lg font-light tracking-wider text-white/90">
        {now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
      </span>
      <span className="text-base font-light text-white/50">
        {now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })}
      </span>
    </div>
  );
}

interface SearchBookmarkNode {
  title?: string;
  url?: string;
  children?: SearchBookmarkNode[];
}

interface SearchTab {
  id?: number;
  windowId?: number;
  title?: string;
  url?: string;
}

interface SearchBrowserApi {
  bookmarks?: {
    getTree: () => Promise<SearchBookmarkNode[]>;
  };
  runtime?: {
    sendMessage?: (message: unknown) => Promise<unknown>;
  };
  tabs?: {
    query: (details: Record<string, never>) => Promise<SearchTab[]>;
    update: (tabId: number, details: { active?: boolean }) => Promise<unknown>;
  };
  windows?: {
    update: (windowId: number, details: { focused?: boolean }) => Promise<unknown>;
  };
}

interface SearchItem {
  id: string;
  type: 'tab' | 'bookmark';
  title: string;
  url: string;
  haystack: string;
  tabId?: number;
  windowId?: number;
}

type QuickAccessMode = 'popular' | 'recent';

interface QuickAccessItem {
  id: string;
  title: string;
  url: string;
  source: QuickAccessMode;
  sessionId?: string;
}

interface QuickAccessBrowserApi {
  topSites?: {
    get: (options?: { includeFavicon?: boolean; limit?: number }) => Promise<Array<{ title?: string; url: string }>>;
  };
  sessions?: {
    getRecentlyClosed: (options?: { maxResults?: number }) => Promise<Array<{ tab?: { title?: string; url?: string; sessionId?: string } }>>;
    restore?: (sessionId?: string) => Promise<unknown>;
  };
  tabs?: {
    create: (details: { url?: string; active?: boolean }) => Promise<unknown>;
  };
}

interface BrowserMemoryPerformance extends Performance {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
  measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
}

interface PerformanceSnapshot {
  fps: number;
  frameMs: number;
  loadPercent: number;
  memoryLabel: string;
  memoryDetail: string;
  longTaskMs: number;
  memorySupported: boolean;
}

const WEATHER_CACHE_VERSION = 2;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'н/д';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function PerformanceMonitor() {
  const [snapshot, setSnapshot] = useState<PerformanceSnapshot>({
    fps: 0,
    frameMs: 0,
    loadPercent: 0,
    memoryLabel: 'н/д',
    memoryDetail: 'Firefox не отдаёт JS heap для страниц расширений',
    longTaskMs: 0,
    memorySupported: false,
  });
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const sampleStartedRef = useRef<number>(0);
  const frameCountRef = useRef(0);
  const frameTotalRef = useRef(0);
  const longTaskTotalRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let observer: PerformanceObserver | null = null;
    const perf = performance as BrowserMemoryPerformance;

    if (typeof PerformanceObserver !== 'undefined') {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTaskTotalRef.current += entry.duration;
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch {
        observer = null;
      }
    }

    const readMemory = async (): Promise<Pick<PerformanceSnapshot, 'memoryLabel' | 'memoryDetail' | 'memorySupported'>> => {
      if (perf.memory) {
        const used = formatBytes(perf.memory.usedJSHeapSize);
        const total = formatBytes(perf.memory.totalJSHeapSize);
        return {
          memoryLabel: used,
          memoryDetail: `JS heap: ${used} / ${total}`,
          memorySupported: true,
        };
      }

      if (perf.measureUserAgentSpecificMemory) {
        try {
          const result = await perf.measureUserAgentSpecificMemory();
          return {
            memoryLabel: formatBytes(result.bytes),
            memoryDetail: 'Оценка памяти user agent',
            memorySupported: true,
          };
        } catch {
          // Fall through to unsupported state.
        }
      }

      return {
        memoryLabel: 'н/д',
        memoryDetail: 'Firefox не отдаёт точную память страницы расширения',
        memorySupported: false,
      };
    };

    const tick = (time: number) => {
      if (cancelled) return;

      if (!sampleStartedRef.current) sampleStartedRef.current = time;
      if (lastFrameRef.current) {
        const delta = time - lastFrameRef.current;
        frameCountRef.current += 1;
        frameTotalRef.current += delta;
      }
      lastFrameRef.current = time;

      const sampleDuration = time - sampleStartedRef.current;
      if (sampleDuration >= 1000) {
        const frameCount = Math.max(1, frameCountRef.current);
        const frameMs = frameTotalRef.current / frameCount;
        const fps = frameCount / (sampleDuration / 1000);
        const targetFrameMs = 1000 / 60;
        const longTaskMs = longTaskTotalRef.current;
        const loadPercent = Math.max(
          0,
          Math.min(100, Math.round(((frameMs - targetFrameMs) / targetFrameMs) * 100 + Math.min(60, longTaskMs / 4)))
        );

        void readMemory().then((memory) => {
          if (cancelled) return;
          setSnapshot({
            fps: Math.round(fps),
            frameMs: Math.round(frameMs * 10) / 10,
            loadPercent,
            longTaskMs: Math.round(longTaskMs),
            ...memory,
          });
        });

        sampleStartedRef.current = time;
        frameCountRef.current = 0;
        frameTotalRef.current = 0;
        longTaskTotalRef.current = 0;
      }

      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      observer?.disconnect();
    };
  }, []);

  const status = snapshot.fps >= 55 && snapshot.loadPercent < 25
    ? 'спокойно'
    : snapshot.fps >= 45 && snapshot.loadPercent < 55
      ? 'средне'
      : 'тяжело';

  return (
    <aside className="performance-monitor glass-strong info-card" aria-label="Монитор производительности">
      <div className="performance-monitor-header">
        <span>Performance</span>
        <strong>{status}</strong>
      </div>
      <div className="performance-monitor-grid">
        <span>FPS</span>
        <strong>{snapshot.fps}</strong>
        <span>Кадр</span>
        <strong>{snapshot.frameMs} мс</strong>
        <span>CPU*</span>
        <strong>{snapshot.loadPercent}%</strong>
        <span>Память</span>
        <strong title={snapshot.memoryDetail}>{snapshot.memoryLabel}</strong>
      </div>
      <p>
        * оценка нагрузки main thread; точный CPU браузерным расширениям не отдаётся.
        {!snapshot.memorySupported && ' Память тоже может быть недоступна в Firefox.'}
      </p>
    </aside>
  );
}

function getSearchBrowserApi(): SearchBrowserApi | null {
  if (typeof browser === 'undefined') return null;
  return browser as unknown as SearchBrowserApi;
}

function getQuickAccessBrowserApi(): QuickAccessBrowserApi | null {
  if (typeof browser === 'undefined') return null;
  return browser as unknown as QuickAccessBrowserApi;
}

function QuickAccessButtons({
  showPopular,
  showRecent,
}: {
  showPopular: boolean;
  showRecent: boolean;
}) {
  const [activeMode, setActiveMode] = useState<QuickAccessMode | null>(null);
  const [items, setItems] = useState<QuickAccessItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const loadItems = useCallback(async (mode: QuickAccessMode) => {
    const api = getQuickAccessBrowserApi();
    setLoading(true);
    setError(null);
    try {
      if (mode === 'popular') {
        const sites = await api?.topSites?.get({ includeFavicon: false, limit: 10 }) ?? [];
        setItems(
          sites
            .filter((site) => site.url && !site.url.startsWith('moz-extension://'))
            .map((site, index) => ({
              id: `popular:${index}:${site.url}`,
              title: site.title || site.url,
              url: site.url,
              source: 'popular' as const,
            }))
        );
      } else {
        const sessions = await api?.sessions?.getRecentlyClosed({ maxResults: 10 }) ?? [];
        const recentItems: QuickAccessItem[] = [];
        sessions.forEach((entry, index) => {
          const tab = entry.tab;
          if (!tab?.url) return;
          recentItems.push({
            id: `recent:${tab.sessionId || index}:${tab.url}`,
            title: tab.title || tab.url,
            url: tab.url,
            source: 'recent',
            sessionId: tab.sessionId,
          });
        });
        setItems(recentItems);
      }
    } catch {
      setItems([]);
      setError(mode === 'popular'
        ? 'Firefox не отдал популярные вкладки.'
        : 'Firefox не отдал недавно закрытые вкладки.');
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleMode = useCallback((mode: QuickAccessMode) => {
    setActiveMode((currentMode) => {
      if (currentMode === mode) {
        setItems([]);
        return null;
      }
      void loadItems(mode);
      return mode;
    });
  }, [loadItems]);

  const openItem = useCallback(async (item: QuickAccessItem) => {
    const api = getQuickAccessBrowserApi();
    if (item.source === 'recent' && item.sessionId && api?.sessions?.restore) {
      try {
        await api.sessions.restore(item.sessionId);
        setActiveMode(null);
        return;
      } catch {
        // Fall through to opening by URL.
      }
    }

    if (api?.tabs?.create) {
      await api.tabs.create({ url: item.url, active: true });
    } else {
      window.location.href = item.url;
    }
    setActiveMode(null);
  }, []);

  useEffect(() => {
    if (!activeMode) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setActiveMode(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveMode(null);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeMode]);

  if (!showPopular && !showRecent) return null;

  return (
    <div ref={rootRef} className="quick-access-bar" aria-label="Быстрые вкладки">
      {showPopular && (
        <button
          type="button"
          className={`quick-access-trigger glass ${activeMode === 'popular' ? 'quick-access-trigger-active' : ''}`}
          onClick={() => toggleMode('popular')}
        >
          Популярные вкладки
        </button>
      )}
      {showRecent && (
        <button
          type="button"
          className={`quick-access-trigger glass ${activeMode === 'recent' ? 'quick-access-trigger-active' : ''}`}
          onClick={() => toggleMode('recent')}
        >
          Недавно закрытые
        </button>
      )}

      {activeMode && (
        <div className="quick-access-panel glass-strong" role="dialog" aria-label={activeMode === 'popular' ? 'Популярные вкладки' : 'Недавно закрытые вкладки'}>
          <div className="quick-access-panel-header">
            <strong>{activeMode === 'popular' ? 'Популярные вкладки' : 'Недавно закрытые'}</strong>
            <button type="button" onClick={() => setActiveMode(null)} aria-label="Закрыть">×</button>
          </div>
          <div className="quick-access-list">
            {loading && <p className="quick-access-empty">Загружаю...</p>}
            {!loading && error && <p className="quick-access-empty">{error}</p>}
            {!loading && !error && items.length === 0 && (
              <p className="quick-access-empty">Список пока пуст.</p>
            )}
            {!loading && !error && items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="quick-access-item"
                onClick={() => void openItem(item)}
              >
                <span>{item.title}</span>
                <small>{item.url}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function flattenBookmarkSearchItems(nodes: SearchBookmarkNode[]): SearchItem[] {
  const items: SearchItem[] = [];
  const stack = [...nodes].reverse();

  while (stack.length > 0 && items.length < 20000) {
    const node = stack.pop();
    if (!node) continue;

    if (node.url) {
      const title = node.title || node.url;
      items.push({
        id: `bookmark:${items.length}:${node.url}`,
        type: 'bookmark',
        title,
        url: node.url,
        haystack: `${title} ${node.url}`.toLocaleLowerCase('ru-RU'),
      });
    }

    if (node.children?.length) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index]);
      }
    }
  }

  return items;
}

function SearchBar({
  resultLimit = 50,
  widthPercent = 60,
}: {
  resultLimit?: number;
  widthPercent?: number;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<SearchItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredQuery = useDeferredValue(q);

  const refreshSearchItems = useCallback(async () => {
    const api = getSearchBrowserApi();
    if (!api) return;

    setLoading(true);
    try {
      const [bookmarkTree, tabs] = await Promise.all([
        api.bookmarks?.getTree
          ? api.bookmarks.getTree().catch(() => [] as SearchBookmarkNode[])
          : api.runtime?.sendMessage
            ? api.runtime.sendMessage({ type: 'get-bookmarks' })
                .then((result) => Array.isArray(result) ? result as SearchBookmarkNode[] : [])
                .catch(() => [] as SearchBookmarkNode[])
            : Promise.resolve([] as SearchBookmarkNode[]),
        api.tabs?.query
          ? api.tabs.query({}).catch(() => [] as SearchTab[])
          : Promise.resolve([] as SearchTab[]),
      ]);

      const tabItems = tabs
        .filter((tab) => tab.url && tab.title && !tab.url.startsWith('moz-extension://'))
        .map((tab, index) => ({
          id: `tab:${tab.id ?? index}:${tab.url}`,
          type: 'tab' as const,
          title: tab.title || tab.url || 'Вкладка',
          url: tab.url || '',
          haystack: `${tab.title || ''} ${tab.url || ''}`.toLocaleLowerCase('ru-RU'),
          tabId: tab.id,
          windowId: tab.windowId,
        }));

      setItems([...tabItems, ...flattenBookmarkSearchItems(bookmarkTree)]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshSearchItems();
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [refreshSearchItems]);

  const results = useMemo(() => {
    const clean = deferredQuery.trim().toLocaleLowerCase('ru-RU');
    if (!clean) return [];

    const tokens = clean.split(/\s+/).filter(Boolean);
    const limit = Math.max(5, Math.min(100, Math.round(resultLimit)));
    const matches: SearchItem[] = [];
    for (const item of items) {
      if (tokens.every((token) => item.haystack.includes(token))) {
        matches.push(item);
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }, [deferredQuery, items, resultLimit]);

  useEffect(() => {
    setActiveIndex(0);
  }, [deferredQuery]);

  const activateItem = useCallback(async (item: SearchItem) => {
    setOpen(false);
    setQ('');

    if (item.type === 'tab' && typeof item.tabId === 'number') {
      const api = getSearchBrowserApi();
      try {
        if (typeof item.windowId === 'number') {
          await api?.windows?.update(item.windowId, { focused: true });
        }
        await api?.tabs?.update(item.tabId, { active: true });
        return;
      } catch {
        // Fall through to opening the URL in the current tab.
      }
    }

    window.location.href = item.url;
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!results[activeIndex]) return;
    void activateItem(results[activeIndex]);
  };

  return (
    <form
      className="search-form relative"
      onSubmit={handleSubmit}
      style={{ width: `${widthPercent}vw`, maxWidth: '800px' }}
    >
      <input
        type="text"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          void refreshSearchItems();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder="Поиск по закладкам и открытым вкладкам..."
        className="search-input w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-5 pr-11 text-sm text-white outline-none backdrop-blur-xl transition-all duration-500 placeholder-white/28 focus:border-white/30 focus:bg-white/[0.08]"
      />
      {q && (
        <button
          type="button"
          aria-label="Очистить поиск"
          onClick={() => {
            setQ('');
            setOpen(false);
          }}
          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-white/35 transition-colors hover:bg-white/10 hover:text-white/75"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      )}
      {open && q.trim() && (
        <div className="absolute left-1/2 top-[calc(100%+8px)] z-50 max-h-[60vh] w-[min(980px,92vw)] -translate-x-1/2 overflow-y-auto rounded-2xl border border-white/10 bg-[#111320]/95 p-1 shadow-2xl shadow-black/40 backdrop-blur-2xl">
          {loading && items.length === 0 && (
            <div className="px-4 py-3 text-sm text-white/45">Ищу закладки и вкладки...</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-4 py-3 text-sm text-white/45">Ничего не найдено</div>
          )}
          {results.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void activateItem(item)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                index === activeIndex ? 'bg-white/[0.12]' : 'hover:bg-white/[0.08]'
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-sm">
                {item.type === 'tab' ? '▣' : '★'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white/82">{item.title}</span>
                <span className="mt-0.5 block truncate text-xs text-white/36">{item.url}</span>
              </span>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[10px] uppercase tracking-wide text-white/42">
                {item.type === 'tab' ? 'вкладка' : 'закладка'}
              </span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

function cleanWeatherText(value: string): string | null {
  const clean = value.replace(/\+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > 80) return null;
  if (/<\/?[a-z][\s\S]*>/i.test(clean)) return null;
  if (/doctype|html|body|script|error/i.test(clean)) return null;
  return clean;
}

type WeatherState =
  | { status: 'loading' }
  | {
      status: 'ready';
      text: string;
      url: string;
      location: string;
      temp: string;
      condition: string;
      icon: WeatherIconKind;
    }
  | { status: 'error' };

type WeatherDisplayMode = 'inline' | 'card';
type WeatherIconKind = 'sun' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog';

interface WttrTextValue {
  value?: string;
}

interface WttrResponse {
  current_condition?: Array<{
    temp_C?: string;
    weatherCode?: string;
    weatherDesc?: WttrTextValue[];
    lang_ru?: WttrTextValue[];
  }>;
  nearest_area?: Array<{
    areaName?: WttrTextValue[];
    region?: WttrTextValue[];
    country?: WttrTextValue[];
  }>;
}

function normalizeWeatherLocation(value: string | undefined): string {
  return cleanWeatherText(String(value || ''))?.slice(0, 48) || '';
}

function encodeWeatherPath(location: string): string {
  return location ? `/${encodeURIComponent(location)}` : '';
}

function buildWeatherUrl(location: string): string {
  return `https://wttr.in${encodeWeatherPath(location)}?lang=ru`;
}

function buildWeatherApiUrl(location: string): string {
  return `https://wttr.in${encodeWeatherPath(location)}?format=j1&lang=ru`;
}

function formatTemperature(value: string | undefined): string {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return '';
  return `${parsed > 0 ? '+' : ''}${parsed}°`;
}

function classifyWeatherIcon(condition: string | undefined, code: string | undefined): WeatherIconKind {
  const normalized = String(condition || '').toLocaleLowerCase('ru-RU');
  const numericCode = Number.parseInt(String(code || ''), 10);
  if ([200, 227, 230, 248, 260].includes(numericCode)) return numericCode === 200 ? 'storm' : 'fog';
  if (/(гроза|thunder|storm)/i.test(normalized)) return 'storm';
  if (/(снег|метель|snow|blizzard|sleet)/i.test(normalized)) return 'snow';
  if (/(дожд|ливен|морось|rain|drizzle|shower)/i.test(normalized)) return 'rain';
  if (/(туман|дымка|mist|fog|haze)/i.test(normalized)) return 'fog';
  if (/(облач|пасмур|cloud|overcast)/i.test(normalized)) return 'cloud';
  return 'sun';
}

function parseWeatherResponse(data: WttrResponse, requestedLocation: string): Extract<WeatherState, { status: 'ready' }> | null {
  const current = data.current_condition?.[0];
  if (!current) return null;

  const temp = formatTemperature(current.temp_C);
  const condition = cleanWeatherText(
    current.lang_ru?.[0]?.value
      || current.weatherDesc?.[0]?.value
      || ''
  )?.slice(0, 36);
  const area = data.nearest_area?.[0];
  const resolvedLocation = normalizeWeatherLocation(
    requestedLocation
      || area?.areaName?.[0]?.value
      || area?.region?.[0]?.value
      || area?.country?.[0]?.value
  );

  const parts = [resolvedLocation, temp, condition].filter(Boolean);
  if (parts.length < 2) return null;

  return {
    status: 'ready',
    text: parts.join(' · '),
    url: buildWeatherUrl(requestedLocation || resolvedLocation),
    location: resolvedLocation || 'Погода',
    temp,
    condition: condition || '',
    icon: classifyWeatherIcon(condition, current.weatherCode),
  };
}

function WeatherIcon({ kind }: { kind: WeatherIconKind }) {
  if (kind === 'rain') {
    return (
      <span className="weather-card-icon weather-card-icon-rain" aria-hidden="true">
        <i />
        <b />
      </span>
    );
  }
  if (kind === 'snow') {
    return (
      <span className="weather-card-icon weather-card-icon-snow" aria-hidden="true">
        <i />
        <b />
      </span>
    );
  }
  if (kind === 'storm') {
    return (
      <span className="weather-card-icon weather-card-icon-storm" aria-hidden="true">
        <i />
        <b />
      </span>
    );
  }
  if (kind === 'fog') {
    return (
      <span className="weather-card-icon weather-card-icon-fog" aria-hidden="true">
        <i />
        <b />
      </span>
    );
  }
  if (kind === 'cloud') {
    return (
      <span className="weather-card-icon weather-card-icon-cloud" aria-hidden="true">
        <i />
        <b />
      </span>
    );
  }
  return (
    <span className="weather-card-icon weather-card-icon-sun" aria-hidden="true">
      <i />
    </span>
  );
}

function WeatherWidget({ location, mode = 'inline' }: { location: string; mode?: WeatherDisplayMode }) {
  const [weather, setWeather] = useState<WeatherState>({ status: 'loading' });

  useEffect(() => {
    const normalizedLocation = normalizeWeatherLocation(location);
    const cacheKey = `fasp-weather:${normalizedLocation.toLowerCase() || 'auto'}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        const cachedText = cleanWeatherText(String(parsed.text || ''));
        const cachedUrl = typeof parsed.url === 'string' ? parsed.url : buildWeatherUrl(normalizedLocation);
        const cachedTemp = typeof parsed.temp === 'string' ? parsed.temp : '';
        const isFresh = typeof parsed.ts === 'number' && Date.now() - parsed.ts < 1800000;
        if (parsed.version === WEATHER_CACHE_VERSION && cachedText && cachedTemp && isFresh) {
          setWeather({
            status: 'ready',
            text: cachedText,
            url: cachedUrl,
            location: normalizeWeatherLocation(parsed.location) || normalizedLocation || 'Погода',
            temp: cachedTemp,
            condition: typeof parsed.condition === 'string' ? parsed.condition : '',
            icon: classifyWeatherIcon(String(parsed.condition || cachedText), String(parsed.weatherCode || '')),
          });
          return;
        }
        localStorage.removeItem(cacheKey);
      } catch {
        localStorage.removeItem(cacheKey);
      }
    }

    setWeather({ status: 'loading' });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);

    fetch(buildWeatherApiUrl(normalizedLocation), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then((response) => {
        if (!response.ok) throw new Error('Weather unavailable');
        return response.json() as Promise<WttrResponse>;
      })
      .then((data) => {
        const parsed = parseWeatherResponse(data, normalizedLocation);
        if (!parsed) throw new Error('Weather response is incomplete');
        setWeather(parsed);
        localStorage.setItem(cacheKey, JSON.stringify({
          version: WEATHER_CACHE_VERSION,
          text: parsed.text,
          url: parsed.url,
          location: parsed.location,
          temp: parsed.temp,
          condition: parsed.condition,
          icon: parsed.icon,
          ts: Date.now(),
        }));
      })
      .catch(() => setWeather({ status: 'error' }))
      .finally(() => window.clearTimeout(timeout));
  }, [location]);

  if (weather.status === 'loading') {
    if (mode === 'card') {
      return (
        <aside className="weather-card glass-strong info-card" aria-label="Погода">
          <div className="weather-card-loading">Погода...</div>
        </aside>
      );
    }
    return (
      <span className="weather-widget text-xs font-light tracking-wide text-white/38">Погода...</span>
    );
  }

  if (weather.status === 'error') {
    if (mode === 'card') {
      return (
        <aside className="weather-card glass-strong info-card" aria-label="Погода">
          <a className="weather-card-link" href={buildWeatherUrl(normalizeWeatherLocation(location))} target="_blank" rel="noreferrer">
            <span className="weather-card-location">Погода</span>
            <strong>Недоступна</strong>
          </a>
        </aside>
      );
    }
    return (
      <span className="weather-widget text-xs font-light tracking-wide text-white/38" title="wttr.in не ответил или заблокирован">
        Погода недоступна
      </span>
    );
  }

  if (mode === 'card') {
    return (
      <aside className="weather-card glass-strong info-card" aria-label="Погода">
        <a className="weather-card-link" href={weather.url} target="_blank" rel="noreferrer" title="Открыть прогноз погоды">
          <WeatherIcon kind={weather.icon} />
          <span className="weather-card-copy">
            <span className="weather-card-location">{weather.location}</span>
            <strong>{weather.temp || '--°'}</strong>
            {weather.condition && <em>{weather.condition}</em>}
          </span>
        </a>
      </aside>
    );
  }

  return (
    <a
      className="weather-widget weather-widget-link text-xs font-light tracking-wide text-white/50"
      href={weather.url}
      target="_blank"
      rel="noreferrer"
      title="Открыть прогноз погоды"
    >
      {weather.text}
    </a>
  );
}

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [startupReady, setStartupReady] = useState(false);
  const [visualReady, setVisualReady] = useState(false);

  const { loadTiles, syncBookmarks } = useTileStore();
  const { loadLayout } = useLayoutStore();
  const { loadBackground } = useBackgroundStore();
  const { settings, loadSettings } = useSettingsStore();
  const { loadTheme } = useThemeStore();

  useEffect(() => {
    let cancelled = false;
    document.documentElement.dataset.faspVisualReady = 'false';
    logStartupDebug('app:bootstrap:start');

    const timedLoad = async (name: string, task: () => Promise<void>) => {
      const startedAt = performance.now();
      logStartupDebug(`${name}:start`);
      try {
        await task();
        logStartupDebug(`${name}:done`, { durationMs: Math.round(performance.now() - startedAt) });
      } catch (error) {
        logStartupDebug(`${name}:error`, {
          durationMs: Math.round(performance.now() - startedAt),
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };

    const bootstrap = async () => {
      const settingsPromise = timedLoad('settings:load', loadSettings);
      const layoutPromise = timedLoad('layout:load', loadLayout);
      const backgroundPromise = timedLoad('background:load', loadBackground);
      const themePromise = timedLoad('theme:load', loadTheme);

      await settingsPromise;
      const tilesPromise = timedLoad('tiles:load', loadTiles);

      await Promise.all([layoutPromise, backgroundPromise, themePromise, tilesPromise]);
      logStartupDebug('app:bootstrap:stores-ready');
      await preloadThemeStaticBackground(useThemeStore.getState().runtimeTheme);
      logStartupDebug('app:bootstrap:theme-static-preloaded');

      if (cancelled) return;
      setStartupReady(true);
      logStartupDebug('app:startup-data-ready');
    };

    void bootstrap().catch(() => {
      if (cancelled) return;
      setStartupReady(true);
      logStartupDebug('app:startup-data-ready:fallback');
    });

    return () => {
      cancelled = true;
      logStartupDebug('app:bootstrap:cancelled');
    };
  }, [loadTiles, loadLayout, loadBackground, loadSettings, loadTheme]);

  useEffect(() => {
    if (typeof browser === 'undefined' || !browser.runtime?.onMessage) return;

    const handleMessage = (message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message)) return undefined;
      if ((message as { type: string }).type === 'bookmarks-changed') {
        void syncBookmarks();
      }
      return undefined;
    };

    browser.runtime.onMessage.addListener(handleMessage);
    return () => browser.runtime.onMessage.removeListener(handleMessage);
  }, [syncBookmarks]);

  const weatherInline = settings.showWeather && settings.weatherDisplayMode !== 'card';
  const weatherCard = settings.showWeather && settings.weatherDisplayMode === 'card';
  const widgetsVisible = settings.showSearchBar || settings.showClock || weatherInline;
  const infoCardTransparency = Math.max(0, Math.min(1, settings.infoCardTransparency ?? 0.32));
  const infoCardOpacity = 1 - infoCardTransparency;
  const appStyle = {
    '--fasp-info-card-opacity': String(infoCardOpacity),
    '--fasp-info-card-opacity-percent': `${Math.round(infoCardOpacity * 100)}%`,
    '--fasp-info-card-border-percent': `${Math.round(infoCardOpacity * 78)}%`,
    '--fasp-info-card-shadow-percent': `${Math.round(infoCardOpacity * 34)}%`,
  } as CSSProperties;

  const handleBackgroundReady = useCallback((kind: string) => {
    if (visualReady) return;
    document.documentElement.dataset.faspVisualReady = 'true';
    setVisualReady(true);
    logStartupDebug('app:visual-ready', { backgroundKind: kind });
  }, [visualReady]);

  if (!startupReady) {
    return <div className="app-boot-screen" aria-hidden="true" />;
  }

  return (
    <div className="app-scroll-root relative min-h-screen w-full" style={appStyle}>
      <BackgroundLayer onReady={handleBackgroundReady} />

      <button
        data-testid="settings-button"
        className="fixed right-4 top-4 z-50 rounded-full border border-white/20 bg-white/10 p-2 text-white backdrop-blur-lg transition-all duration-300 hover:bg-white/20"
        onClick={() => setShowSettings(!showSettings)}
        aria-label="Toggle settings"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.532 1.532 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.532 1.532 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {!showSettings && (
        <QuickAccessButtons
          showPopular={settings.showPopularTabsButton}
          showRecent={settings.showRecentlyClosedTabsButton}
        />
      )}

      <div className={`widgets-zone ${widgetsVisible ? 'widgets-zone-visible' : ''}`} aria-hidden={!widgetsVisible}>
        <div className="widgets-stack">
          {settings.showSearchBar && (
            <SearchBar
              resultLimit={settings.searchResultLimit ?? 50}
              widthPercent={settings.searchBarWidth ?? 60}
            />
          )}
          <div className="flex flex-wrap items-center justify-center gap-5">
            {settings.showClock && <ClockWidget />}
            {weatherInline && <WeatherWidget location={settings.weatherLocation} mode="inline" />}
          </div>
        </div>
      </div>

      <div className={`tile-grid-shell ${widgetsVisible ? 'tile-grid-shell-with-widgets' : ''}`}>
        <TileGrid />
      </div>

      {settings.showPerformanceMonitor && <PerformanceMonitor />}
      {weatherCard && <WeatherWidget location={settings.weatherLocation} mode="card" />}

      {showSettings && (
        <Suspense fallback={null}>
          <SettingsPanel onClose={() => setShowSettings(false)} />
        </Suspense>
      )}

      {!visualReady && <div className="app-boot-screen app-boot-screen-overlay" aria-hidden="true" />}
    </div>
  );
}
