import type { Tile } from '../../../types';
import { TileSurface } from '../LayoutEngine/TileSurface';

interface TileFolderProps {
  tile: Tile;
  onClose: () => void;
}

export function TileFolder({ tile, onClose }: TileFolderProps) {
  return (
    <TileSurface
      parentId={tile.id}
      title={tile.title}
      level={1}
      onClose={onClose}
    />
  );
}
