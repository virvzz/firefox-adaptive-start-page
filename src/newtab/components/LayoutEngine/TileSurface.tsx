import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragMoveEvent,
  DragOverlay,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
} from '@dnd-kit/core';
import {
  rectSortingStrategy,
  SortableContext,
  useSortable,
  type SortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Tile } from '../../../types';
import { TileCard } from '../Tile/TileCard';
import { useLayoutStore } from '../../stores/layoutStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTileStore } from '../../stores/tilesStore';
import {
  SURFACE_INTERACTION,
  canCreateFolderFromSites,
  canMoveIntoFolder,
  isPointOutsideRect,
  resolveSurfaceInteraction,
  type Point,
  type RectLike,
  type SurfaceDropIntent,
  type SurfaceDropIntentType,
} from '../../engines/surfaceInteractionEngine';
import {
  type DebugRect,
  getElementDebugRect,
  getDragTelemetrySnapshot,
  getTileDebugOverlayChangeEventName,
  getTileDebugGeometrySnapshot,
  getTileDebugRect,
  isTileDebugOverlayEnabled,
  isTileDebugEnabled,
  logDragContext,
  logDragDecision,
  logDragStateChange,
  logTileDebug,
  summarizeTile,
  summarizeTileOrder,
} from '../../../debug/tileDebug';

const AddTileModal = lazy(() => import('../AddTile/AddTileModal').then((module) => ({
  default: module.AddTileModal,
})));
const ContextMenu = lazy(() => import('../ContextMenu/ContextMenu').then((module) => ({
  default: module.ContextMenu,
})));

interface TileSurfaceProps {
  parentId?: string | null;
  title?: string;
  level?: number;
  onClose?: () => void;
  openOriginRect?: DebugRect | null;
}

type DropIntent = SurfaceDropIntent | null;

const lockedSortingStrategy: SortingStrategy = () => null;
const FOLDER_TRANSITION_MS = 320;
const DND_ACTIVE_EVENT = 'fasp-dnd-active-change';

interface SharedTileDragState {
  activeId: string | null;
  activeTile: Tile | null;
  dropIntent: DropIntent;
  pendingCreateTargetId: string | null;
  exitingFolderId: string | null;
}

const SharedTileDragContext = createContext<SharedTileDragState | null>(null);

function getEventPoint(event: Event): Point | null {
  if ('clientX' in event && 'clientY' in event) {
    return {
      x: (event as MouseEvent | PointerEvent).clientX,
      y: (event as MouseEvent | PointerEvent).clientY,
    };
  }

  if ('touches' in event) {
    const touchEvent = event as TouchEvent;
    const touch = touchEvent.touches[0] || touchEvent.changedTouches[0];
    if (touch) return { x: touch.clientX, y: touch.clientY };
  }

  return null;
}

function pointFromDragDelta(startPoint: Point | null, delta: { x: number; y: number }): Point | null {
  if (!startPoint) return null;
  return {
    x: startPoint.x + delta.x,
    y: startPoint.y + delta.y,
  };
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function getPointDistance(a: Point | null, b: Point | null): number | null {
  if (!a || !b) return null;
  return roundMetric(Math.hypot(a.x - b.x, a.y - b.y));
}

function getFolderAnimationStyle(originRect: DebugRect | null | undefined): React.CSSProperties {
  const fallbackX = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
  const fallbackY = typeof window !== 'undefined' ? window.innerHeight / 2 : 0;
  const originX = originRect?.center.x ?? fallbackX;
  const originY = originRect?.center.y ?? fallbackY;

  return {
    '--folder-origin-x': `${originX}px`,
    '--folder-origin-y': `${originY}px`,
  } as React.CSSProperties;
}

function surfaceKey(parentId: string | null | undefined): string {
  return parentId || 'root';
}

function dispatchDndActive(active: boolean): void {
  if (typeof window === 'undefined') return;
  document.documentElement.classList.toggle('fasp-dnd-active', active);
  window.dispatchEvent(new CustomEvent(DND_ACTIVE_EVENT, { detail: { active } }));
}

function getFolderPanelElement(parentId: string): HTMLElement | null {
  const panels = document.querySelectorAll<HTMLElement>('[data-folder-panel]');
  return Array.from(panels).find((panel) => panel.dataset.parentId === parentId) || null;
}

function isPointInsideRect(point: Point | null, rect: RectLike | null | undefined): boolean {
  if (!point || !rect) return false;
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function hasCrossedReorderMidpoint(
  point: Point | null,
  activeRect: RectLike | null | undefined,
  targetRect: RectLike | null | undefined
): boolean {
  if (!point || !activeRect || !targetRect) return false;

  const activeCenterX = activeRect.left + activeRect.width / 2;
  const activeCenterY = activeRect.top + activeRect.height / 2;
  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;
  const deltaX = targetCenterX - activeCenterX;
  const deltaY = targetCenterY - activeCenterY;

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    if (deltaX < 0) return point.x < targetCenterX;
    if (deltaX > 0) return point.x > targetCenterX;
    return false;
  }

  if (deltaY < 0) return point.y < targetCenterY;
  if (deltaY > 0) return point.y > targetCenterY;
  return false;
}

function debugContextValue(context: unknown, key: string): unknown {
  if (!context || typeof context !== 'object') return null;
  const record = context as Record<string, unknown>;
  if (key in record) return record[key];
  const nested = record.context;
  if (nested && typeof nested === 'object' && key in nested) {
    return (nested as Record<string, unknown>)[key];
  }
  return null;
}

function debugContextId(context: unknown, key: string): string | null {
  const direct = debugContextValue(context, key);
  if (typeof direct === 'string') return direct;

  const objectValue = debugContextValue(context, key.replace(/Id$/, ''));
  if (objectValue && typeof objectValue === 'object') {
    const record = objectValue as Record<string, unknown>;
    if (typeof record.fullId === 'string') return record.fullId;
    if (typeof record.id === 'string') return record.id;
  }

  return null;
}

function SortableTile({
  tile,
  childCount,
  folderPreviewItems,
  isDragging,
  isFolderDropTarget,
  isFolderCreateTarget,
  folderCreatePartner,
  preferFaviconOnly,
  suppressLayoutTransform,
  isContextMenuDimmed,
  isContextMenuTarget,
  onOpenFolder,
}: {
  tile: Tile;
  childCount: number;
  folderPreviewItems: Tile[];
  isDragging: boolean;
  isFolderDropTarget: boolean;
  isFolderCreateTarget: boolean;
  folderCreatePartner: Tile | null;
  preferFaviconOnly: boolean;
  suppressLayoutTransform: boolean;
  isContextMenuDimmed: boolean;
  isContextMenuTarget: boolean;
  onOpenFolder: (tile: Tile) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: tile.id });

  const style: React.CSSProperties = {
    transform: suppressLayoutTransform && !isDragging ? undefined : CSS.Transform.toString(transform),
    transition: isDragging
      ? undefined
      : transition || `transform ${SURFACE_INTERACTION.layoutTransformDurationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`,
    zIndex: isDragging ? 30 : undefined,
    willChange: isDragging ? 'transform' : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`sortable-tile ${isDragging ? 'is-dragging' : ''} ${isContextMenuDimmed ? 'context-menu-dimmed' : ''} ${isContextMenuTarget ? 'context-menu-target' : ''}`}
      {...attributes}
      {...listeners}
      aria-label={tile.title}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        event.currentTarget.querySelector<HTMLElement>('[data-testid="tile-card"]')?.click();
      }}
    >
      <TileCard
        tile={tile}
        childCount={childCount}
        folderPreviewItems={folderPreviewItems}
        isDragging={isDragging}
        isFolderDropTarget={isFolderDropTarget}
        isFolderCreateTarget={isFolderCreateTarget}
        folderCreatePartner={folderCreatePartner}
        preferFaviconOnly={preferFaviconOnly}
        onOpenFolder={onOpenFolder}
      />
    </div>
  );
}

