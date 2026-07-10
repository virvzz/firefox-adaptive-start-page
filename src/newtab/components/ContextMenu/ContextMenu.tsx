import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getScreenshotThumbnailUrl } from '../../../engines/tileAppearance';
import type { Tile } from '../../../types';
import { createThemeColorSwatches, normalizeThemeAccentColor } from '../../ui/themeColors';
import { useThemeStore } from '../../stores/themeStore';
import { useTileStore } from '../../stores/tilesStore';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  getContainerColor,
  listFirefoxContainers,
  openUrlFromStartPage,
  type FirefoxContainer,
} from '../../containers/firefoxContainers';
import {
  formatTileHexColor,
  getPredominantTileColor,
  getTileDisplayColor,
  normalizeTileHexColor,
} from '../../tiles/tileColor';

interface ContextMenuProps {
  x: number;
  y: number;
  tileId?: string;
  parentId?: string | null;
  onClose: () => void;
  onOpenFolder?: (tile: Tile) => void;
  initialConfirmDelete?: boolean;
  onDeleteComplete?: () => void;
}

const CONTEXT_EDGE_GAP = 12;
const CONTEXT_MIN_BOTTOM_GAP = 18;
const CONTEXT_MAX_BOTTOM_GAP = 112;

function getContextBottomGap(): number {
  if (typeof window === 'undefined') return CONTEXT_MIN_BOTTOM_GAP;

  const screenInfo = window.screen as Screen & { availTop?: number };
  const availTop = screenInfo.availTop ?? 0;
  const reservedBottom = Math.max(
    0,
    screenInfo.height - screenInfo.availHeight - availTop
  );

  return Math.max(
    CONTEXT_MIN_BOTTOM_GAP,
    Math.min(CONTEXT_MAX_BOTTOM_GAP, reservedBottom + CONTEXT_EDGE_GAP)
  );
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

function isDescendantOf(tileId: string, ancestorId: string, tiles: Tile[]): boolean {
  let current = tiles.find((tile) => tile.id === tileId);
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = tiles.find((tile) => tile.id === current?.parentId);
  }
  return false;
}

type MenuIconName =
  | 'open'
  | 'edit'
  | 'rename'
  | 'image'
  | 'color'
  | 'reset'
  | 'copy'
  | 'folder'
  | 'globe'
  | 'link'
  | 'search'
  | 'pin'
  | 'unpin'
  | 'text'
  | 'trash'
  | 'undo'
  | 'plus';

function LineIcon({ name }: { name: MenuIconName }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
  };

  const paths: Record<MenuIconName, React.ReactNode> = {
    open: (
      <>
        <path d="M7 17 17 7" />
        <path d="M10 7h7v7" />
      </>
    ),
    edit: (
      <>
        <path d="M4 15.5V20h4.5L18.8 9.7l-4.5-4.5L4 15.5Z" />
        <path d="m13.2 6.3 4.5 4.5" />
      </>
    ),
    rename: (
      <>
        <path d="M5 6h14" />
        <path d="M12 6v12" />
        <path d="M8 18h8" />
      </>
    ),
    image: (
      <>
        <rect x="4" y="5" width="16" height="14" rx="3" />
        <path d="m7 16 3.5-3.5 2.5 2.5 2-2 3 3" />
        <circle cx="9" cy="9" r="1.2" />
      </>
    ),
    color: (
      <>
        <path d="M5 15.5A7 7 0 1 1 17.7 9" />
        <path d="M6 16h12" />
        <path d="M8 16a4 4 0 0 1 8 0" />
      </>
    ),
    reset: (
      <>
        <path d="M7 7a7 7 0 1 1-1.2 8.2" />
        <path d="M7 7H3V3" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="10" height="10" rx="2" />
        <path d="M6 14H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
      </>
    ),
    folder: (
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.8 12h16.4" />
        <path d="M12 3.5c2.2 2.3 3.2 5.1 3.2 8.5s-1 6.2-3.2 8.5" />
        <path d="M12 3.5C9.8 5.8 8.8 8.6 8.8 12s1 6.2 3.2 8.5" />
      </>
    ),
    link: (
      <>
        <path d="M10 13.5a4 4 0 0 0 5.7.1l2.2-2.2a4 4 0 0 0-5.6-5.7l-1.2 1.2" />
        <path d="M14 10.5a4 4 0 0 0-5.7-.1l-2.2 2.2a4 4 0 0 0 5.6 5.7l1.2-1.2" />
      </>
    ),
    search: (
      <>
        <circle cx="10.8" cy="10.8" r="6.2" />
        <path d="m15.4 15.4 4.1 4.1" />
      </>
    ),
    pin: (
      <>
        <path d="m14 4 6 6" />
        <path d="m15 9-6.5 6.5" />
        <path d="M8 12 5 9l7-5 4 4-5 7-3-3Z" />
        <path d="m8.5 15.5-4 4" />
      </>
    ),
    unpin: (
      <>
        <path d="m4 4 16 16" />
        <path d="m15 9-2.2 2.2" />
        <path d="M8 12 5 9l4.2-3" />
        <path d="m8.5 15.5-4 4" />
      </>
    ),
    text: (
      <>
        <path d="M5 6h14" />
        <path d="M12 6v12" />
        <path d="M8 18h8" />
      </>
    ),
    trash: (
      <>
        <path d="M5 7h14" />
        <path d="M9 7V5h6v2" />
        <path d="M8 10v8" />
        <path d="M12 10v8" />
        <path d="M16 10v8" />
        <path d="M7 7l1 14h8l1-14" />
      </>
    ),
    undo: (
      <>
        <path d="M9 7H4v5" />
        <path d="M4.8 11.2A7 7 0 1 0 7.4 6" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
  };

  return (
    <svg className="context-line-icon" viewBox="0 0 24 24" aria-hidden="true" {...common}>
      {paths[name]}
    </svg>
  );
}

