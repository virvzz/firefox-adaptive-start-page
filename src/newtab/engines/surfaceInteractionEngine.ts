import type { SurfaceParentId, Tile } from '../../types';

export interface Point {
  x: number;
  y: number;
}

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export type SurfaceZone = 'center-zone' | 'edge-zone' | 'outside';
export type SurfaceDropIntentType = 'create-folder' | 'move-to-folder';
export type SurfaceInteractionCandidate = SurfaceDropIntentType | 'reorder' | 'none';

export interface SurfaceDropIntent {
  type: SurfaceDropIntentType;
  targetId: string;
}

export interface SurfaceInteractionDecision {
  candidate: SurfaceInteractionCandidate;
  zone: SurfaceZone;
  intent: SurfaceDropIntent | null;
  canCreateFolder: boolean;
  canMoveIntoFolder: boolean;
  isCenterZone: boolean;
}

export const SURFACE_INTERACTION = {
  pointerActivationDistance: 6,
  folderExitThreshold: 18,
  centerZoneInsetRatio: 0.18,
  activeCenterZoneInsetRatio: 0.1,
  centerIntentSettleDelayMs: 120,
  centerIntentSettleMovementPx: 8,
  folderCreateHoverDelayMs: 300,
  postDragClickSuppressionMs: 450,
  layoutTransformDurationMs: 420,
  dropAnimationDurationMs: 260,
};

export function normalizeParentId(parentId: SurfaceParentId | undefined): SurfaceParentId {
  return parentId || null;
}

export function parentDebugId(parentId: SurfaceParentId | undefined): string {
  return normalizeParentId(parentId) || 'root';
}

export function isSameSurface(a: SurfaceParentId | undefined, b: SurfaceParentId | undefined): boolean {
  return normalizeParentId(a) === normalizeParentId(b);
}

export function isDescendantOf(itemId: string, ancestorId: string, items: Tile[]): boolean {
  let current = items.find((item) => item.id === itemId);
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = items.find((item) => item.id === current?.parentId);
  }
  return false;
}

export function getSurfaceItems(items: Tile[], parentId: SurfaceParentId): Tile[] {
  return items
    .filter((item) => isSameSurface(item.parentId, parentId))
    .sort((a, b) => a.order - b.order);
}

export function isPointOutsideRect(point: Point | null, rect: RectLike | null | undefined, threshold = 0): boolean {
  if (!point || !rect) return false;
  return (
    point.x < rect.left - threshold
    || point.x > rect.right + threshold
    || point.y < rect.top - threshold
    || point.y > rect.bottom + threshold
  );
}

export function isPointInCenterZone(
  point: Point | null,
  rect: RectLike | null | undefined,
  keepActiveIntent = false
): boolean {
  if (!point || !rect) return false;
  const insetRatio = keepActiveIntent
    ? SURFACE_INTERACTION.activeCenterZoneInsetRatio
    : SURFACE_INTERACTION.centerZoneInsetRatio;
  const insetX = rect.width * insetRatio;
  const insetY = rect.height * insetRatio;

  return (
    point.x >= rect.left + insetX
    && point.x <= rect.right - insetX
    && point.y >= rect.top + insetY
    && point.y <= rect.bottom - insetY
  );
}

export function canMoveIntoFolder(activeItem: Tile | undefined, targetItem: Tile | undefined, items: Tile[]): boolean {
  if (!activeItem || !targetItem || targetItem.type !== 'folder') return false;
  if (activeItem.id === targetItem.id) return false;
  if (activeItem.type === 'folder' && isDescendantOf(targetItem.id, activeItem.id, items)) return false;
  return true;
}

export function canCreateFolderFromSites(activeItem: Tile | undefined, targetItem: Tile | undefined): boolean {
  if (!activeItem || !targetItem) return false;
  if (activeItem.id === targetItem.id) return false;
  if (activeItem.type !== 'tile' || targetItem.type !== 'tile') return false;
  return isSameSurface(activeItem.parentId, targetItem.parentId);
}

export function resolveSurfaceInteraction({
  activeItem,
  targetItem,
  allItems,
  point,
  targetRect,
  keepActiveIntent = false,
}: {
  activeItem: Tile | undefined;
  targetItem: Tile | undefined;
  allItems: Tile[];
  point: Point | null;
  targetRect: RectLike | null | undefined;
  keepActiveIntent?: boolean;
}): SurfaceInteractionDecision {
  if (!activeItem || !targetItem || activeItem.id === targetItem.id) {
    return {
      candidate: 'none',
      zone: 'outside',
      intent: null,
      canCreateFolder: false,
      canMoveIntoFolder: false,
      isCenterZone: false,
    };
  }

  const isCenterZone = isPointInCenterZone(point, targetRect, keepActiveIntent);
  const canMove = canMoveIntoFolder(activeItem, targetItem, allItems);
  const canCreate = canCreateFolderFromSites(activeItem, targetItem);

  if (isCenterZone && canMove) {
    return {
      candidate: 'move-to-folder',
      zone: 'center-zone',
      intent: { type: 'move-to-folder', targetId: targetItem.id },
      canCreateFolder: canCreate,
      canMoveIntoFolder: canMove,
      isCenterZone,
    };
  }

  if (isCenterZone && canCreate) {
    return {
      candidate: 'create-folder',
      zone: 'center-zone',
      intent: { type: 'create-folder', targetId: targetItem.id },
      canCreateFolder: canCreate,
      canMoveIntoFolder: canMove,
      isCenterZone,
    };
  }

  return {
    candidate: 'reorder',
    zone: 'edge-zone',
    intent: null,
    canCreateFolder: canCreate,
    canMoveIntoFolder: canMove,
    isCenterZone,
  };
}