function TileDebugOverlay({ enabled }: { enabled: boolean }) {
  const [snapshot, setSnapshot] = useState<{ geometry: unknown; drag: unknown } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    let frameId = 0;
    const tick = () => {
      if (cancelled) return;
      setSnapshot({
        geometry: getTileDebugGeometrySnapshot(),
        drag: getDragTelemetrySnapshot(),
      });
      frameId = window.setTimeout(tick, 180);
    };

    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(frameId);
    };
  }, [enabled]);

  if (!enabled || !snapshot) return null;

  const geometry = snapshot.geometry as {
    tiles?: Array<Record<string, any>>;
    pointer?: Record<string, unknown>;
  } | null;
  const drag = snapshot.drag as {
    state?: string;
    context?: unknown;
  } | null;
  const tiles = geometry?.tiles || [];
  const context = drag?.context || null;
  const sourceId = debugContextId(context, 'sourceId') || debugContextId(context, 'activeId');
  const targetId = debugContextId(context, 'targetId') || debugContextId(context, 'overId');
  const mode = String(debugContextValue(context, 'mode') || drag?.state || 'IDLE');
  const hoverDuration = debugContextValue(context, 'hoverDurationMs');
  const requiredDuration = debugContextValue(context, 'requiredHoverMs');

  return (
    <div className="tile-debug-overlay" aria-hidden="true">
      <div className="tile-debug-panel">
        <div><strong>{drag?.state || 'IDLE'}</strong></div>
        <div>mode: {mode}</div>
        <div>source: {sourceId ? sourceId.slice(0, 8) : '-'}</div>
        <div>target: {targetId ? targetId.slice(0, 8) : '-'}</div>
        <div>hover: {typeof hoverDuration === 'number' ? `${Math.round(hoverDuration)}ms` : '-'} / {typeof requiredDuration === 'number' ? `${requiredDuration}ms` : '-'}</div>
      </div>

      {tiles.map((tile) => {
        const rect = tile.hitboxRect || tile.rect;
        if (!rect) return null;
        const id = String(tile.id || '');
        const zone = tile.folderCreateZoneRect;
        const isSource = id === sourceId;
        const isTarget = id === targetId;
        return (
          <div key={id} className={`tile-debug-hitbox ${isSource ? 'tile-debug-source' : ''} ${isTarget ? 'tile-debug-target' : ''}`} style={{
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          }}>
            <div className="tile-debug-label">
              {tile.type}:{id.slice(0, 8)} L{tile.level ?? '-'} #{tile.index ?? tile.order ?? '-'}
              <span>p:{String(tile.parentId || 'root').slice(0, 8)}</span>
              <span>{Math.round(rect.width)}x{Math.round(rect.height)}</span>
            </div>
            <div className="tile-debug-midline-x" />
            <div className="tile-debug-midline-y" />
            {zone && (
              <div className="tile-debug-create-zone" style={{
                left: `${zone.left - rect.left}px`,
                top: `${zone.top - rect.top}px`,
                width: `${zone.width}px`,
                height: `${zone.height}px`,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TileSurface({ parentId = null, title, level = 0, onClose, openOriginRect }: TileSurfaceProps) {
  const sharedDragState = useContext(SharedTileDragContext);
  const { config } = useLayoutStore();
  const { settings } = useSettingsStore();
  const {
    tiles,
    loading: tilesLoading,
    openFolderIds,
    reorderTiles,
    moveTile,
    createFolder,
    openFolder: openFolderInStore,
    closeFolder: closeFolderInStore,
    getSurfaceItems,
  } = useTileStore();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropIntent, setDropIntent] = useState<DropIntent>(null);
  const [pendingCreateTargetId, setPendingCreateTargetId] = useState<string | null>(null);
  const [isDraggingOutsideFolder, setIsDraggingOutsideFolder] = useState(false);
  const [exitingFolderId, setExitingFolderId] = useState<string | null>(null);
  const [folderOpenOriginRect, setFolderOpenOriginRect] = useState<DebugRect | null>(null);
  const [isClosingFolder, setIsClosingFolder] = useState(false);
  const [closingOriginRect, setClosingOriginRect] = useState<DebugRect | null>(null);
  const [debugOverlayEnabled, setDebugOverlayEnabled] = useState(() => isTileDebugOverlayEnabled());
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addDialogEntryMode, setAddDialogEntryMode] = useState<'site' | 'bookmark-folder'>('site');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tileId?: string;
  } | null>(null);
  const dropIntentTimer = useRef<number | null>(null);
  const activeDropIntent = useRef<DropIntent>(null);
  const pendingDropIntent = useRef<Exclude<DropIntent, null> | null>(null);
  const lastDragOverDebugKey = useRef<string | null>(null);
  const lastDragMoveDebugAt = useRef(0);
  const previousFolderOpenId = useRef<string | null>(null);
  const activeDragId = useRef<string | null>(null);
  const currentOverId = useRef<string | null>(null);
  const hoverTargetId = useRef<string | null>(null);
  const hoverStartedAt = useRef<number | null>(null);
  const folderCreatePendingStartedAt = useRef<number | null>(null);
  const dragStartPoint = useRef<Point | null>(null);
  const currentDragPoint = useRef<Point | null>(null);
  const dragTileRects = useRef<Map<string, DebugRect>>(new Map());
  const dragFolderPanelRects = useRef<Map<string, DebugRect>>(new Map());
  const centerIntentCandidate = useRef<{
    targetId: string;
    type: SurfaceDropIntentType;
    point: Point | null;
    startedAt: number;
  } | null>(null);
  const suppressClickUntil = useRef(0);
  const draggingOutsideFolder = useRef(false);
  const handoffFolderIds = useRef<Set<string>>(new Set());
  const folderCloseTimer = useRef<number | null>(null);
  const tileSurfaceRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const folderPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const eventName = getTileDebugOverlayChangeEventName();
    const handleOverlayChange = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
      setDebugOverlayEnabled(Boolean(detail?.enabled));
    };

    window.addEventListener(eventName, handleOverlayChange);
    return () => window.removeEventListener(eventName, handleOverlayChange);
  }, []);

  useEffect(() => () => {
    if (folderCloseTimer.current !== null) {
      window.clearTimeout(folderCloseTimer.current);
      folderCloseTimer.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (level === 0) dispatchDndActive(false);
  }, [level]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: SURFACE_INTERACTION.pointerActivationDistance },
    })
  );
  const itemById = useMemo(() => {
    const map = new Map<string, Tile>();
    for (const tile of tiles) map.set(tile.id, tile);
    return map;
  }, [tiles]);
  const surfaceItemsByParent = useMemo(() => {
    const map = new Map<string, Tile[]>();
    for (const tile of tiles) {
      const key = surfaceKey(tile.parentId);
      const bucket = map.get(key) || [];
      bucket.push(tile);
      map.set(key, bucket);
    }
    for (const bucket of map.values()) bucket.sort((a, b) => a.order - b.order);
    return map;
  }, [tiles]);
  const getSurfaceItemsFast = useCallback((surfaceParentId: string | null | undefined) => (
    surfaceItemsByParent.get(surfaceKey(surfaceParentId)) || []
  ), [surfaceItemsByParent]);
  const surfaceCollisionDetection = useCallback<CollisionDetection>((args) => {
    const activeTile = itemById.get(String(args.active.id));
    const activeParentId = activeTile?.parentId || null;
    const filteredDroppableContainers = args.droppableContainers.filter((container) => {
      const candidate = itemById.get(String(container.id));
      return Boolean(candidate) && (candidate?.parentId || null) === activeParentId;
    });

    return closestCenter({
      ...args,
      droppableContainers: filteredDroppableContainers.length > 0
        ? filteredDroppableContainers
        : args.droppableContainers,
    });
  }, [itemById]);

  const surfaceTiles = useMemo(() => getSurfaceItemsFast(parentId), [getSurfaceItemsFast, parentId]);
  const currentFolder = useMemo(
    () => (parentId ? itemById.get(parentId) || null : null),
    [itemById, parentId]
  );
  const parentSurfaceId = currentFolder?.parentId || null;
  const folderOpenId = openFolderIds[level] || null;
  const folderOpen = useMemo(
    () => {
      const tile = folderOpenId ? itemById.get(folderOpenId) : null;
      return tile?.type === 'folder' ? tile : null;
    },
    [folderOpenId, itemById]
  );
  const activeTile = useMemo(
    () => (activeId ? itemById.get(activeId) || null : null),
    [activeId, itemById]
  );
  const renderedActiveId = sharedDragState?.activeId ?? activeId;
  const renderedActiveTile = sharedDragState?.activeTile ?? activeTile;
  const renderedDropIntent = sharedDragState?.dropIntent ?? dropIntent;
  const renderedPendingCreateTargetId = sharedDragState?.pendingCreateTargetId ?? pendingCreateTargetId;
  const renderedExitingFolderId = sharedDragState?.exitingFolderId ?? exitingFolderId;
  const isDndHost = sharedDragState === null;
  const isThisFolderExiting = Boolean(parentId && renderedExitingFolderId === parentId)
    || (!sharedDragState && isDraggingOutsideFolder);
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tile of tiles) {
      if (tile.parentId) counts.set(tile.parentId, (counts.get(tile.parentId) || 0) + 1);
    }
    return counts;
  }, [tiles]);
  const folderPreviewItems = useMemo(() => {
    const children = new Map<string, Tile[]>();
    for (const tile of tiles) {
      if (!tile.parentId) continue;
      const bucket = children.get(tile.parentId) || [];
      bucket.push(tile);
      children.set(tile.parentId, bucket);
    }
    for (const bucket of children.values()) {
      bucket.sort((a, b) => a.order - b.order);
    }
    return children;
  }, [tiles]);

  const getSurfaceLevelForParent = useCallback((surfaceParentId: string | null | undefined) => {
    if (!surfaceParentId) return 0;
    const openIndex = openFolderIds.indexOf(surfaceParentId);
    return openIndex >= 0 ? openIndex + 1 : 0;
  }, [openFolderIds]);

  const getDragSurfaceContext = useCallback((tileId: string | null | undefined) => {
    const tile = tileId ? itemById.get(tileId) || null : null;
    const surfaceParentId = tile?.parentId || null;
    const surfaceLevel = getSurfaceLevelForParent(surfaceParentId);
    return {
      tile,
      parentId: surfaceParentId,
      level: surfaceLevel,
      items: getSurfaceItemsFast(surfaceParentId),
    };
  }, [getSurfaceItemsFast, getSurfaceLevelForParent, itemById]);

  const getGeometryForLog = useCallback(() => (
    isTileDebugOverlayEnabled() ? getTileDebugGeometrySnapshot() : undefined
  ), []);

  const getStableTileRect = useCallback((tileId: string | null | undefined) => {
    if (!tileId) return null;
    return dragTileRects.current.get(tileId) || getTileDebugRect(tileId);
  }, []);

  const getTelemetryObject = useCallback((tileId: string | null | undefined) => {
    if (!tileId) return null;
    const includeRects = isTileDebugOverlayEnabled();
    const tile = itemById.get(tileId);
    if (!tile) return {
      id: tileId,
      fullId: tileId,
      missing: true,
      rect: includeRects ? getTileDebugRect(tileId) : undefined,
      stableRect: includeRects ? getStableTileRect(tileId) : undefined,
    };

    const surfaceParentId = tile.parentId || null;
    const siblings = getSurfaceItemsFast(surfaceParentId);
    return {
      ...(summarizeTile(tile) as Record<string, unknown>),
      parentId: surfaceParentId,
      level: getSurfaceLevelForParent(surfaceParentId),
      index: siblings.findIndex((item) => item.id === tile.id),
      rect: includeRects ? getTileDebugRect(tileId) : undefined,
      stableRect: includeRects ? getStableTileRect(tileId) : undefined,
    };
  }, [getStableTileRect, getSurfaceItemsFast, getSurfaceLevelForParent, itemById]);

  const getHoverDurationMs = useCallback((targetId?: string | null) => {
    if (!hoverStartedAt.current) return 0;
    if (targetId && hoverTargetId.current !== targetId) return 0;
    return roundMetric(performance.now() - hoverStartedAt.current);
  }, []);

  const getDragMode = useCallback(() => {
    if (draggingOutsideFolder.current || exitingFolderId) return 'EXTRACT_FROM_FOLDER_PENDING';
    if (activeDropIntent.current?.type === 'create-folder') return 'FOLDER_CREATE_ACTIVE';
    if (pendingDropIntent.current?.type === 'create-folder') return 'FOLDER_CREATE_PENDING';
    if (activeDropIntent.current?.type === 'move-to-folder') return 'MOVE_TO_FOLDER_ACTIVE';
    if (activeDragId.current) return 'DRAGGING';
    return 'IDLE';
  }, [exitingFolderId]);

  const getTelemetryContext = useCallback((point: Point | null, targetId?: string | null, extra?: Record<string, unknown>) => {
    const sourceId = activeDragId.current;
    const resolvedTargetId = targetId || currentOverId.current;
    return {
      sourceId,
      targetId: resolvedTargetId,
      source: getTelemetryObject(sourceId),
      target: getTelemetryObject(resolvedTargetId),
      hoverDurationMs: getHoverDurationMs(resolvedTargetId),
      requiredHoverMs: SURFACE_INTERACTION.folderCreateHoverDelayMs,
      cursor: point ? { ...point } : null,
      dragStartPoint: dragStartPoint.current ? { ...dragStartPoint.current } : null,
      cursorDeltaPx: getPointDistance(dragStartPoint.current, point),
      mode: getDragMode(),
      activeIntent: activeDropIntent.current ? { ...activeDropIntent.current } : null,
      pendingIntent: pendingDropIntent.current ? { ...pendingDropIntent.current } : null,
      pendingCreateTargetId,
      draggingOutsideFolder: draggingOutsideFolder.current,
      exitingFolderId,
      ...extra,
    };
  }, [
    exitingFolderId,
    getDragMode,
    getHoverDurationMs,
    getTelemetryObject,
    pendingCreateTargetId,
  ]);

  const logCurrentDragContext = useCallback((point: Point | null, targetId?: string | null, extra?: Record<string, unknown>) => {
    if (!isTileDebugEnabled()) return;
    logDragContext(getTelemetryContext(point, targetId, extra));
  }, [getTelemetryContext]);

  const transitionDragState = useCallback((
    to: string,
    point: Point | null,
    targetId: string | null | undefined,
    reason: string,
    extra?: Record<string, unknown>
  ) => {
    if (!isTileDebugEnabled()) return;
    const context = getTelemetryContext(point, targetId, extra);
    logDragStateChange({
      to,
      source: context.source,
      target: context.target,
      reason,
      context,
    });
  }, [getTelemetryContext]);

  const getDragFrameForLog = useCallback((point: Point | null, overTileId?: string | null) => {
    if (!isTileDebugEnabled()) return undefined;
    const activeIntent = activeDropIntent.current;
    const pendingIntent = pendingDropIntent.current;
    const resolvedOverId = overTileId || currentOverId.current;
    return {
      point: point ? { ...point } : null,
      activeId: activeDragId.current,
      overId: resolvedOverId,
      activeRect: getTileDebugRect(activeDragId.current),
      overRect: getTileDebugRect(resolvedOverId),
      stableActiveRect: getStableTileRect(activeDragId.current),
      stableOverRect: getStableTileRect(resolvedOverId),
      folderPanelRect: getElementDebugRect(folderPanelRef.current),
      surfaceRect: getElementDebugRect(tileSurfaceRef.current),
      activeIntent: activeIntent ? { ...activeIntent } : null,
      pendingIntent: pendingIntent ? { ...pendingIntent } : null,
      pendingCreateTargetId,
      draggingOutsideFolder: draggingOutsideFolder.current,
    };
  }, [getStableTileRect, pendingCreateTargetId]);

  const captureDragTileRects = useCallback(() => {
    const nextRects = new Map<string, DebugRect>();
    document.querySelectorAll<HTMLElement>('[data-tile-id]').forEach((element) => {
      const tileId = element.dataset.tileId;
      if (!tileId || nextRects.has(tileId)) return;
      const rect = getElementDebugRect(element);
      if (rect) nextRects.set(tileId, rect);
    });

    dragTileRects.current = nextRects;

    const nextFolderPanelRects = new Map<string, DebugRect>();
    document.querySelectorAll<HTMLElement>('[data-folder-panel]').forEach((element) => {
      const panelParentId = element.dataset.parentId;
      if (!panelParentId || nextFolderPanelRects.has(panelParentId)) return;
      const rect = getElementDebugRect(element);
      if (rect) nextFolderPanelRects.set(panelParentId, rect);
    });
    dragFolderPanelRects.current = nextFolderPanelRects;

    if (isTileDebugEnabled()) {
      logTileDebug('drag:rect-cache', {
        parentId: parentId || 'root',
        level,
        rects: Array.from(nextRects.entries()).map(([tileId, rect]) => ({ tileId, rect })),
        folderPanels: Array.from(nextFolderPanelRects.entries()).map(([panelParentId, rect]) => ({ panelParentId, rect })),
      });
    }
  }, [level, parentId]);

  const setTelemetryHoverTarget = useCallback((targetId: string | null, point: Point | null, reason: string) => {
    if (!targetId) {
      hoverTargetId.current = null;
      hoverStartedAt.current = null;
      return;
    }

    if (hoverTargetId.current === targetId) return;

    hoverTargetId.current = targetId;
    hoverStartedAt.current = performance.now();
    transitionDragState('HOVER_TILE', point, targetId, reason, {
      hoverStartedAt: hoverStartedAt.current,
    });
  }, [transitionDragState]);

  const suppressPostDragClick = useCallback(() => {
    suppressClickUntil.current = performance.now() + SURFACE_INTERACTION.postDragClickSuppressionMs;
  }, []);

  const handleClickCapture = useCallback((event: React.MouseEvent) => {
    if (performance.now() > suppressClickUntil.current) return;

    const target = event.target as HTMLElement;
    const tileElement = target.closest<HTMLElement>('[data-tile-id]');
    logTileDebug('click:suppressed', {
      parentId: parentId || 'root',
      level,
      tileId: tileElement?.dataset.tileId || null,
      point: {
        x: event.clientX,
        y: event.clientY,
      },
      geometry: getGeometryForLog(),
    });

    event.preventDefault();
    event.stopPropagation();
  }, [getGeometryForLog, level, parentId]);

  useEffect(() => {
    if (!isTileDebugEnabled()) return;
    logTileDebug('surface:tiles', {
      parentId: parentId || 'root',
      level,
      title,
      tiles: summarizeTileOrder(surfaceTiles),
      geometry: getGeometryForLog(),
    });
  }, [getGeometryForLog, level, parentId, surfaceTiles, title]);

  useEffect(() => {
    const nextOpenId = folderOpen?.id || null;
    if (!isTileDebugEnabled()) {
      previousFolderOpenId.current = nextOpenId;
      return;
    }
    if (previousFolderOpenId.current === nextOpenId) return;

    logTileDebug('folder:state', {
      parentId: parentId || 'root',
      level,
      status: nextOpenId ? 'opened' : 'closed',
      previousFolderId: previousFolderOpenId.current,
      folder: summarizeTile(folderOpen),
      geometry: getGeometryForLog(),
    });
    previousFolderOpenId.current = nextOpenId;
  }, [folderOpen, getGeometryForLog, level, parentId]);

  const clearDropIntent = useCallback(() => {
    const activeIntent = activeDropIntent.current;
    const pendingIntent = pendingDropIntent.current;
    const pendingCreateTarget = pendingCreateTargetId;
    if (activeIntent || pendingIntent || pendingCreateTarget || dropIntentTimer.current !== null) {
      logTileDebug('intent:clear', {
        parentId: parentId || 'root',
        level,
        activeIntent,
        pendingIntent,
        pendingCreateTargetId: pendingCreateTarget,
        hadTimer: dropIntentTimer.current !== null,
        dragFrame: getDragFrameForLog(currentDragPoint.current),
      });
    }

    if (dropIntentTimer.current !== null) {
      window.clearTimeout(dropIntentTimer.current);
      dropIntentTimer.current = null;
    }
    activeDropIntent.current = null;
    pendingDropIntent.current = null;
    centerIntentCandidate.current = null;
    folderCreatePendingStartedAt.current = null;
    setPendingCreateTargetId(null);
    setDropIntent(null);
  }, [getDragFrameForLog, level, parentId, pendingCreateTargetId]);

  const isCreateFolderHoverValid = useCallback((point: Point | null, targetId: string) => {
    const activeTileId = activeDragId.current;
    if (!activeTileId || currentOverId.current !== targetId) return false;

    const draggedTile = itemById.get(activeTileId);
    const targetTile = itemById.get(targetId);
    const activeRect = getStableTileRect(activeTileId);
    const targetRect = getStableTileRect(targetId);
    if (!canCreateFolderFromSites(draggedTile, targetTile)) return false;
    if (!isPointInsideRect(point, targetRect)) return false;
    return !hasCrossedReorderMidpoint(point, activeRect, targetRect);
  }, [getStableTileRect, itemById]);

  const getCreateFolderHoverIntent = useCallback((
    draggedTile: Tile | undefined,
    targetTile: Tile | undefined,
    targetId: string,
    point: Point | null
  ): Exclude<DropIntent, null> | null => {
    if (!canCreateFolderFromSites(draggedTile, targetTile)) return null;

    const activeRect = getStableTileRect(draggedTile?.id);
    const targetRect = getStableTileRect(targetId);
    if (!isPointInsideRect(point, targetRect)) return null;
    if (hasCrossedReorderMidpoint(point, activeRect, targetRect)) return null;

    return { type: 'create-folder', targetId };
  }, [getStableTileRect]);

  const isCenterIntentSettled = useCallback((intent: Exclude<DropIntent, null>, point: Point | null) => {
    const now = performance.now();
    const current = centerIntentCandidate.current;
    const sameCandidate = current?.type === intent.type && current.targetId === intent.targetId;
    const movedPx = sameCandidate ? getPointDistance(current.point, point) : null;

    if (!sameCandidate || (typeof movedPx === 'number' && movedPx > SURFACE_INTERACTION.centerIntentSettleMovementPx)) {
      centerIntentCandidate.current = {
        type: intent.type,
        targetId: intent.targetId,
        point: point ? { ...point } : null,
        startedAt: now,
      };
      return false;
    }

    return now - current.startedAt >= SURFACE_INTERACTION.centerIntentSettleDelayMs;
  }, []);

  const clearCenterIntentCandidate = useCallback((targetId?: string | null) => {
    if (!targetId || centerIntentCandidate.current?.targetId === targetId) {
      centerIntentCandidate.current = null;
    }
  }, []);

  const clearPendingCreateFolder = useCallback((reason: string, point: Point | null) => {
    const pendingIntent = pendingDropIntent.current;
    const pendingDurationMs = folderCreatePendingStartedAt.current
      ? roundMetric(performance.now() - folderCreatePendingStartedAt.current)
      : 0;
    if (dropIntentTimer.current !== null) {
      window.clearTimeout(dropIntentTimer.current);
      dropIntentTimer.current = null;
    }
    if (pendingIntent?.type !== 'create-folder' && !pendingCreateTargetId) return;

    logTileDebug('intent:hover:cancel', {
      parentId: parentId || 'root',
      level,
      reason,
      pendingIntent,
      pendingCreateTargetId,
      point,
      dragFrame: getDragFrameForLog(point, pendingIntent?.targetId || pendingCreateTargetId),
    });
    if (isTileDebugEnabled()) {
      logDragDecision('FOLDER_CREATE_CANCELLED', {
        reason,
        hoverDurationMs: getHoverDurationMs(pendingIntent?.targetId || pendingCreateTargetId),
        pendingDurationMs,
        requiredDurationMs: SURFACE_INTERACTION.folderCreateHoverDelayMs,
        context: getTelemetryContext(point, pendingIntent?.targetId || pendingCreateTargetId, {
          cancelReason: reason,
        }),
      });
    }
    transitionDragState(
      reason === 'reorder-threshold' || reason === 'reorder-midpoint'
        ? 'REORDER_PENDING'
        : 'DRAGGING',
      point,
      pendingIntent?.targetId || pendingCreateTargetId,
      reason,
      {
        hoverDurationMs: getHoverDurationMs(pendingIntent?.targetId || pendingCreateTargetId),
        pendingDurationMs,
      }
    );
    pendingDropIntent.current = null;
    clearCenterIntentCandidate(pendingIntent?.targetId || pendingCreateTargetId);
    folderCreatePendingStartedAt.current = null;
    setPendingCreateTargetId(null);
  }, [
    clearCenterIntentCandidate,
    getDragFrameForLog,
    getHoverDurationMs,
    getTelemetryContext,
    level,
    parentId,
    pendingCreateTargetId,
    transitionDragState,
  ]);

  const scheduleCreateFolderIntent = useCallback((nextIntent: Exclude<DropIntent, null>, point: Point | null) => {
    const sameActiveIntent = activeDropIntent.current?.type === nextIntent.type
      && activeDropIntent.current.targetId === nextIntent.targetId;
    if (sameActiveIntent) return;

    const samePendingIntent = pendingDropIntent.current?.type === nextIntent.type
      && pendingDropIntent.current.targetId === nextIntent.targetId
      && dropIntentTimer.current !== null;
    if (samePendingIntent) return;

    if (
      pendingDropIntent.current?.type === 'create-folder'
      && pendingDropIntent.current.targetId !== nextIntent.targetId
    ) {
      clearPendingCreateFolder('target-changed', point);
    }

    if (!isCreateFolderHoverValid(point, nextIntent.targetId)) {
      clearPendingCreateFolder('invalid-hover-zone', point);
      return;
    }

    if (dropIntentTimer.current !== null) {
      window.clearTimeout(dropIntentTimer.current);
      dropIntentTimer.current = null;
    }

    activeDropIntent.current = null;
    pendingDropIntent.current = nextIntent;
    folderCreatePendingStartedAt.current = performance.now();
    setDropIntent(null);
    setPendingCreateTargetId(nextIntent.targetId);
    transitionDragState('FOLDER_CREATE_PENDING', point, nextIntent.targetId, 'hover_timer_started', {
      requiredHoverMs: SURFACE_INTERACTION.folderCreateHoverDelayMs,
      hoverDurationMs: getHoverDurationMs(nextIntent.targetId),
    });
    logCurrentDragContext(point, nextIntent.targetId, {
      reason: 'folder_create_hover_started',
    });
    logTileDebug('intent:hover:start', {
      parentId: parentId || 'root',
      level,
      intent: nextIntent,
      hoverDelay: SURFACE_INTERACTION.folderCreateHoverDelayMs,
      point,
      dragFrame: getDragFrameForLog(point, nextIntent.targetId),
    });

    dropIntentTimer.current = window.setTimeout(() => {
      dropIntentTimer.current = null;
      const pendingIntent = pendingDropIntent.current;
      const currentPoint = currentDragPoint.current;
      if (
        pendingIntent?.type === 'create-folder'
        && pendingIntent.targetId === nextIntent.targetId
        && isCreateFolderHoverValid(currentPoint, pendingIntent.targetId)
      ) {
        activeDropIntent.current = pendingIntent;
        pendingDropIntent.current = null;
        const pendingDurationMs = folderCreatePendingStartedAt.current
          ? roundMetric(performance.now() - folderCreatePendingStartedAt.current)
          : SURFACE_INTERACTION.folderCreateHoverDelayMs;
        folderCreatePendingStartedAt.current = null;
        setPendingCreateTargetId(null);
        setDropIntent(pendingIntent);
        transitionDragState('FOLDER_CREATE_ACTIVE', currentPoint, pendingIntent.targetId, 'hover_duration_reached', {
          pendingDurationMs,
          requiredHoverMs: SURFACE_INTERACTION.folderCreateHoverDelayMs,
        });
        if (isTileDebugEnabled()) {
          logDragDecision('FOLDER_CREATE_PREVIEW_ACTIVE', {
            reason: 'hover_duration_reached',
            pendingDurationMs,
            requiredDurationMs: SURFACE_INTERACTION.folderCreateHoverDelayMs,
            context: getTelemetryContext(currentPoint, pendingIntent.targetId),
          });
        }
        logTileDebug('intent:activate', {
          parentId: parentId || 'root',
          level,
          intent: pendingIntent,
          immediate: false,
          hoverDelay: SURFACE_INTERACTION.folderCreateHoverDelayMs,
          dragFrame: getDragFrameForLog(currentPoint, pendingIntent.targetId),
        });
        return;
      }

      logTileDebug('intent:hover:cancel', {
        parentId: parentId || 'root',
        level,
        reason: 'hover-delay-expired-invalid',
        pendingIntent,
        point: currentPoint,
        dragFrame: getDragFrameForLog(currentPoint, nextIntent.targetId),
      });
      if (isTileDebugEnabled()) {
        logDragDecision('FOLDER_CREATE_CANCELLED', {
          reason: 'hover_delay_expired_invalid',
          hoverDurationMs: getHoverDurationMs(nextIntent.targetId),
          requiredDurationMs: SURFACE_INTERACTION.folderCreateHoverDelayMs,
          context: getTelemetryContext(currentPoint, nextIntent.targetId),
        });
      }
      transitionDragState('DRAGGING', currentPoint, nextIntent.targetId, 'hover_delay_expired_invalid');
      pendingDropIntent.current = null;
      folderCreatePendingStartedAt.current = null;
      setPendingCreateTargetId(null);
    }, SURFACE_INTERACTION.folderCreateHoverDelayMs);
  }, [
    clearPendingCreateFolder,
    clearCenterIntentCandidate,
    getDragFrameForLog,
    getHoverDurationMs,
    getTelemetryContext,
    isCreateFolderHoverValid,
    level,
    logCurrentDragContext,
    parentId,
    transitionDragState,
  ]);

  const activateDropIntent = useCallback((nextIntent: Exclude<DropIntent, null>) => {
    const sameActiveIntent = activeDropIntent.current?.type === nextIntent.type
      && activeDropIntent.current.targetId === nextIntent.targetId;
    if (sameActiveIntent && !pendingDropIntent.current) return;

    if (dropIntentTimer.current !== null) {
      window.clearTimeout(dropIntentTimer.current);
      dropIntentTimer.current = null;
    }

    activeDropIntent.current = nextIntent;
    pendingDropIntent.current = null;
    folderCreatePendingStartedAt.current = null;
    setPendingCreateTargetId(null);
    setDropIntent(nextIntent);
    transitionDragState(
      nextIntent.type === 'move-to-folder' ? 'MOVE_TO_FOLDER_ACTIVE' : 'FOLDER_CREATE_ACTIVE',
      currentDragPoint.current,
      nextIntent.targetId,
      nextIntent.type === 'move-to-folder' ? 'folder_center_zone' : 'intent_activated',
      {
        intent: nextIntent,
      }
    );
    logTileDebug('intent:activate', {
      parentId: parentId || 'root',
      level,
      intent: nextIntent,
      immediate: true,
      dragFrame: getDragFrameForLog(currentDragPoint.current, nextIntent.targetId),
    });
  }, [getDragFrameForLog, level, parentId, transitionDragState]);

  const setFolderExitIntent = useCallback((nextActive: boolean, point: Point | null) => {
    if (level === 0 || draggingOutsideFolder.current === nextActive) return;

    draggingOutsideFolder.current = nextActive;
    setIsDraggingOutsideFolder(nextActive);
    logTileDebug(nextActive ? 'drag:folder-exit:enter' : 'drag:folder-exit:leave', {
      parentId: parentId || 'root',
      destinationParentId: parentSurfaceId || 'root',
      level,
      point,
      dragFrame: getDragFrameForLog(point),
    });

    if (nextActive) clearDropIntent();
  }, [clearDropIntent, getDragFrameForLog, level, parentId, parentSurfaceId]);

  const updateFolderExitIntent = useCallback((point: Point | null) => {
    if (level === 0 || !dragStartPoint.current) return false;
    const cachedPanelRect = parentId ? dragFolderPanelRects.current.get(parentId) : null;
    const nextActive = isPointOutsideRect(
      point,
      cachedPanelRect || getElementDebugRect(folderPanelRef.current),
      SURFACE_INTERACTION.folderExitThreshold
    );
    setFolderExitIntent(nextActive, point);
    return nextActive;
  }, [level, parentId, setFolderExitIntent]);

  const handoffDragToParentSurface = useCallback((point: Point | null) => {
    const activeTileId = activeDragId.current;
    if (!activeTileId) return false;

    const sourceContext = getDragSurfaceContext(activeTileId);
    const sourceParentId = sourceContext.parentId;
    if (!sourceContext.tile || !sourceParentId) return false;
    if (handoffFolderIds.current.has(sourceParentId)) return false;

    const sourceFolderPanelRect = dragFolderPanelRects.current.get(sourceParentId);
    if (!sourceFolderPanelRect && isTileDebugEnabled()) {
      logTileDebug('drag:folder-exit:missing-panel-rect', {
        sourceParentId,
        point,
      });
    }
    const fallbackSourceFolderPanel = sourceFolderPanelRect ? null : getFolderPanelElement(sourceParentId);
    const resolvedSourceFolderPanelRect = sourceFolderPanelRect || getElementDebugRect(fallbackSourceFolderPanel);
    if (!isPointOutsideRect(point, resolvedSourceFolderPanelRect, SURFACE_INTERACTION.folderExitThreshold)) {
      return false;
    }

    const sourceCandidate = itemById.get(sourceParentId);
    const sourceFolder = sourceCandidate?.type === 'folder' ? sourceCandidate : null;
    const destinationParentId = sourceFolder?.parentId || null;
    const closeSurfaceLevel = Math.max(0, sourceContext.level - 1);

    handoffFolderIds.current.add(sourceParentId);
    setExitingFolderId(sourceParentId);
    setIsDraggingOutsideFolder(true);
    clearDropIntent();
    currentOverId.current = null;
    transitionDragState('EXTRACT_TO_PARENT', point, null, 'cursor_left_folder_panel', {
      fromParentId: sourceParentId,
      destinationParentId: destinationParentId || 'root',
      sourceLevel: sourceContext.level,
      closeSurfaceLevel,
    });
    if (isTileDebugEnabled()) {
      logDragDecision('EXTRACT_TO_PARENT', {
        reason: 'cursor_left_folder_panel',
        fromParentId: sourceParentId,
        destinationParentId: destinationParentId || 'root',
        context: getTelemetryContext(point, null, {
          sourceLevel: sourceContext.level,
          closeSurfaceLevel,
        }),
      });
    }

    logTileDebug('drag:folder-exit:handoff', {
      active: summarizeTile(sourceContext.tile),
      fromParentId: sourceParentId,
      destinationParentId: destinationParentId || 'root',
      sourceLevel: sourceContext.level,
      closeSurfaceLevel,
      point,
      dragFrame: getDragFrameForLog(point),
      folderPanelRect: resolvedSourceFolderPanelRect,
      geometry: getGeometryForLog(),
    });

    void moveTile(activeTileId, destinationParentId);
    closeFolderInStore(closeSurfaceLevel);
    window.setTimeout(() => {
      setExitingFolderId((current) => (current === sourceParentId ? null : current));
      setIsDraggingOutsideFolder(false);
    }, 180);

    return true;
  }, [
    clearDropIntent,
    closeFolderInStore,
    getDragFrameForLog,
    getDragSurfaceContext,
    getGeometryForLog,
    getTelemetryContext,
    moveTile,
    tiles,
    transitionDragState,
  ]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const nextActiveId = String(event.active.id);
    const sourceContext = getDragSurfaceContext(nextActiveId);
    setContextMenu(null);
    if (dropIntentTimer.current !== null) {
      window.clearTimeout(dropIntentTimer.current);
      dropIntentTimer.current = null;
    }
    activeDropIntent.current = null;
    pendingDropIntent.current = null;
    setDropIntent(null);
    setPendingCreateTargetId(null);
    setExitingFolderId(null);
    setActiveId(nextActiveId);
    activeDragId.current = nextActiveId;
    currentOverId.current = null;
    hoverTargetId.current = null;
    hoverStartedAt.current = null;
    folderCreatePendingStartedAt.current = null;
    lastDragOverDebugKey.current = null;
    dragStartPoint.current = getEventPoint(event.activatorEvent);
    currentDragPoint.current = dragStartPoint.current;
    draggingOutsideFolder.current = false;
    setIsDraggingOutsideFolder(false);
    handoffFolderIds.current.clear();
    lastDragMoveDebugAt.current = 0;
    captureDragTileRects();
    dispatchDndActive(true);
    if (isTileDebugEnabled()) {
      transitionDragState('DRAG_START', dragStartPoint.current, null, 'pointer_activation', {
        surfaceParentId: sourceContext.parentId || 'root',
        surfaceLevel: sourceContext.level,
        objectCount: sourceContext.items.length,
      });
      logCurrentDragContext(dragStartPoint.current, null, {
        reason: 'drag_start',
        objectCount: sourceContext.items.length,
      });

      logTileDebug('drag:start', {
        parentId: sourceContext.parentId || 'root',
        level: sourceContext.level,
        active: summarizeTile(sourceContext.tile),
        point: dragStartPoint.current,
        order: summarizeTileOrder(sourceContext.items),
        dragFrame: getDragFrameForLog(dragStartPoint.current),
        geometry: getGeometryForLog(),
      });
    }
  }, [
    captureDragTileRects,
    getDragFrameForLog,
    getDragSurfaceContext,
    getGeometryForLog,
    logCurrentDragContext,
    transitionDragState,
  ]);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const point = pointFromDragDelta(dragStartPoint.current, event.delta);
    currentDragPoint.current = point;

    if (handoffDragToParentSurface(point)) return;
    if (!isDndHost && level > 0) updateFolderExitIntent(point);
    if (draggingOutsideFolder.current) return;

    const activeTileId = activeDragId.current;
    const overTileId = currentOverId.current;
    if (!activeTileId || !overTileId || activeTileId === overTileId) return;

    const sourceContext = getDragSurfaceContext(activeTileId);
    const draggedTile = sourceContext.tile || undefined;
    const overTile = itemById.get(overTileId);
    const hasCreateIntent = activeDropIntent.current?.type === 'create-folder'
      && activeDropIntent.current.targetId === overTileId;
    const hasMoveIntent = activeDropIntent.current?.type === 'move-to-folder'
      && activeDropIntent.current.targetId === overTileId;
    const createHoverIntent = getCreateFolderHoverIntent(draggedTile, overTile, overTileId, point);

    if (createHoverIntent) {
      if (activeDropIntent.current?.targetId && activeDropIntent.current.targetId !== createHoverIntent.targetId) {
        clearDropIntent();
      }
      if (
        pendingDropIntent.current?.type === 'create-folder'
        && pendingDropIntent.current.targetId !== createHoverIntent.targetId
      ) {
        clearPendingCreateFolder('target-changed', point);
      }
      if (isCenterIntentSettled(createHoverIntent, point)) {
        scheduleCreateFolderIntent(createHoverIntent, point);
      }
      return;
    }

    const decision = resolveSurfaceInteraction({
      activeItem: draggedTile,
      targetItem: overTile,
      allItems: tiles,
      point,
      targetRect: getStableTileRect(overTileId),
      keepActiveIntent: hasMoveIntent,
    });

    if (decision.intent?.type === 'create-folder') {
      clearPendingCreateFolder(
        hasCrossedReorderMidpoint(point, getStableTileRect(activeTileId), getStableTileRect(overTileId))
          ? 'reorder-midpoint'
          : 'invalid-hover-zone',
        point
      );
      if (hasCreateIntent) clearDropIntent();
    } else if (decision.intent) {
      clearPendingCreateFolder('different-intent', point);
      if (activeDropIntent.current?.targetId && activeDropIntent.current.targetId !== decision.intent.targetId) {
        clearDropIntent();
      }
      if (isCenterIntentSettled(decision.intent, point)) {
        activateDropIntent(decision.intent);
      }
    } else if (hasCreateIntent || hasMoveIntent) {
      logTileDebug('intent:drop-zone:leave', {
        parentId: parentId || 'root',
        level,
        targetId: overTileId,
        zone: decision.zone,
        point,
        dragFrame: getDragFrameForLog(point, overTileId),
      });
      clearDropIntent();
    } else if (pendingDropIntent.current?.type === 'create-folder') {
      clearPendingCreateFolder(decision.zone === 'edge-zone' ? 'reorder-threshold' : 'target-left', point);
    } else {
      clearCenterIntentCandidate(overTileId);
    }
  }, [
    activateDropIntent,
    clearCenterIntentCandidate,
    clearPendingCreateFolder,
    clearDropIntent,
    getCreateFolderHoverIntent,
    getStableTileRect,
    getDragFrameForLog,
    getDragSurfaceContext,
    handoffDragToParentSurface,
    isCenterIntentSettled,
    isDndHost,
    level,
    logCurrentDragContext,
    parentId,
    scheduleCreateFolderIntent,
    tiles,
    updateFolderExitIntent,
  ]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    const point = pointFromDragDelta(dragStartPoint.current, event.delta);
    currentDragPoint.current = point;
    const sourceContext = getDragSurfaceContext(String(active.id));

    currentOverId.current = over ? String(over.id) : null;
    if (draggingOutsideFolder.current) {
      clearDropIntent();
      return;
    }

    if (!over || active.id === over.id) {
      setTelemetryHoverTarget(null, point, !over ? 'no_collision_target' : 'same_tile');
      const debugKey = `${active.id}->none`;
      if (isTileDebugEnabled() && lastDragOverDebugKey.current !== debugKey) {
        lastDragOverDebugKey.current = debugKey;
        logTileDebug('drag:over', {
          parentId: sourceContext.parentId || 'root',
          level: sourceContext.level,
          activeId: String(active.id),
          overId: over ? String(over.id) : null,
          candidate: 'none',
          point,
          dragFrame: getDragFrameForLog(point, over ? String(over.id) : null),
        });
      }
      clearDropIntent();
      return;
    }

    const draggedTile = sourceContext.tile || undefined;
    const overTile = itemById.get(String(over.id));
    setTelemetryHoverTarget(String(over.id), point, 'collision_target_changed');
    const hasActiveIntentForOver = activeDropIntent.current?.targetId === String(over.id);
    const createHoverIntent = getCreateFolderHoverIntent(draggedTile, overTile, String(over.id), point);
    const decision = resolveSurfaceInteraction({
      activeItem: draggedTile,
      targetItem: overTile,
      allItems: tiles,
      point,
      targetRect: getStableTileRect(String(over.id)),
      keepActiveIntent: hasActiveIntentForOver && activeDropIntent.current?.type !== 'create-folder',
    });
    const debugKey = `${active.id}->${over.id}:${decision.candidate}:${decision.zone}`;

    if (isTileDebugEnabled() && lastDragOverDebugKey.current !== debugKey) {
      lastDragOverDebugKey.current = debugKey;
      logTileDebug('drag:over', {
        parentId: sourceContext.parentId || 'root',
        level: sourceContext.level,
        active: summarizeTile(draggedTile),
        over: summarizeTile(overTile),
        candidate: decision.candidate,
        zone: decision.zone,
        canMoveIntoFolder: decision.canMoveIntoFolder,
        canCreateFolder: decision.canCreateFolder,
        isCenterZone: decision.isCenterZone,
        point,
        order: summarizeTileOrder(sourceContext.items),
        dragFrame: getDragFrameForLog(point, String(over.id)),
        geometry: getGeometryForLog(),
      });
      logDragDecision('DECISION', {
        source: getTelemetryObject(String(active.id)),
        target: getTelemetryObject(String(over.id)),
        candidate: decision.candidate,
        zone: decision.zone,
        canMoveIntoFolder: decision.canMoveIntoFolder,
        canCreateFolder: decision.canCreateFolder,
        isCenterZone: decision.isCenterZone,
        reason: createHoverIntent
          ? 'create_folder_hover_available'
          : decision.intent
            ? `${decision.intent.type}_zone`
            : 'reorder_available',
        context: getTelemetryContext(point, String(over.id), {
          candidate: decision.candidate,
          zone: decision.zone,
        }),
      });
      if (decision.candidate === 'reorder' && !pendingDropIntent.current) {
        transitionDragState('REORDER_PENDING', point, String(over.id), 'reorder_available', {
          zone: decision.zone,
          candidate: decision.candidate,
        });
      }
    }

    if (createHoverIntent) {
      if (activeDropIntent.current?.targetId && activeDropIntent.current.targetId !== createHoverIntent.targetId) {
        clearDropIntent();
      }
      if (
        pendingDropIntent.current?.type === 'create-folder'
        && pendingDropIntent.current.targetId !== createHoverIntent.targetId
      ) {
        clearPendingCreateFolder('target-changed', point);
      }
      if (isCenterIntentSettled(createHoverIntent, point)) {
        scheduleCreateFolderIntent(createHoverIntent, point);
      }
      return;
    }

    if (decision.intent?.type === 'create-folder') {
      clearPendingCreateFolder(
        hasCrossedReorderMidpoint(point, getStableTileRect(String(active.id)), getStableTileRect(String(over.id)))
          ? 'reorder-midpoint'
          : 'invalid-hover-zone',
        point
      );
      if (activeDropIntent.current?.type === 'create-folder') clearDropIntent();
      return;
    }

    if (decision.intent) {
      clearPendingCreateFolder('different-intent', point);
      if (activeDropIntent.current?.targetId && activeDropIntent.current.targetId !== decision.intent.targetId) {
        clearDropIntent();
      }
      if (isCenterIntentSettled(decision.intent, point)) {
        activateDropIntent(decision.intent);
      }
      return;
    }

    if (pendingDropIntent.current?.type === 'create-folder') {
      clearPendingCreateFolder(decision.zone === 'edge-zone' ? 'reorder-threshold' : 'target-left', point);
    }
    clearCenterIntentCandidate(String(over.id));
    clearDropIntent();
  }, [
    activateDropIntent,
    clearCenterIntentCandidate,
    clearPendingCreateFolder,
    clearDropIntent,
    getCreateFolderHoverIntent,
    getStableTileRect,
    getDragFrameForLog,
    getDragSurfaceContext,
    getTelemetryContext,
    getTelemetryObject,
    getGeometryForLog,
    isCenterIntentSettled,
    setTelemetryHoverTarget,
    scheduleCreateFolderIntent,
    tiles,
    transitionDragState,
  ]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    const pendingIntent = activeDropIntent.current;
    const pendingHoverIntent = pendingDropIntent.current;
    const endPoint = pointFromDragDelta(dragStartPoint.current, event.delta);
    const endOverId = over ? String(over.id) : null;
    const sourceContext = getDragSurfaceContext(String(active.id));
    const debugEnabled = isTileDebugEnabled();
    const endDragFrame = debugEnabled ? getDragFrameForLog(endPoint, endOverId) : undefined;
    const endGeometry = debugEnabled ? getGeometryForLog() : undefined;
    const sourceFolderPanelRect = sourceContext.parentId
      ? dragFolderPanelRects.current.get(sourceContext.parentId) || getElementDebugRect(getFolderPanelElement(sourceContext.parentId))
      : getElementDebugRect(folderPanelRef.current);
    const endedOutsideFolder = sourceContext.level > 0 && (
      draggingOutsideFolder.current
      || isPointOutsideRect(endPoint, sourceFolderPanelRect, SURFACE_INTERACTION.folderExitThreshold)
    );
    const endTelemetryContext = debugEnabled
      ? getTelemetryContext(endPoint, endOverId, {
          pendingIntent,
          pendingHoverIntent,
          endedOutsideFolder,
        })
      : null;
    const endCursorDeltaPx = getPointDistance(dragStartPoint.current, endPoint);
    const endSourceObject = debugEnabled ? getTelemetryObject(String(active.id)) : null;
    const endTargetObject = debugEnabled && endOverId ? getTelemetryObject(endOverId) : null;
    const logDropTransition = (to: string, reason: string, extra?: Record<string, unknown>) => {
      if (!debugEnabled) return;
      logDragStateChange({
        to,
        source: endSourceObject,
        target: endTargetObject,
        reason,
        context: {
          ...((endTelemetryContext as Record<string, unknown> | null) || {}),
          ...extra,
        },
      });
    };
    suppressPostDragClick();
    dispatchDndActive(false);
    clearDropIntent();
    setActiveId(null);
    setExitingFolderId(null);
    setIsDraggingOutsideFolder(false);
    draggingOutsideFolder.current = false;
    activeDragId.current = null;
    currentOverId.current = null;
    dragStartPoint.current = null;
    currentDragPoint.current = null;
    dragTileRects.current.clear();
    dragFolderPanelRects.current.clear();
    handoffFolderIds.current.clear();

    const draggedTile = sourceContext.tile || undefined;

    logTileDebug('drag:end', {
      parentId: sourceContext.parentId || 'root',
      level: sourceContext.level,
      activeId: String(active.id),
      overId: over ? String(over.id) : null,
      pendingIntent,
      pendingHoverIntent,
      endedOutsideFolder,
      endPoint,
      order: summarizeTileOrder(sourceContext.items),
      dragFrame: endDragFrame,
      geometry: endGeometry,
    });

    if (endedOutsideFolder && draggedTile) {
      const sourceCandidate = sourceContext.parentId ? itemById.get(sourceContext.parentId) : null;
      const sourceFolder = sourceCandidate?.type === 'folder' ? sourceCandidate : null;
      const destinationParentId = sourceFolder?.parentId || null;
      const closeSurfaceLevel = Math.max(0, sourceContext.level - 1);
      logDropTransition('EXTRACT_TO_PARENT_COMMIT', 'drop_outside_folder', {
        fromParentId: sourceContext.parentId || 'root',
        destinationParentId: destinationParentId || 'root',
        closeSurfaceLevel,
      });
      if (debugEnabled) {
        logDragDecision('EXTRACT_TO_PARENT_COMMIT', {
          reason: 'drop_outside_folder',
          fromParentId: sourceContext.parentId || 'root',
          destinationParentId: destinationParentId || 'root',
          context: endTelemetryContext,
        });
      }
      logTileDebug('drag:end:action', {
        action: 'move-out-of-folder',
        active: summarizeTile(draggedTile),
        fromParentId: sourceContext.parentId || 'root',
        destinationParentId: destinationParentId || 'root',
        closeSurfaceLevel,
        dragFrame: endDragFrame,
      });
      await moveTile(String(active.id), destinationParentId);
      closeFolderInStore(closeSurfaceLevel);
      logDropTransition('IDLE', 'drop_complete');
      return;
    }

    if (!over || active.id === over.id) {
      logDropTransition('DROP_NOOP', !over ? 'no_hover_target' : 'same_tile');
      logTileDebug('drag:end:no-op', {
        parentId: sourceContext.parentId || 'root',
        level: sourceContext.level,
        reason: !over ? 'no-over' : 'same-tile',
      });
      logDropTransition('IDLE', 'drop_complete');
      return;
    }

    const overTile = itemById.get(String(over.id));

    if (
      pendingHoverIntent?.type === 'create-folder'
      && overTile?.id === pendingHoverIntent.targetId
      && canCreateFolderFromSites(draggedTile, overTile)
    ) {
      logDropTransition('DROP_NOOP', 'release_before_folder_create_hover_completed', {
        pendingHoverIntent,
        hoverDurationMs: getHoverDurationMs(pendingHoverIntent.targetId),
        requiredDurationMs: SURFACE_INTERACTION.folderCreateHoverDelayMs,
      });
      if (debugEnabled) {
        logDragDecision('FOLDER_CREATE_CANCELLED', {
          reason: 'release_before_hover_duration',
          hoverDurationMs: getHoverDurationMs(pendingHoverIntent.targetId),
          requiredDurationMs: SURFACE_INTERACTION.folderCreateHoverDelayMs,
          context: endTelemetryContext,
        });
      }
      logTileDebug('drag:end:no-op', {
        parentId: sourceContext.parentId || 'root',
        level: sourceContext.level,
        reason: 'create-folder-hover-pending',
        pendingHoverIntent,
        dragFrame: endDragFrame,
      });
      logDropTransition('IDLE', 'drop_complete');
      return;
    }

    if (
      pendingIntent?.type === 'move-to-folder'
      && overTile?.id === pendingIntent.targetId
      && canMoveIntoFolder(draggedTile, overTile, tiles)
    ) {
      logDropTransition('MOVE_TO_FOLDER', 'drop_on_folder_center', {
        pendingIntent,
      });
      if (debugEnabled) {
        logDragDecision('MOVE_TO_FOLDER_EXECUTE', {
          reason: 'drop_on_folder_center',
          pendingIntent,
          context: endTelemetryContext,
        });
      }
      logTileDebug('drag:end:action', {
        action: 'move-to-folder',
        active: summarizeTile(draggedTile),
        over: summarizeTile(overTile),
        pendingIntent,
        dragFrame: endDragFrame,
      });
      moveTile(String(active.id), pendingIntent.targetId);
      logDropTransition('IDLE', 'drop_complete');
      return;
    }

    if (
      pendingIntent?.type === 'create-folder'
      && overTile?.id === pendingIntent.targetId
      && canCreateFolderFromSites(draggedTile, overTile)
    ) {
      logDropTransition('CREATE_FOLDER', 'drop_while_folder_preview_active', {
        pendingIntent,
      });
      if (debugEnabled) {
        logDragDecision('CREATE_FOLDER_EXECUTE', {
          reason: 'drop_while_folder_preview_active',
          pendingIntent,
          context: endTelemetryContext,
        });
      }
      logTileDebug('drag:end:action', {
        action: 'create-folder',
        active: summarizeTile(draggedTile),
        over: summarizeTile(overTile),
        pendingIntent,
        dragFrame: endDragFrame,
      });
      await createFolder(String(active.id), pendingIntent.targetId);
      logDropTransition('IDLE', 'drop_complete');
      return;
    }

    const reorderSurfaceItems = getSurfaceItemsFast(sourceContext.parentId);
    const oldIndex = reorderSurfaceItems.findIndex((tile) => tile.id === active.id);
    const newIndex = reorderSurfaceItems.findIndex((tile) => tile.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      logDropTransition('DROP_NOOP', 'missing_reorder_index', {
        oldIndex,
        newIndex,
      });
      logTileDebug('drag:end:missing-index', {
        activeId: String(active.id),
        overId: String(over.id),
        oldIndex,
        newIndex,
        dragFrame: endDragFrame,
      });
      logDropTransition('IDLE', 'drop_complete');
      return;
    }

    const reordered = [...reorderSurfaceItems];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    logTileDebug('drag:end:action', {
      action: 'reorder',
      active: summarizeTile(draggedTile),
      over: summarizeTile(overTile),
      oldIndex,
      newIndex,
      orderedIds: reordered.map((tile) => tile.id),
      dragFrame: endDragFrame,
    });
    logDropTransition('SWAP', 'reorder_drop', {
      oldIndex,
      newIndex,
      orderedIds: reordered.map((tile) => tile.id),
    });
    if (debugEnabled) {
      logDragDecision('SWAP_EXECUTE', {
        reason: 'reorder_drop',
        oldIndex,
        newIndex,
        cursorDeltaPx: endCursorDeltaPx,
        hoverDurationMs: getHoverDurationMs(endOverId),
        context: endTelemetryContext,
      });
    }
    reorderTiles(reordered.map((tile) => tile.id));
    logDropTransition('IDLE', 'drop_complete');
  }, [
    canCreateFolderFromSites,
    clearDropIntent,
    closeFolderInStore,
    createFolder,
    getDragFrameForLog,
    getDragSurfaceContext,
    getGeometryForLog,
    getHoverDurationMs,
    getSurfaceItems,
    getTelemetryContext,
    getTelemetryObject,
    moveTile,
    reorderTiles,
    suppressPostDragClick,
    tiles,
  ]);

  const handleDragCancel = useCallback(() => {
    const cancelPoint = currentDragPoint.current;
    const cancelTargetId = currentOverId.current;
    transitionDragState('DRAG_CANCELLED', cancelPoint, cancelTargetId, 'dnd_cancelled');
    if (isTileDebugEnabled()) {
      logDragDecision('DRAG_CANCELLED', {
        reason: 'dnd_cancelled',
        context: getTelemetryContext(cancelPoint, cancelTargetId),
      });
    }
    logTileDebug('drag:cancel', {
      parentId: parentId || 'root',
      level,
      activeId,
      dragFrame: getDragFrameForLog(currentDragPoint.current),
      geometry: getGeometryForLog(),
    });
    suppressPostDragClick();
    dispatchDndActive(false);
    clearDropIntent();
    setActiveId(null);
    setExitingFolderId(null);
    setIsDraggingOutsideFolder(false);
    draggingOutsideFolder.current = false;
    activeDragId.current = null;
    currentOverId.current = null;
    hoverTargetId.current = null;
    hoverStartedAt.current = null;
    folderCreatePendingStartedAt.current = null;
    dragStartPoint.current = null;
    currentDragPoint.current = null;
    dragTileRects.current.clear();
    dragFolderPanelRects.current.clear();
    handoffFolderIds.current.clear();
    if (isTileDebugEnabled()) {
      logDragStateChange({
        to: 'IDLE',
        reason: 'cancel_complete',
        context: getTelemetryContext(null, null),
      });
    }
  }, [
    activeId,
    clearDropIntent,
    getDragFrameForLog,
    getGeometryForLog,
    getTelemetryContext,
    level,
    parentId,
    suppressPostDragClick,
    transitionDragState,
  ]);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    if (event.ctrlKey || event.altKey) return;

    const target = event.target as HTMLElement;
    const tileEl = target.closest('[data-tile-id]');
    if (
      target.closest('.context-menu')
      || (!tileEl && (target.closest('button') || target.closest('input') || target.closest('a')))
    ) return;

    event.preventDefault();
    event.stopPropagation();
    logTileDebug('context-menu:open', {
      parentId: parentId || 'root',
      level,
      point: {
        x: event.clientX,
        y: event.clientY,
      },
      button: event.button,
      buttons: event.buttons,
      tileId: tileEl?.getAttribute('data-tile-id') || null,
      geometry: getGeometryForLog(),
    });
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      tileId: tileEl?.getAttribute('data-tile-id') || undefined,
    });
  }, [getGeometryForLog, level, parentId]);

  useEffect(() => {
    if (!isTileDebugEnabled()) return;
    logTileDebug('context-menu:state', {
      parentId: parentId || 'root',
      level,
      status: contextMenu ? 'opened' : 'closed',
      contextMenu,
      geometry: getGeometryForLog(),
    });
  }, [contextMenu, getGeometryForLog, level, parentId]);

  const requestOpenFolder = useCallback((tile: Tile) => {
    const originRect = getTileDebugRect(tile.id);
    setFolderOpenOriginRect(originRect);
    logTileDebug('folder:open:request', {
      reason: 'tile-click',
      parentId: parentId || 'root',
      level,
      folder: summarizeTile(tile),
      folderRect: originRect,
      geometry: getGeometryForLog(),
    });
    openFolderInStore(tile.id, level);
  }, [getGeometryForLog, level, openFolderInStore, parentId]);

  const closeOpenFolder = useCallback((reason: string) => {
    logTileDebug('folder:collapse:request', {
      reason,
      parentId: parentId || 'root',
      level,
      folder: summarizeTile(folderOpen),
      geometry: getGeometryForLog(),
    });
    closeFolderInStore(level);
  }, [closeFolderInStore, folderOpen, getGeometryForLog, level, parentId]);

  const requestCloseSelf = useCallback((reason: string) => {
    if (isClosingFolder) return;
    const targetRect = parentId ? getTileDebugRect(parentId) : null;
    setClosingOriginRect(targetRect || openOriginRect || null);
    setIsClosingFolder(true);
    logTileDebug('folder:self-close:request', {
      reason,
      parentId: parentId || 'root',
      level,
      folder: summarizeTile(currentFolder),
      folderPanelRect: getElementDebugRect(folderPanelRef.current),
      targetRect: targetRect || openOriginRect || null,
      geometry: getGeometryForLog(),
    });
    if (folderCloseTimer.current !== null) window.clearTimeout(folderCloseTimer.current);
    folderCloseTimer.current = window.setTimeout(() => {
      folderCloseTimer.current = null;
      onClose?.();
    }, FOLDER_TRANSITION_MS);
  }, [currentFolder, getGeometryForLog, isClosingFolder, level, onClose, openOriginRect, parentId]);

  const isFolderSurface = Boolean(parentId);
  const isFolderListView = isFolderSurface && settings.folderViewMode === 'list';
  const effectiveColumns = isFolderListView
    ? 1
    : isFolderSurface
      ? config.folderColumns || config.columns
      : config.columns;

  const gridStyle = useMemo(() => ({
    display: 'grid',
    gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, 1fr))`,
    gap: `var(--fasp-grid-spacing, ${config.spacing}px)`,
    padding: `var(--fasp-grid-spacing, ${config.spacing}px)`,
    maxWidth: isFolderListView ? '760px' : level === 0 ? '1400px' : '100%',
    margin: '0 auto',
  }), [config.spacing, effectiveColumns, isFolderListView, level]);
  const isFolderCreatePreviewActive = renderedDropIntent?.type === 'create-folder';
  const preferFaviconOnlyDuringDrag = Boolean(renderedActiveId);
  const sortingStrategy = (renderedDropIntent || renderedPendingCreateTargetId)
    ? lockedSortingStrategy
    : rectSortingStrategy;
  const contextMenuTileId = contextMenu?.tileId;
  const shouldUseContextMenuFocus = Boolean(contextMenu)
    && settings.contextMenuFocusMode !== 'off'
    && (
      settings.contextMenuFocusMode === 'always'
      || (settings.contextMenuFocusMode === 'folder-only' && isFolderSurface)
    );
  const folderAnimationOrigin = isClosingFolder
    ? closingOriginRect || openOriginRect || null
    : openOriginRect || null;
  const folderAnimationStyle = getFolderAnimationStyle(folderAnimationOrigin);

  // Arrow keys move focus across the grid of this surface (including the
  // trailing add button); Enter/Space activation lives on the tile wrapper.
  const handleSurfaceArrowNav = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const { key } = event;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') return;
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains('sortable-tile') && target.dataset.testid !== 'add-tile-button') return;

    const grid = tileSurfaceRef.current?.querySelector(':scope > .tile-grid');
    if (!grid) return;
    const items = Array.from(
      grid.querySelectorAll<HTMLElement>(':scope > .sortable-tile, :scope > [data-testid="add-tile-button"]')
    );
    const index = items.indexOf(target);
    if (index === -1) return;

    let next = index;
    if (key === 'ArrowLeft') next = index - 1;
    else if (key === 'ArrowRight') next = index + 1;
    else if (key === 'ArrowUp') next = index - effectiveColumns;
    else next = index + effectiveColumns;

    if (next < 0 || next >= items.length || next === index) return;
    event.preventDefault();
    items[next].focus();
  };

  const surface = (
    <div
      ref={tileSurfaceRef}
      className={`tile-surface ${folderOpen ? 'tile-surface-folder-depth' : ''} ${contextMenu ? 'tile-surface-context-menu-open' : ''} ${shouldUseContextMenuFocus ? 'tile-surface-context-menu-focus' : ''}`}
      data-tile-surface
      data-testid={parentId ? 'tile-surface-folder' : 'tile-surface-root'}
      data-parent-id={parentId || 'root'}
      data-level={level}
      data-folder-title={title || ''}
      onClickCapture={handleClickCapture}
      onContextMenu={handleContextMenu}
      onKeyDown={handleSurfaceArrowNav}
    >
      {level === 0 && !parentId && !tilesLoading && surfaceTiles.length === 0 && (
        <section className="tile-surface-onboarding glass-strong" data-testid="onboarding-panel">
          <h2>Добро пожаловать в Adaptive Start Page</h2>
          <p>
            Здесь будут ваши плитки: сайты, папки и закладки. Начните с одного из действий,
            а часы, поиск и погоду можно включить в настройках (шестерёнка справа сверху).
          </p>
          <div className="tile-surface-onboarding-actions">
            <button
              type="button"
              data-testid="onboarding-add-site"
              onClick={() => {
                setAddDialogEntryMode('site');
                setShowAddDialog(true);
              }}
            >
              Добавить первый сайт
            </button>
            <button
              type="button"
              data-testid="onboarding-import-bookmarks"
              onClick={() => {
                setAddDialogEntryMode('bookmark-folder');
                setShowAddDialog(true);
              }}
            >
              Импортировать папку закладок
            </button>
          </div>
        </section>
      )}

      <SortableContext items={surfaceTiles.map((tile) => tile.id)} strategy={sortingStrategy}>
          <div
            style={gridStyle}
            className={`tile-grid ${isFolderSurface ? 'tile-grid-folder' : ''} ${isFolderListView ? 'tile-grid-folder-list' : 'tile-grid-folder-grid'}`}
            data-folder-view={isFolderSurface ? settings.folderViewMode : undefined}
          >
            {surfaceTiles.map((tile) => (
              <SortableTile
                key={tile.id}
                tile={tile}
                childCount={childCounts.get(tile.id) || 0}
                folderPreviewItems={(folderPreviewItems.get(tile.id) || []).slice(0, 4)}
                isDragging={renderedActiveId === tile.id}
                isFolderDropTarget={renderedDropIntent?.type === 'move-to-folder' && renderedDropIntent.targetId === tile.id}
                isFolderCreateTarget={renderedDropIntent?.type === 'create-folder' && renderedDropIntent.targetId === tile.id}
                folderCreatePartner={renderedDropIntent?.type === 'create-folder' && renderedDropIntent.targetId === tile.id ? renderedActiveTile : null}
                preferFaviconOnly={preferFaviconOnlyDuringDrag || isFolderListView}
                suppressLayoutTransform={Boolean(renderedDropIntent || renderedPendingCreateTargetId)}
                isContextMenuDimmed={shouldUseContextMenuFocus && contextMenuTileId !== tile.id}
                isContextMenuTarget={shouldUseContextMenuFocus && contextMenuTileId === tile.id}
                onOpenFolder={requestOpenFolder}
              />
            ))}
            <button
              data-testid="add-tile-button"
              className="
                tile-card add-tile-button aspect-square rounded-2xl
                flex flex-col items-center justify-center gap-1
                transition-all duration-300 group
              "
              onClick={() => setShowAddDialog(true)}
              title="Добавить плитку"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                className="add-tile-icon transition-all duration-300 group-hover:scale-110">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="add-tile-label transition-colors duration-300">Добавить</span>
            </button>
          </div>
        </SortableContext>

      {showAddDialog && (
        <Suspense fallback={null}>
          <AddTileModal
            parentId={parentId}
            initialEntryMode={addDialogEntryMode}
            onClose={() => {
              setShowAddDialog(false);
              setAddDialogEntryMode('site');
            }}
          />
        </Suspense>
      )}

      {contextMenu && (
        <Suspense fallback={null}>
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            tileId={contextMenu.tileId}
            parentId={parentId}
            onOpenFolder={requestOpenFolder}
            onClose={() => setContextMenu(null)}
          />
        </Suspense>
      )}
    </div>
  );

  const folderOverlay = folderOpen ? (
    <TileSurface
      parentId={folderOpen.id}
      title={folderOpen.title}
      level={level + 1}
      openOriginRect={folderOpenOriginRect}
      onClose={() => closeOpenFolder('child-request')}
    />
  ) : null;

  const dragContextValue = useMemo<SharedTileDragState>(() => ({
    activeId,
    activeTile,
    dropIntent,
    pendingCreateTargetId,
    exitingFolderId,
  }), [activeId, activeTile, dropIntent, exitingFolderId, pendingCreateTargetId]);

  const dragOverlay = (
    <DragOverlay
      dropAnimation={{
        duration: SURFACE_INTERACTION.dropAnimationDurationMs,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {activeTile ? (
        <div className={`drag-overlay-tile ${isFolderCreatePreviewActive ? 'folder-create-active' : ''}`}>
          <TileCard
            tile={activeTile}
            childCount={childCounts.get(activeTile.id) || 0}
            folderPreviewItems={(folderPreviewItems.get(activeTile.id) || []).slice(0, 4)}
            isDragging
            preferFaviconOnly
          />
        </div>
      ) : null}
    </DragOverlay>
  );

  const withDndHost = (content: React.ReactNode) => {
    if (!isDndHost) return content;

    return (
      <SharedTileDragContext.Provider value={dragContextValue}>
        <DndContext
          sensors={sensors}
          collisionDetection={surfaceCollisionDetection}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {content}
          {dragOverlay}
          <TileDebugOverlay enabled={debugOverlayEnabled} />
        </DndContext>
      </SharedTileDragContext.Provider>
    );
  };

  if (level === 0) {
    return (
      <div className="tile-grid-root relative z-10 px-4 pb-8">
        {withDndHost(
          <>
            {surface}
            {folderOverlay}
          </>
        )}
      </div>
    );
  }

  const folderSurface = (
    <div
      ref={overlayRef}
      data-folder-overlay
      data-parent-id={parentId || 'root'}
      data-level={level}
      data-folder-title={title || ''}
      data-folder-state="opened"
      data-dragging-out={isThisFolderExiting ? 'true' : 'false'}
      style={folderAnimationStyle}
      className={`folder-overlay-depth fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm ${isClosingFolder ? 'folder-overlay-closing' : 'folder-overlay-opening'} ${isThisFolderExiting ? 'folder-overlay-exit-active' : ''}`}
      onClick={(event) => {
        if (event.target === overlayRef.current) requestCloseSelf('backdrop');
      }}
    >
      {renderedActiveId && (
        <div className={`folder-exit-cue ${isThisFolderExiting ? 'folder-exit-cue-active' : ''}`} aria-hidden="true">
          <div className="folder-exit-pill">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 15V5" />
              <path d="M5.5 9.5 10 5l4.5 4.5" />
              <path d="M4 16h12" />
            </svg>
            <span>На уровень выше</span>
          </div>
        </div>
      )}

      <div
        ref={folderPanelRef}
        data-folder-panel
        data-parent-id={parentId || 'root'}
        data-level={level}
        data-folder-title={title || ''}
        data-folder-state="opened"
        data-dragging-out={isThisFolderExiting ? 'true' : 'false'}
        className={`folder-panel glass-strong flex max-h-[82vh] w-[90vw] max-w-5xl flex-col overflow-hidden rounded-2xl shadow-2xl ${isThisFolderExiting ? 'folder-panel-dragging-out' : ''}`}
      >
        <div className="folder-panel-header flex shrink-0 items-center justify-between border-b border-white/5 px-8 py-4">
          <h3 className="folder-panel-title truncate pl-1 text-lg font-semibold text-white/80">{title}</h3>
          <button
            onClick={() => requestCloseSelf('button')}
            className="folder-panel-close rounded-lg p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white/80"
            aria-label="Закрыть папку"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {surface}
        </div>
      </div>

      {folderOverlay}
    </div>
  );

  return withDndHost(folderSurface);
}
