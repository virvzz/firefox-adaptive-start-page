import type { Tile } from '../../types';

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export interface PredominantTileColor {
  color: string;
  source: 'surface' | 'root' | 'fallback';
  count: number;
}

export function parseTileHexColor(value: string | null | undefined): string | null {
  const source = typeof value === 'string' && value.trim() ? value.trim() : '';
  const match = source.match(HEX_COLOR_RE);
  if (!match) return null;
  const raw = match[1].length === 3
    ? match[1].split('').map((char) => char + char).join('')
    : match[1];
  return `#${raw.toLowerCase()}`;
}

export function normalizeTileHexColor(value: string | null | undefined, fallback = '#8b5cf6'): string {
  const source = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return parseTileHexColor(source) || fallback;
}

export function getTileDisplayColor(tile: Pick<Tile, 'tileAccentColor' | 'dominantColor'> | undefined): string | null {
  if (!tile) return null;
  if (tile.tileAccentColor) return normalizeTileHexColor(tile.tileAccentColor);
  if (tile.dominantColor) return normalizeTileHexColor(tile.dominantColor);
  return null;
}

export function formatTileHexColor(value: string | null | undefined, fallback = '#8b5cf6'): string {
  return normalizeTileHexColor(value, fallback).toUpperCase();
}

function sameParent(tile: Tile, parentId: string | null): boolean {
  return parentId ? tile.parentId === parentId : !tile.parentId;
}

function findUniquePredominantColor(tiles: Tile[]): { color: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    const color = getTileDisplayColor(tile);
    if (!color) continue;
    counts.set(color, (counts.get(color) || 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  const [color, count] = ranked[0];
  const secondCount = ranked[1]?.[1] || 0;
  if (count < 2 || count === secondCount) return null;
  return { color, count };
}

export function getPredominantTileColor(
  tiles: Tile[],
  parentId: string | null | undefined,
  fallback: string
): PredominantTileColor {
  const normalizedParentId = parentId || null;
  const fallbackColor = normalizeTileHexColor(fallback);
  const surfaceMatch = findUniquePredominantColor(tiles.filter((tile) => sameParent(tile, normalizedParentId)));
  if (surfaceMatch) return { ...surfaceMatch, source: 'surface' };

  if (normalizedParentId) {
    const rootMatch = findUniquePredominantColor(tiles.filter((tile) => sameParent(tile, null)));
    if (rootMatch) return { ...rootMatch, source: 'root' };
  }

  return { color: fallbackColor, source: 'fallback', count: 0 };
}
