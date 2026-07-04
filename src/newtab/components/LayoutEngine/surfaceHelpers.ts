import { createContext } from 'react';
import type { CSSProperties } from 'react';
import type { SortingStrategy } from '@dnd-kit/sortable';
import type { Tile } from '../../../types';
import type { Point, RectLike, SurfaceDropIntent } from '../../engines/surfaceInteractionEngine';
import type { DebugRect } from '../../../debug/tileDebug';

export type DropIntent = SurfaceDropIntent | null;

export const lockedSortingStrategy: SortingStrategy = () => null;
export const FOLDER_TRANSITION_MS = 320;
export const DND_ACTIVE_EVENT = 'fasp-dnd-active-change';

export interface SharedTileDragState {
  activeId: string | null;
  activeTile: Tile | null;
  dropIntent: DropIntent;
  pendingCreateTargetId: string | null;
  exitingFolderId: string | null;
}

export const SharedTileDragContext = createContext<SharedTileDragState | null>(null);

export function getEventPoint(event: Event): Point | null {
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

export function pointFromDragDelta(startPoint: Point | null, delta: { x: number; y: number }): Point | null {
  if (!startPoint) return null;
  return {
    x: startPoint.x + delta.x,
    y: startPoint.y + delta.y,
  };
}

export function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getPointDistance(a: Point | null, b: Point | null): number | null {
  if (!a || !b) return null;
  return roundMetric(Math.hypot(a.x - b.x, a.y - b.y));
}

export function getFolderAnimationStyle(originRect: DebugRect | null | undefined): CSSProperties {
  const fallbackX = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
  const fallbackY = typeof window !== 'undefined' ? window.innerHeight / 2 : 0;
  const originX = originRect?.center.x ?? fallbackX;
  const originY = originRect?.center.y ?? fallbackY;

  return {
    '--folder-origin-x': `${originX}px`,
    '--folder-origin-y': `${originY}px`,
  } as CSSProperties;
}

export function surfaceKey(parentId: string | null | undefined): string {
  return parentId || 'root';
}

export function dispatchDndActive(active: boolean): void {
  if (typeof window === 'undefined') return;
  document.documentElement.classList.toggle('fasp-dnd-active', active);
  window.dispatchEvent(new CustomEvent(DND_ACTIVE_EVENT, { detail: { active } }));
}

export function getFolderPanelElement(parentId: string): HTMLElement | null {
  const panels = document.querySelectorAll<HTMLElement>('[data-folder-panel]');
  return Array.from(panels).find((panel) => panel.dataset.parentId === parentId) || null;
}

export function isPointInsideRect(point: Point | null, rect: RectLike | null | undefined): boolean {
  if (!point || !rect) return false;
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

export function hasCrossedReorderMidpoint(
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
