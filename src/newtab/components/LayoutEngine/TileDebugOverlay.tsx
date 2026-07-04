import { useEffect, useState } from 'react';
import {
  getDragTelemetrySnapshot,
  getTileDebugGeometrySnapshot,
} from '../../../debug/tileDebug';

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

export function TileDebugOverlay({ enabled }: { enabled: boolean }) {
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