function Icon({ children }: { children: MenuIconName | React.ReactNode }) {
  return (
    <span className="context-menu-icon flex h-4 w-4 shrink-0 items-center justify-center text-white/52">
      {typeof children === 'string' ? <LineIcon name={children as MenuIconName} /> : children}
    </span>
  );
}

function MenuDivider() {
  return <hr className="my-1 border-white/5" />;
}

function MenuItem({
  icon,
  children,
  onClick,
  disabled = false,
  danger = false,
}: {
  icon: MenuIconName | React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <button
      type="button"
      role="menuitem"
      onClick={disabled ? undefined : onClick}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      disabled={disabled}
      className={`context-menu-item ${isFocused ? 'context-menu-item-active' : ''} ${danger ? 'text-red-300 hover:bg-red-500/10 hover:text-red-200' : ''} ${disabled ? 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-white/60' : ''}`}
    >
      <Icon>{icon}</Icon>
      {children}
    </button>
  );
}

export function ContextMenu({
  x,
  y,
  tileId,
  parentId = null,
  onClose,
  onOpenFolder,
  initialConfirmDelete = false,
  onDeleteComplete,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const iconFileRef = useRef<HTMLInputElement>(null);
  const customColorRef = useRef<HTMLInputElement>(null);
  const colorDragOffset = useRef<{ x: number; y: number } | null>(null);
  const { runtimeTheme } = useThemeStore();
  const themeAccent = normalizeThemeAccentColor(runtimeTheme.colors.accent);
  const colorSwatches = useMemo(() => createThemeColorSwatches(themeAccent), [themeAccent]);
  const { settings } = useSettingsStore();
  const {
    addTile,
    deleteTile,
    detachBookmarkReference,
    moveTile,
    pinTile,
    tiles,
    undoAction,
    undoLastAction,
    unpinTile,
    updateTile,
  } = useTileStore();
  const inheritedContextColor = useMemo(
    () => getPredominantTileColor(tiles, parentId, colorSwatches[0]),
    [colorSwatches, parentId, tiles]
  );
  const [pos, setPos] = useState({ x, y });
  const [showAdd, setShowAdd] = useState(false);
  const [showFolder, setShowFolder] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const [showColor, setShowColor] = useState(false);
  const [showConfirm, setShowConfirm] = useState(initialConfirmDelete);
  const [showMoveFolders, setShowMoveFolders] = useState(false);
  const [showContainers, setShowContainers] = useState(false);
  const [containers, setContainers] = useState<FirefoxContainer[]>([]);
  const [containersLoading, setContainersLoading] = useState(false);
  const [selectedContainerId, setSelectedContainerId] = useState('');
  const [containerMenuOpen, setContainerMenuOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [img, setImg] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState(inheritedContextColor.color);
  const [colorTouched, setColorTouched] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderCreationMode, setFolderCreationMode] = useState<'plain' | 'move-current'>('plain');
  const [moveFolderQuery, setMoveFolderQuery] = useState('');
  const [colorPanelPos, setColorPanelPos] = useState({ x: x + 16, y: y - 8 });

  const tile = tileId ? tiles.find((candidate) => candidate.id === tileId) : undefined;
  const tileUrl = tile?.url ? normalizeUrl(tile.url) : '';
  const currentParentId = tile?.parentId || parentId || null;
  const parentTile = tile?.parentId ? tiles.find((candidate) => candidate.id === tile.parentId) : undefined;
  const isReferenceRoot = Boolean(
    tile?.source === 'bookmark'
    && tile.bookmarkMode === 'reference'
    && parentTile?.source !== 'bookmark'
  );
  const deleteLabel = isReferenceRoot ? 'Убрать с главной' : 'Удалить';
  const deletePrompt = isReferenceRoot
    ? `Убрать «${tile?.title}» с главной страницы?`
    : `Удалить «${tile?.title}»?`;
  const deleteDescription = isReferenceRoot
    ? 'Оригинальная папка в Избранном останется на месте.'
    : 'Действие нельзя будет отменить.';
  const folders = useMemo(
    () => tiles
      .filter((candidate) => (
        candidate.type === 'folder'
        && candidate.id !== tileId
        && (!tileId || !isDescendantOf(candidate.id, tileId, tiles))
      ))
      .sort((a, b) => a.order - b.order),
    [tiles, tileId]
  );
  const filteredFolders = useMemo(() => {
    const query = moveFolderQuery.trim().toLocaleLowerCase('ru-RU');
    if (!query) return folders;
    return folders.filter((folder) => folder.title.toLocaleLowerCase('ru-RU').includes(query));
  }, [folders, moveFolderQuery]);

  useEffect(() => {
    const needsContainers = showContainers || showAdd || showEdit;
    if (!needsContainers || containers.length > 0 || containersLoading) return;

    let cancelled = false;
    setContainersLoading(true);
    listFirefoxContainers()
      .then((items) => {
        if (!cancelled) setContainers(items);
      })
      .catch(() => {
        if (!cancelled) setContainers([]);
      })
      .finally(() => {
        if (!cancelled) setContainersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [containers.length, containersLoading, showAdd, showContainers, showEdit]);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const bottomGap = getContextBottomGap();
    const viewportRight = window.innerWidth - CONTEXT_EDGE_GAP;
    const viewportBottom = window.innerHeight - bottomGap;
    let nextX = x;
    let nextY = y;
    if (x + rect.width > viewportRight) nextX = viewportRight - rect.width;
    if (y + rect.height > viewportBottom) nextY = viewportBottom - rect.height;
    setPos({
      x: Math.max(CONTEXT_EDGE_GAP, nextX),
      y: Math.max(CONTEXT_EDGE_GAP, nextY),
    });
  }, [x, y, showAdd, showColor, showConfirm, showContainers, showEdit, showFolder, showImage, showMoveFolders, showRename]);

  const contextBottomGap = getContextBottomGap();
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const timeout = window.setTimeout(() => {
      document.addEventListener('mousedown', onMouseDown);
      document.addEventListener('keydown', onKey);
    }, 100);
    const focusTimeout = window.setTimeout(() => {
      ref.current?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      window.clearTimeout(focusTimeout);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const wrapperStyle: React.CSSProperties = {
    position: 'fixed',
    left: pos.x,
    top: pos.y,
    zIndex: 3000,
    maxHeight: `calc(100vh - ${contextBottomGap + CONTEXT_EDGE_GAP}px)`,
    overflowY: 'auto',
    '--context-menu-bottom-gap': `${contextBottomGap}px`,
  } as React.CSSProperties;
  const movePopoutWidth = 318;
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
  const preferredMovePopoutLeft = pos.x + 330;
  const movePopoutLeft = preferredMovePopoutLeft + movePopoutWidth + 12 <= viewportWidth
    ? preferredMovePopoutLeft
    : Math.max(12, pos.x - movePopoutWidth - 16);
  const movePopoutStyle: React.CSSProperties = {
    position: 'fixed',
    left: movePopoutLeft,
    top: Math.max(CONTEXT_EDGE_GAP, Math.min(pos.y + 140, viewportHeight - contextBottomGap - 340)),
    zIndex: 3001,
  };
  const colorPanelStyle: React.CSSProperties = {
    position: 'fixed',
    left: colorPanelPos.x,
    top: colorPanelPos.y,
    zIndex: 3001,
  };

  const renderFloating = (content: React.ReactElement) => (
    typeof document === 'undefined' ? content : createPortal(content, document.body)
  );

  const setColorExplicit = (nextColor: string) => {
    setColorTouched(true);
    setColor(normalizeTileHexColor(nextColor, colorSwatches[0]));
  };

  const resetColorToInherited = (targetParentId: string | null | undefined = parentId) => {
    const inherited = getPredominantTileColor(tiles, targetParentId, colorSwatches[0]);
    setColorTouched(false);
    setColor(inherited.color);
  };

  const getSelectedContainerFields = () => {
    const selected = containers.find((container) => container.cookieStoreId === selectedContainerId);
    const fallbackFromTile = tile?.containerCookieStoreId === selectedContainerId ? tile : undefined;
    return {
      containerCookieStoreId: selectedContainerId || undefined,
      containerName: selectedContainerId ? selected?.name || fallbackFromTile?.containerName : undefined,
      containerColor: selectedContainerId ? selected?.color || fallbackFromTile?.containerColor : undefined,
    };
  };

  const containerOptions = (() => {
    const options = [...containers];
    const hasSelected = selectedContainerId
      ? options.some((container) => container.cookieStoreId === selectedContainerId)
      : true;
    if (!hasSelected && tile?.containerCookieStoreId === selectedContainerId) {
      options.unshift({
        cookieStoreId: tile.containerCookieStoreId,
        name: tile.containerName || 'Выбранный контейнер',
        color: tile.containerColor,
      });
    }
    return options;
  })();

  const renderContainerSelect = (testId: string) => {
    const selectedContainer = containerOptions.find((container) => container.cookieStoreId === selectedContainerId);

    return (
      <div className="context-container-picker">
        <button
          type="button"
          data-testid={`${testId}-trigger`}
          className="context-container-trigger"
          disabled={containersLoading}
          aria-expanded={containerMenuOpen}
          onClick={() => setContainerMenuOpen((open) => !open)}
        >
          <span className="context-container-trigger-label">
            <span
              className="context-container-dot"
              style={{ background: selectedContainer ? getContainerColor(selectedContainer.color) : 'rgba(255,255,255,0.32)' }}
            />
            <span className="truncate">
              {containersLoading ? 'Загрузка контейнеров...' : selectedContainer?.name || 'Без контейнера'}
            </span>
          </span>
          <span className={`context-container-chevron ${containerMenuOpen ? 'context-container-chevron-open' : ''}`}>
            ˅
          </span>
        </button>
        {containerMenuOpen && !containersLoading && (
          <div className="context-container-menu" data-testid={`${testId}-menu`}>
            {[
              { cookieStoreId: '', name: 'Без контейнера', color: undefined },
              ...containerOptions,
            ].map((container) => {
              const selected = selectedContainerId === container.cookieStoreId;
              return (
                <button
                  key={container.cookieStoreId || 'default-container'}
                  type="button"
                  data-testid={`${testId}-option`}
                  data-container-id={container.cookieStoreId}
                  className={`context-container-option ${selected ? 'context-container-option-active' : ''}`}
                  onClick={() => {
                    setSelectedContainerId(container.cookieStoreId);
                    setContainerMenuOpen(false);
                  }}
                >
                  <span
                    className="context-container-dot"
                    style={{ background: container.cookieStoreId ? getContainerColor(container.color) : 'rgba(255,255,255,0.32)' }}
                  />
                  <span className="truncate">{container.name}</span>
                </button>
              );
            })}
          </div>
        )}
        <input type="hidden" data-testid={testId} value={selectedContainerId} readOnly />
      </div>
    );
  };

  const openEdit = () => {
    if (!tile) return;
    setUrl(tile.url || '');
    setTitle(tile.title);
    setImg(tile.customImage || tile.thumbnail || '');
    setIcon(tile.customIcon || '');
    setColor(getTileDisplayColor(tile) || colorSwatches[0]);
    setColorTouched(false);
    setSelectedContainerId(tile.containerCookieStoreId || '');
    setContainerMenuOpen(false);
    setShowEdit(true);
  };

  const doAdd = (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;

    try {
      const normalized = normalizeUrl(url);
      const host = new URL(normalized).hostname.replace('www.', '');
      const parentFolderId = tile?.type === 'folder' ? tile.id : parentId || undefined;
      const inheritedForParent = getPredominantTileColor(tiles, parentFolderId || null, colorSwatches[0]);
      const normalizedColor = colorTouched ? normalizeTileHexColor(color, inheritedForParent.color) : inheritedForParent.color;
      const hasCustomImage = Boolean(img);
      const shouldApplyAccent = !hasCustomImage && (colorTouched || inheritedForParent.source !== 'fallback');
      const siblingCount = tiles.filter((candidate) => (
        parentFolderId ? candidate.parentId === parentFolderId : !candidate.parentId
      )).length;

      addTile({
        id: crypto.randomUUID(),
        type: 'tile',
        title: title.trim() || host,
        url: normalized,
        thumbnail: hasCustomImage ? undefined : (getScreenshotThumbnailUrl(normalized) || undefined),
        customImage: hasCustomImage ? img : undefined,
        customIcon: icon.trim() || undefined,
        dominantColor: hasCustomImage ? undefined : normalizedColor,
        tileAccentColor: shouldApplyAccent ? normalizedColor : undefined,
        ...getSelectedContainerFields(),
        order: siblingCount,
        parentId: parentFolderId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      onClose();
    } catch {
      // Invalid URL: keep the menu open so the user can correct it.
    }
  };

  const doFolder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!folderName.trim()) return;
    const folderId = crypto.randomUUID();
    const createdAt = Date.now();
    const destinationParentId = parentId || undefined;
    const inheritedForParent = getPredominantTileColor(tiles, destinationParentId || null, colorSwatches[0]);
    const normalizedColor = colorTouched ? normalizeTileHexColor(color, inheritedForParent.color) : inheritedForParent.color;
    const shouldApplyAccent = colorTouched || inheritedForParent.source !== 'fallback';

    await addTile({
      id: folderId,
      type: 'folder',
      title: folderName.trim(),
      childrenIds: [],
      dominantColor: normalizedColor,
      tileAccentColor: shouldApplyAccent ? normalizedColor : undefined,
      parentId: destinationParentId,
      order: tiles.filter((candidate) => (parentId ? candidate.parentId === parentId : !candidate.parentId)).length,
      createdAt,
      updatedAt: createdAt,
    });
    if (folderCreationMode === 'move-current' && tileId) {
      const destinationFolder = useTileStore.getState().tiles.find((candidate) => (
        candidate.type === 'folder'
        && candidate.title === folderName.trim()
        && (candidate.parentId || null) === (parentId || null)
        && candidate.createdAt >= createdAt - 1000
      ));
      await moveTile(tileId, destinationFolder?.id || folderId);
    }
    onClose();
  };

  const doEdit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!tileId || !tile || !title.trim()) return;

    if (tile.type === 'folder') {
      void updateTile(tileId, {
        title: title.trim(),
        customImage: img.trim() || undefined,
        customIcon: icon.trim() || undefined,
        thumbnail: undefined,
        dominantColor: img.trim() ? undefined : tile.dominantColor,
      });
      onClose();
      return;
    }

    try {
      const normalized = url.trim() ? normalizeUrl(url) : tile.url;
      const fallbackTitle = normalized ? new URL(normalized).hostname.replace('www.', '') : tile.title;
      void updateTile(tileId, {
        title: title.trim() || fallbackTitle,
        url: normalized,
        customImage: img.trim() || undefined,
        customIcon: icon.trim() || undefined,
        thumbnail: img.trim() ? undefined : (normalized ? (getScreenshotThumbnailUrl(normalized) || undefined) : undefined),
        dominantColor: img.trim() ? undefined : tile.dominantColor,
        ...getSelectedContainerFields(),
      });
      onClose();
    } catch {
      // Invalid URL: keep the editor open so the user can fix it.
    }
  };

  const doRename = (event: React.FormEvent) => {
    event.preventDefault();
    if (!tileId || !title.trim()) return;
    void updateTile(tileId, { title: title.trim() });
    onClose();
  };

  const doImage = (event: React.FormEvent) => {
    event.preventDefault();
    if (!tileId) return;
    const nextImage = img.trim();
    void updateTile(tileId, {
      customImage: nextImage || undefined,
      customImageAssetId: undefined,
      thumbnail: undefined,
      dominantColor: nextImage ? undefined : tile?.dominantColor,
    });
    onClose();
  };

  const resetVisuals = () => {
    if (!tileId) return;
    void updateTile(tileId, {
      customImage: undefined,
      customImageAssetId: undefined,
      customIcon: undefined,
      thumbnail: undefined,
      dominantColor: undefined,
      tileAccentColor: undefined,
    });
    onClose();
  };

  const doColor = (event: React.FormEvent) => {
    event.preventDefault();
    if (!tileId) return;
    const normalizedColor = normalizeTileHexColor(color, colorSwatches[0]);
    void updateTile(tileId, {
      dominantColor: normalizedColor,
      tileAccentColor: normalizedColor,
      customImage: undefined,
      customImageAssetId: undefined,
      thumbnail: undefined,
    });
    onClose();
  };

  const applyColor = (nextColor: string) => {
    if (!tileId) return;
    const normalizedColor = normalizeTileHexColor(nextColor, colorSwatches[0]);
    setColor(normalizedColor);
    void updateTile(tileId, {
      dominantColor: normalizedColor,
      tileAccentColor: normalizedColor,
      customImage: undefined,
      customImageAssetId: undefined,
      thumbnail: undefined,
    });
  };

  const handleCustomColor = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextColor = event.target.value;
    if (showColor) {
      applyColor(nextColor);
      return;
    }
    setColorExplicit(nextColor);
  };

  const startColorPanelDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    colorDragOffset.current = {
      x: event.clientX - colorPanelPos.x,
      y: event.clientY - colorPanelPos.y,
    };
  };

  const dragColorPanel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!colorDragOffset.current) return;
    const nextX = event.clientX - colorDragOffset.current.x;
    const nextY = event.clientY - colorDragOffset.current.y;
    setColorPanelPos({
      x: Math.max(8, Math.min(nextX, window.innerWidth - 388)),
      y: Math.max(8, Math.min(nextY, window.innerHeight - getContextBottomGap() - 86)),
    });
  };

  const endColorPanelDrag = () => {
    colorDragOffset.current = null;
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImg(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleIconFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setIcon(reader.result as string);
    reader.readAsDataURL(file);
  };

  const openCurrent = () => {
    if (!tile) return;
    if (tile.type === 'folder') {
      onOpenFolder?.(tile);
      onClose();
      return;
    }
    if (!tileUrl) return;
    void openUrlFromStartPage(tileUrl, settings.tileOpenTarget, tile.containerCookieStoreId);
    onClose();
  };

  const moveCurrentTile = (folderId: string | null) => {
    if (!tileId) return;
    void moveTile(tileId, folderId);
    onClose();
  };

  const togglePinned = () => {
    if (!tileId || !tile) return;
    if (tile.pinnedAt) {
      void unpinTile(tileId);
    } else {
      void pinTile(tileId);
    }
    onClose();
  };

  if (showAdd) {
    return renderFloating(
      <div ref={ref} className="context-menu context-panel context-panel-create-tile glass-strong rounded-xl p-4 w-80 shadow-2xl text-white" style={wrapperStyle}>
        <form onSubmit={doAdd} className="context-create-form">
          <label className="context-field">
            <span className="context-field-icon"><LineIcon name="link" /></span>
            <input
              placeholder="https://example.com"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              autoFocus
              required
            />
          </label>

          <label className="context-field">
            <span className="context-field-icon context-field-icon-text"><LineIcon name="text" /></span>
            <input
              placeholder="Название"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            {title && (
              <button type="button" className="context-field-clear" onClick={() => setTitle('')} aria-label="Очистить название">
                ×
              </button>
            )}
          </label>

          {renderContainerSelect('context-add-container-select')}

          <div className="context-color-strip" aria-label="Цвет плитки">
            <button type="button" className="context-color-globe" onClick={() => setColorExplicit(colorSwatches[0])} aria-label="Основной цвет">
              <LineIcon name="globe" />
            </button>
            <div className="context-color-dots">
              {colorSwatches.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={swatch}
                  className={`context-color-dot ${color === swatch ? 'context-color-dot-active' : ''}`}
                  style={{ background: swatch }}
                  onClick={() => setColorExplicit(swatch)}
                />
              ))}
              <button
                type="button"
                className="context-color-dot context-color-custom-dot"
                onClick={() => customColorRef.current?.click()}
                aria-label="Выбрать произвольный цвет"
              >
                ...
              </button>
            </div>
          </div>
          <input ref={customColorRef} type="color" value={color} onChange={handleCustomColor} className="hidden" />
          <input
            type="text"
            className="tile-color-code-field"
            value={formatTileHexColor(color, inheritedContextColor.color)}
            readOnly
            spellCheck={false}
            aria-label="HEX цвет плитки"
            data-testid="context-add-color-code"
            onFocus={(event) => event.currentTarget.select()}
          />

          <div className="flex items-center gap-2">
            <input
              placeholder="URL иконки или файл"
              value={icon}
              data-testid="context-add-icon-input"
              onChange={(event) => setIcon(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/10 px-2 py-1.5 text-xs text-white outline-none transition-all duration-300 placeholder-white/25 focus:border-white/30 focus:bg-white/[0.14]"
            />
            <button
              type="button"
              onClick={() => iconFileRef.current?.click()}
              className="context-file-button shrink-0 rounded-lg bg-white/10 px-2 py-1.5 text-xs text-white/55 transition-colors duration-300 hover:bg-white/20 hover:text-white/80"
            >
              Файл
            </button>
            <button
              type="button"
              onClick={() => setIcon('')}
              className="context-file-button shrink-0 rounded-lg bg-white/10 px-2 py-1.5 text-xs text-white/55 transition-colors duration-300 hover:bg-white/20 hover:text-white/80"
            >
              Очистить
            </button>
            <input ref={iconFileRef} type="file" accept="image/*" className="hidden" onChange={handleIconFile} />
          </div>

          <div className="context-action-row">
            <button type="button" onClick={onClose} className="context-secondary-button">
              Отмена
            </button>
            <button type="submit" className="context-primary-button">
              Добавить
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (showFolder) {
    return renderFloating(
      <div ref={ref} className="context-menu context-panel context-panel-create-folder glass-strong rounded-xl p-4 w-72 shadow-2xl text-white" style={wrapperStyle}>
        <form onSubmit={doFolder} className="context-create-form">
          <div className="context-folder-preview" aria-hidden="true">
            <LineIcon name="folder" />
          </div>

          <label className="context-field context-folder-name-field">
            <input
              placeholder="Новая папка"
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              autoFocus
            />
          </label>

          <div className="context-folder-icon-rail" aria-label="Вид папки">
            <button
              type="button"
              className={`context-folder-icon-choice ${color === colorSwatches[0] ? 'context-folder-icon-choice-active' : ''}`}
              onClick={() => setColorExplicit(colorSwatches[0])}
            >
              <LineIcon name="folder" />
            </button>
            {colorSwatches.slice(1, 7).map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={`context-folder-icon-choice ${color === swatch ? 'context-folder-icon-choice-active' : ''}`}
                onClick={() => setColorExplicit(swatch)}
                aria-label={swatch}
              >
                <span style={{ background: swatch }} />
              </button>
            ))}
            <button
              type="button"
              className="context-folder-icon-choice context-folder-custom-color"
              onClick={() => customColorRef.current?.click()}
              aria-label="Выбрать произвольный цвет"
            >
              ...
            </button>
          </div>
          <input ref={customColorRef} type="color" value={color} onChange={handleCustomColor} className="hidden" />
          <input
            type="text"
            className="tile-color-code-field"
            value={formatTileHexColor(color, inheritedContextColor.color)}
            readOnly
            spellCheck={false}
            aria-label="HEX цвет папки"
            data-testid="context-folder-color-code"
            onFocus={(event) => event.currentTarget.select()}
          />

          <div className="context-action-row">
            <button type="button" onClick={onClose} className="context-secondary-button">
              Отмена
            </button>
            <button type="submit" className="context-primary-button">
              Создать
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (showEdit && tile) {
    return renderFloating(
      <div ref={ref} className="context-menu context-panel context-panel-wide glass-strong rounded-xl p-4 w-96 shadow-2xl text-white" style={wrapperStyle}>
        <h4 className="mb-3 text-sm font-medium text-white/80">
          {tile.type === 'folder' ? 'Редактировать папку' : 'Редактировать плитку'}
        </h4>
        <form onSubmit={doEdit} className="space-y-2">
          {tile.type === 'tile' && (
            <input
              placeholder="URL"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition-all duration-300 placeholder-white/30 focus:border-white/30 focus:bg-white/[0.14]"
              autoFocus
              required
            />
          )}
          <input
            placeholder={tile.type === 'folder' ? 'Название папки' : 'Название'}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition-all duration-300 placeholder-white/30 focus:border-white/30 focus:bg-white/[0.14]"
            autoFocus={tile.type === 'folder'}
          />
          {tile.type === 'tile' && renderContainerSelect('context-edit-container-select')}
          <div className="flex items-center gap-2">
            <input
              placeholder="URL картинки или файл"
              value={img}
              onChange={(event) => setImg(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/10 px-2 py-1.5 text-xs text-white outline-none transition-all duration-300 placeholder-white/25 focus:border-white/30 focus:bg-white/[0.14]"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="context-file-button shrink-0 rounded-lg bg-white/10 px-2 py-1.5 text-xs text-white/55 transition-colors duration-300 hover:bg-white/20 hover:text-white/80"
            >
              Файл
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </div>
          <div className="flex items-center gap-2">
            <input
              placeholder="URL иконки или файл"
              value={icon}
              data-testid="context-edit-icon-input"
              onChange={(event) => setIcon(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/10 px-2 py-1.5 text-xs text-white outline-none transition-all duration-300 placeholder-white/25 focus:border-white/30 focus:bg-white/[0.14]"
            />
            <button
              type="button"
              onClick={() => iconFileRef.current?.click()}
              className="context-file-button shrink-0 rounded-lg bg-white/10 px-2 py-1.5 text-xs text-white/55 transition-colors duration-300 hover:bg-white/20 hover:text-white/80"
            >
              Файл
            </button>
            <button
              type="button"
              onClick={() => setIcon('')}
              className="context-file-button shrink-0 rounded-lg bg-white/10 px-2 py-1.5 text-xs text-white/55 transition-colors duration-300 hover:bg-white/20 hover:text-white/80"
            >
              Очистить
            </button>
            <input ref={iconFileRef} type="file" accept="image/*" className="hidden" onChange={handleIconFile} />
          </div>
          <input
            type="text"
            className="tile-color-code-field"
            value={formatTileHexColor(color, colorSwatches[0])}
            readOnly
            spellCheck={false}
            aria-label="HEX цвет"
            data-testid="context-edit-color-code"
            onFocus={(event) => event.currentTarget.select()}
          />
          {(tile.customImage || tile.customImageAssetId || tile.thumbnail || tile.customIcon || tile.dominantColor || tile.tileAccentColor) && (
            <button
              type="button"
              onClick={resetVisuals}
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-xs text-white/58 transition-colors hover:bg-white/[0.08] hover:text-white/80"
            >
              Вернуть стандартный вид
            </button>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/60 transition-colors duration-300 hover:bg-white/10">
              Отмена
            </button>
            <button type="submit" className="flex-1 rounded-lg bg-white/[0.16] px-3 py-2 text-sm font-medium text-white transition-colors duration-300 hover:bg-white/[0.24]">
              Сохранить
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (showRename) {
    return renderFloating(
      <div ref={ref} className="context-menu context-panel context-panel-form glass-strong rounded-xl p-4 w-72 shadow-2xl text-white" style={wrapperStyle}>
        <h4 className="mb-3 text-sm font-medium text-white/80">Переименовать</h4>
        <form onSubmit={doRename} className="space-y-2">
          <input
            placeholder="Название"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition-all duration-300 placeholder-white/30 focus:border-white/30 focus:bg-white/[0.14]"
            autoFocus
          />
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/60 transition-colors duration-300 hover:bg-white/10">
              Отмена
            </button>
            <button type="submit" className="flex-1 rounded-lg bg-white/[0.16] px-3 py-2 text-sm font-medium text-white transition-colors duration-300 hover:bg-white/[0.24]">
              Сохранить
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (showImage) {
    return renderFloating(
      <div ref={ref} className="context-menu context-panel context-panel-form glass-strong rounded-xl p-4 w-80 shadow-2xl text-white" style={wrapperStyle}>
        <h4 className="mb-3 text-sm font-medium text-white/80">Изменить изображение</h4>
        <form onSubmit={doImage} className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              placeholder="URL картинки или файл"
              value={img}
              onChange={(event) => setImg(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/10 px-2 py-1.5 text-xs text-white outline-none transition-all duration-300 placeholder-white/25 focus:border-white/30 focus:bg-white/[0.14]"
              autoFocus
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="context-file-button shrink-0 rounded-lg bg-white/10 px-2 py-1.5 text-xs text-white/55 transition-colors duration-300 hover:bg-white/20 hover:text-white/80"
            >
              Файл
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </div>
          {(tile?.customImage || tile?.customImageAssetId || tile?.thumbnail || tile?.customIcon || tile?.dominantColor || tile?.tileAccentColor) && (
            <button
              type="button"
              onClick={resetVisuals}
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-xs text-white/58 transition-colors hover:bg-white/[0.08] hover:text-white/80"
            >
              Вернуть стандартный вид
            </button>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/60 transition-colors duration-300 hover:bg-white/10">
              Отмена
            </button>
            <button type="submit" className="flex-1 rounded-lg bg-white/[0.16] px-3 py-2 text-sm font-medium text-white transition-colors duration-300 hover:bg-white/[0.24]">
              Сохранить
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (showColor) {
    return renderFloating(
      <div ref={ref} className="context-menu context-panel-color context-panel-color-strip glass-strong rounded-xl p-4 w-72 shadow-2xl text-white" style={colorPanelStyle}>
        <div
          className="context-color-drag-handle"
          onPointerDown={startColorPanelDrag}
          onPointerMove={dragColorPanel}
          onPointerUp={endColorPanelDrag}
          onPointerCancel={endColorPanelDrag}
          aria-label="Переместить палитру"
        />
        <div className="context-color-strip" aria-label="Изменить цвет">
          <button type="button" className="context-color-globe" onClick={() => applyColor(colorSwatches[0])} aria-label="Основной цвет">
            <LineIcon name="globe" />
          </button>
          <div className="context-color-dots">
            {colorSwatches.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={swatch}
                className={`context-color-dot ${color === swatch ? 'context-color-dot-active' : ''}`}
                style={{ background: swatch }}
                onClick={() => applyColor(swatch)}
              />
            ))}
            <button
              type="button"
              className="context-color-dot context-color-custom-dot"
              onClick={() => customColorRef.current?.click()}
              aria-label="Выбрать произвольный цвет"
            >
              ...
            </button>
          </div>
        </div>
        <input ref={customColorRef} type="color" value={color} onChange={handleCustomColor} className="hidden" />
        <input
          type="text"
          className="tile-color-code-field"
          value={formatTileHexColor(color, colorSwatches[0])}
          readOnly
          spellCheck={false}
          aria-label="HEX цвет"
          data-testid="context-color-code"
          onFocus={(event) => event.currentTarget.select()}
        />
      </div>
    );
  }

  if (showConfirm) {
    return renderFloating(
      <div ref={ref} data-testid="context-delete-confirm" className="context-menu context-panel context-panel-danger glass-strong rounded-xl p-4 w-64 shadow-2xl text-white" style={wrapperStyle}>
        <p className="text-sm font-medium text-white/78">{deletePrompt}</p>
        <p className="mt-1 mb-3 text-xs text-white/42">{deleteDescription}</p>
        <div className="flex gap-2">
          <button data-testid="context-delete-cancel" onClick={onClose} className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/60 transition-colors duration-300 hover:bg-white/10">
            Отмена
          </button>
          <button data-testid="context-delete-accept" onClick={() => { if (tileId) { void deleteTile(tileId).then(onDeleteComplete); onClose(); } }} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-300 ${isReferenceRoot ? 'bg-white/[0.14] text-white hover:bg-white/[0.2]' : 'bg-red-500/20 text-red-200 hover:bg-red-500/35'}`}>
            {deleteLabel}
          </button>
        </div>
      </div>
    );
  }

  return renderFloating(
    <div
      ref={ref}
      role="menu"
      aria-label="Context menu"
      data-testid="context-menu"
      className="context-menu context-main-menu glass-strong min-w-[270px] rounded-xl py-2 shadow-2xl text-white"
      style={wrapperStyle}
    >
      <div className="context-menu-title px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-white/35">
        {tile ? tile.title : 'Новая вкладка'}
      </div>
      <MenuDivider />
      {undoAction && (
        <>
          <MenuItem icon="undo" onClick={() => { void undoLastAction(); onClose(); }}>
            {undoAction.label}
          </MenuItem>
          <MenuDivider />
        </>
      )}

      {tile ? (
        <>
          <MenuItem icon="open" onClick={openCurrent} disabled={tile.type !== 'folder' && !tileUrl}>
            Открыть
          </MenuItem>

          {tileUrl && (
            <>
              <MenuItem icon="open" onClick={() => { void openUrlFromStartPage(tileUrl, 'new-tab', tile.containerCookieStoreId); onClose(); }}>
                Открыть в новой вкладке
              </MenuItem>
              <MenuItem icon="open" onClick={() => setShowContainers((value) => !value)}>
                Открыть в контейнере Firefox
              </MenuItem>
              {showContainers && (
                <div className="context-submenu-list mx-2 my-1 overflow-hidden rounded-lg border border-white/5 bg-black/10 py-1">
                  {containersLoading && (
                    <div className="px-3 py-2 text-xs text-white/40">Загрузка контейнеров...</div>
                  )}
                  {!containersLoading && containers.length === 0 && (
                    <div className="px-3 py-2 text-xs text-white/40">Нет доступных контейнеров</div>
                  )}
                  {!containersLoading && containers.map((container) => (
                    <button
                      key={container.cookieStoreId}
                      type="button"
                      onClick={() => { void openUrlFromStartPage(tileUrl, 'new-tab', container.cookieStoreId); onClose(); }}
                      className="context-submenu-row flex w-full items-center gap-2 truncate px-3 py-2 text-left text-xs text-white/65 transition-colors duration-300 hover:bg-white/10 hover:text-white"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: getContainerColor(container.color) }}
                      />
                      <span className="truncate">{container.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <MenuDivider />

          <MenuItem icon="edit" onClick={openEdit}>
            Редактировать
          </MenuItem>
          <MenuItem icon="rename" onClick={() => { setTitle(tile.title); setShowRename(true); }}>
            Переименовать
          </MenuItem>
          <MenuItem icon="image" onClick={() => { setImg(tile.customImage || ''); setShowImage(true); }}>
            Изменить изображение
          </MenuItem>
          <MenuItem icon="color" onClick={() => {
            setColor(getTileDisplayColor(tile) || colorSwatches[0]);
            setColorTouched(false);
            setColorPanelPos({
              x: Math.max(8, Math.min(x + 16, window.innerWidth - 388)),
              y: Math.max(8, Math.min(y - 8, window.innerHeight - getContextBottomGap() - 86)),
            });
            setShowColor(true);
          }}>
            Изменить цвет
          </MenuItem>
          {(tile.customImage || tile.customImageAssetId || tile.thumbnail || tile.customIcon || tile.dominantColor || tile.tileAccentColor) && (
            <MenuItem icon="reset" onClick={resetVisuals}>
              Вернуть стандартный вид
            </MenuItem>
          )}

          {isReferenceRoot && (
            <MenuItem icon="copy" onClick={() => { if (tileId) void detachBookmarkReference(tileId); onClose(); }}>
              Отцепить как копию
            </MenuItem>
          )}

          <MenuDivider />

          {folders.length > 0 && (
            <>
              <MenuItem icon="folder" onClick={() => {
                setMoveFolderQuery('');
                setShowMoveFolders((value) => !value);
              }}>
                Поместить в папку
              </MenuItem>
              {showMoveFolders && (
                <div className="context-move-popout" style={movePopoutStyle}>
                  <div className="context-move-title">Подменю: переместить в папку</div>
                  <label className="context-move-search">
                    <input
                      value={moveFolderQuery}
                      onChange={(event) => setMoveFolderQuery(event.target.value)}
                      placeholder="Поиск папки"
                    />
                    <span><LineIcon name="search" /></span>
                  </label>
                  <div className="context-move-list">
                    {filteredFolders.map((folder) => (
                      <button
                        key={folder.id}
                        onClick={() => moveCurrentTile(folder.id)}
                        className="context-move-row"
                      >
                        <span className="context-move-folder-icon"><LineIcon name="folder" /></span>
                        <span className="truncate">{folder.title}</span>
                      </button>
                    ))}
                    {filteredFolders.length === 0 && (
                      <div className="context-move-empty">Папки не найдены</div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="context-move-new-folder"
                    onClick={() => {
                      setFolderName(moveFolderQuery.trim() || '');
                      resetColorToInherited(parentId);
                      setFolderCreationMode('move-current');
                      setShowMoveFolders(false);
                      setShowFolder(true);
                    }}
                  >
                    <LineIcon name="plus" />
                    <span>Новая папка</span>
                  </button>
                </div>
              )}
            </>
          )}
          <MenuItem icon={tile.pinnedAt ? 'unpin' : 'pin'} onClick={togglePinned}>
            {tile.pinnedAt ? 'Открепить' : 'Закрепить сверху'}
          </MenuItem>

          {tileUrl && (
            <>
              <MenuDivider />
              <MenuItem icon="copy" onClick={() => { void copyText(tileUrl); onClose(); }}>
                Копировать URL
              </MenuItem>
            </>
          )}

          <MenuDivider />

          <MenuItem icon="trash" danger={!isReferenceRoot} onClick={() => setShowConfirm(true)}>
            {deleteLabel}
          </MenuItem>
        </>
      ) : (
        <>
          <MenuItem icon="plus" onClick={() => { setUrl(''); setTitle(''); setImg(''); setIcon(''); resetColorToInherited(parentId); setSelectedContainerId(''); setContainerMenuOpen(false); setShowAdd(true); }}>
            Добавить сайт
          </MenuItem>
          <MenuItem icon="folder" onClick={() => { setFolderName(''); resetColorToInherited(parentId); setFolderCreationMode('plain'); setShowFolder(true); }}>
            Создать папку
          </MenuItem>
        </>
      )}
    </div>
  );
}
