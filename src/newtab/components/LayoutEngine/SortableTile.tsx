import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Tile } from '../../../types';
import { TileCard } from '../Tile/TileCard';
import { SURFACE_INTERACTION } from '../../engines/surfaceInteractionEngine';

export function SortableTile({
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
