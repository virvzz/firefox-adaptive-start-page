export const ROOT_CONTAINER_ID = 'root';
export const GRID_SCHEMA_VERSION = 3;

export type ContainerId = string;
export type GridItemId = string;
export type SurfaceParentId = string | null;
export type GridItemType = 'tile' | 'folder';
export type GridItemSource = 'manual' | 'bookmark' | 'top-site';
export type BookmarkFolderMode = 'reference' | 'clone';
export type TileVisualMode = 'favicon' | 'thumbnail' | 'mixed';
export type TileLabelMode = 'full' | 'compact';
export type FolderViewMode = 'grid' | 'list';
export type ContextMenuFocusMode = 'folder-only' | 'always' | 'off';
export type TileOpenTarget = 'current-tab' | 'new-tab' | 'new-window';

export interface GridItemBase {
  id: GridItemId;
  type: GridItemType;
  title: string;
  url?: string;
  customIcon?: string;
  // Best-effort local cache for URL-derived favicons. Manual icons use customIcon.
  favicon?: string;
  previewImage?: string;
  thumbnail?: string;
  customImage?: string;
  customImageAssetId?: string;
  dominantColor?: string;
  tileAccentColor?: string;
  containerCookieStoreId?: string;
  containerName?: string;
  containerColor?: string;
  themeColors?: {
    primary: string;
    secondary: string;
    text: string;
  };
  source?: GridItemSource;
  bookmarkId?: string;
  bookmarkMode?: BookmarkFolderMode;
  pinnedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface LinkTile extends GridItemBase {
  type: 'tile';
  url: string;
  glassmorphism?: boolean;
  borderRadius?: number;
  opacity?: number;

  /**
   * View-only compatibility fields. The source of truth for hierarchy and
   * ordering is AppState.containers[*].childrenIds.
   */
  parentId?: string;
  order: number;
}

export interface Folder extends GridItemBase {
  type: 'folder';
  childrenIds: GridItemId[];
  glassmorphism?: boolean;
  borderRadius?: number;
  opacity?: number;

  /**
   * View-only compatibility fields. The source of truth for hierarchy and
   * ordering is AppState.containers[*].childrenIds.
   */
  parentId?: string;
  order: number;
}

export type GridItem = LinkTile | Folder;

// Backward-compatible alias for existing UI components that treat folders as
// tile-like grid objects.
export type Tile = GridItem;

export interface Container {
  id: ContainerId;
  title: string;
  childrenIds: GridItemId[];
  parentId?: ContainerId;
  createdAt: number;
  updatedAt: number;
}

export type DragIntentType =
  | 'idle'
  | 'reorder'
  | 'create-folder'
  | 'move-between-containers'
  | 'extract-from-folder';

export type DragMachineState =
  | 'idle'
  | 'pressing'
  | 'dragging'
  | 'hovering-target'
  | 'drop';

export interface DragState {
  state: DragMachineState;
  intent: DragIntentType;
  activeId?: GridItemId;
  sourceContainerId?: ContainerId;
  targetId?: GridItemId;
  targetContainerId?: ContainerId;
}

export interface AppState {
  items: Record<GridItemId, GridItem>;
  containers: Record<ContainerId, Container>;
  rootContainerId: ContainerId;
  currentContainerId: ContainerId;
  containerStack: ContainerId[];
  dragState: DragState | null;
}

export interface PersistedState {
  schemaVersion: number;
  state: AppState;
}

export interface LayoutConfig {
  columns: number;           // 2-12
  folderColumns?: number;    // 2-12
  spacing: number;           // px
  tileWidth?: number;        // calculated
  tileHeight?: number;       // calculated
}

export interface BackgroundConfig {
  mode: 'generative' | 'static' | 'wallpaper';
  generativeType?: 'perlin' | 'particles' | 'fractal-flow' | 'aurora' | 'plasma' | 'julia' | 'automata' | 'reaction-diffusion';
  animationEnabled: boolean;
  fpsLimit: number;
  staticImage?: string;      // runtime url / legacy base64 url
  staticImageAssetId?: string;
  blur: number;
  brightness: number;
  // wallpaper mode settings (future)
  wallpaperCategory?: string;
  wallpaperUpdateInterval?: number;
}

export interface AppSettings {
  borderRadiusDefault: number;
  tileOpacityDefault: number;
  showSearchBar: boolean;
  showClock: boolean;
  showWeather: boolean;
  weatherLocation: string;
  weatherDisplayMode: 'inline' | 'card';
  showPerformanceMonitor: boolean;
  infoCardTransparency: number;
  showPopularTabsButton: boolean;
  showRecentlyClosedTabsButton: boolean;
  optimizeMediaAssets: boolean;
  adaptiveControlContrast: boolean;
  externalPreviewsEnabled: boolean;
  searchBarWidth: number; // % of window width
  searchResultLimit: number;
  bookmarkFolderMode: BookmarkFolderMode;
  showFolderItemCount: boolean;
  showFolderModeBadge: boolean;
  tileVisualMode: TileVisualMode;
  tileLabelMode: TileLabelMode;
  folderViewMode: FolderViewMode;
  contextMenuFocusMode: ContextMenuFocusMode;
  tileOpenTarget: TileOpenTarget;
}

export type ThemeShadowPreset = 'none' | 'soft' | 'deep' | 'floating';
export type ThemeBackgroundStyle = 'current' | 'gradient' | 'generative' | 'static';
export type ThemeAnimationSpeed = 'reduced' | 'normal' | 'expressive';

export interface ThemeDefinition {
  schemaVersion: 1;
  engineVersion: string;
  id: string;
  name: string;
  colors: {
    accent: string;
    accent2: string;
    text: string;
    mutedText: string;
    surface: string;
    surfaceStrong: string;
    border: string;
    danger: string;
  };
  glass: {
    enabled: boolean;
    blur: number;
    opacity: number;
    saturation: number;
  };
  tiles: {
    radius: number;
    opacity: number;
    shadow: ThemeShadowPreset;
    hoverScale: number;
  };
  layout: {
    spacing: number;
  };
  background: {
    style: ThemeBackgroundStyle;
    gradient?: string;
    staticImageAssetId?: string;
    generatedType?: NonNullable<BackgroundConfig['generativeType']>;
  };
  animation: {
    speed: ThemeAnimationSpeed;
  };
  font: {
    family: 'system';
  };
}

export interface ContextMenuState {
  x: number;
  y: number;
  tileId?: string;
}
