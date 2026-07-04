import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Tile } from '../../../types';
import {
  getFaviconUrl,
  getScreenshotThumbnailFallbackUrl,
  getScreenshotThumbnailUrl,
} from '../../../engines/tileAppearance';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { useMediaAssetUrl } from '../../hooks/useMediaAssetUrl';
import { getContainerColor, openUrlFromStartPage } from '../../containers/firefoxContainers';

interface TileCardProps {
  tile: Tile;
  childCount?: number;
  isDragging?: boolean;
  isFolderDropTarget?: boolean;
  isFolderCreateTarget?: boolean;
  folderCreatePartner?: Tile | null;
  folderPreviewItems?: Tile[];
  preferFaviconOnly?: boolean;
  onOpenFolder?: (tile: Tile) => void;
}

interface TitleTooltipPosition {
  left: number;
  top: number;
  placement: 'above' | 'below';
}

const TITLE_TOOLTIP_DELAY_MS = 1000;
const TITLE_TOOLTIP_EDGE_PADDING = 12;
const TITLE_TOOLTIP_MAX_WIDTH = 360;

function getInitial(hostOrTitle: string): string {
  return (hostOrTitle.trim()[0] || '?').toUpperCase();
}

export const TileCard = memo(function TileCard({
  tile,
  childCount = 0,
  isDragging,
  isFolderDropTarget,
  isFolderCreateTarget,
  folderCreatePartner,
  folderPreviewItems = [],
  preferFaviconOnly = false,
  onOpenFolder,
}: TileCardProps) {
  const [previewIndex, setPreviewIndex] = useState(0);
  const [titleTooltip, setTitleTooltip] = useState<TitleTooltipPosition | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleTooltipTimerRef = useRef<number | null>(null);
  const { settings } = useSettingsStore();
  const { runtimeTheme } = useThemeStore();

  useEffect(() => {
    setPreviewIndex(0);
  }, [tile.customImage, tile.customImageAssetId, tile.thumbnail, tile.url]);

  const cancelTitleTooltipTimer = useCallback(() => {
    if (titleTooltipTimerRef.current !== null) {
      window.clearTimeout(titleTooltipTimerRef.current);
      titleTooltipTimerRef.current = null;
    }
  }, []);

  const hideTitleTooltip = useCallback(() => {
    cancelTitleTooltipTimer();
    setTitleTooltip(null);
  }, [cancelTitleTooltipTimer]);

  const showTitleTooltip = useCallback(() => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect || isDragging || !tile.title.trim()) return;

    const maxWidth = Math.min(TITLE_TOOLTIP_MAX_WIDTH, window.innerWidth - TITLE_TOOLTIP_EDGE_PADDING * 2);
    const halfWidth = Math.max(0, maxWidth / 2);
    const center = rect.left + rect.width / 2;
    const left = Math.min(
      Math.max(center, TITLE_TOOLTIP_EDGE_PADDING + halfWidth),
      window.innerWidth - TITLE_TOOLTIP_EDGE_PADDING - halfWidth
    );
    const placement = rect.bottom + 58 < window.innerHeight ? 'below' : 'above';
    const top = placement === 'below'
      ? rect.bottom + 10
      : Math.max(TITLE_TOOLTIP_EDGE_PADDING, rect.top - 10);

    setTitleTooltip({ left, top, placement });
  }, [isDragging, tile.title]);

  const scheduleTitleTooltip = useCallback(() => {
    cancelTitleTooltipTimer();
    if (!tile.title.trim()) return;
    titleTooltipTimerRef.current = window.setTimeout(() => {
      titleTooltipTimerRef.current = null;
      showTitleTooltip();
    }, TITLE_TOOLTIP_DELAY_MS);
  }, [cancelTitleTooltipTimer, showTitleTooltip, tile.title]);

  useEffect(() => () => {
    cancelTitleTooltipTimer();
  }, [cancelTitleTooltipTimer]);

  useEffect(() => {
    if (isDragging) hideTitleTooltip();
  }, [hideTitleTooltip, isDragging]);

  useEffect(() => {
    if (!titleTooltip) return undefined;

    const handleViewportChange = () => hideTitleTooltip();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [hideTitleTooltip, titleTooltip]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    hideTitleTooltip();
    if (isDragging) return;

    if (tile.type === 'folder' && onOpenFolder) {
      e.preventDefault();
      onOpenFolder(tile);
    } else if (tile.url) {
      void openUrlFromStartPage(tile.url, settings.tileOpenTarget, tile.containerCookieStoreId);
    }
  }, [hideTitleTooltip, tile, isDragging, onOpenFolder, settings.tileOpenTarget]);

  const borderRadius = tile.borderRadius !== undefined
    ? `${tile.borderRadius}px`
    : `var(--fasp-tile-radius, ${settings.borderRadiusDefault}px)`;
  const opacity = tile.opacity !== undefined
    ? tile.opacity
    : `var(--fasp-tile-opacity, ${settings.tileOpacityDefault})`;
  const glass = runtimeTheme.glass.enabled && (tile.glassmorphism ?? true);
  const customImageAssetUrl = useMediaAssetUrl(tile.customImageAssetId);

  const previewCandidates = useMemo(() => {
    if (tile.customImage) return [tile.customImage];
    if (customImageAssetUrl) return [customImageAssetUrl];
    if (tile.dominantColor) return [];
    if (!tile.url) return [];

    return [
      tile.thumbnail,
      getScreenshotThumbnailUrl(tile.url),
      getScreenshotThumbnailFallbackUrl(tile.url),
    ].filter((src): src is string => Boolean(src));
  }, [customImageAssetUrl, tile.customImage, tile.dominantColor, tile.thumbnail, tile.url]);

  const tileVisualMode = settings.tileVisualMode || 'mixed';
  const tileAccentColor = tile.tileAccentColor;
  const containerBadgeColor = getContainerColor(tile.containerColor);
  const shouldUsePreview = !preferFaviconOnly && tileVisualMode !== 'favicon';
  const previewSrc = shouldUsePreview ? previewCandidates[previewIndex] : undefined;
  const faviconSrc = tile.favicon || (tile.url ? getFaviconUrl(tile.url) : '');
  const partnerFaviconSrc = folderCreatePartner?.favicon
    || (folderCreatePartner?.url ? getFaviconUrl(folderCreatePartner.url) : '');
  const hasPreview = Boolean(previewSrc);
  const folderPreview = tile.type === 'folder' ? folderPreviewItems.slice(0, 4) : [];
  const folderMode = tile.type === 'folder' ? tile.bookmarkMode : undefined;
  const folderModeLabel = folderMode === 'reference' ? 'REF' : folderMode === 'clone' ? 'CLONE' : null;
  const showFaviconBadge = hasPreview && faviconSrc && tileVisualMode === 'mixed';
  const tileLabelMode = settings.tileLabelMode || 'compact';

  const bgStyle = !hasPreview && (tileAccentColor || tile.dominantColor)
    ? {
        background: tileAccentColor
          ? `linear-gradient(135deg, color-mix(in srgb, ${tileAccentColor} 34%, rgba(255,255,255,0.05)), color-mix(in srgb, ${tileAccentColor} 62%, rgba(7,10,20,0.22)))`
          : `linear-gradient(135deg, ${tile.dominantColor}22, ${tile.dominantColor}44)`,
      }
    : {};

  const handlePreviewError = useCallback(() => {
    setPreviewIndex((index) => Math.min(index + 1, previewCandidates.length));
  }, [previewCandidates.length]);

  return (
    <div
      ref={cardRef}
      data-testid="tile-card"
      data-tile-id={tile.id}
      data-tile-type={tile.type}
      data-tile-parent-id={tile.parentId || 'root'}
      data-tile-order={tile.order}
      data-tile-title={tile.title}
      data-folder-mode={folderMode || undefined}
      data-tile-pinned={tile.pinnedAt ? 'true' : undefined}
      className={`tile-card relative flex flex-col items-center justify-center cursor-pointer select-none overflow-hidden
        ${glass ? 'glass' : 'bg-white/5 border border-white/10'}
        ${tile.pinnedAt ? 'tile-pinned' : ''}
        ${tile.type === 'folder' ? 'folder-tile' : ''}
        ${folderMode === 'reference' ? 'folder-tile-reference' : ''}
        ${folderMode === 'clone' ? 'folder-tile-clone' : ''}
        tile-label-${tileLabelMode}
        tile-visual-${tileVisualMode}
        ${hasPreview ? 'tile-card-with-preview' : ''}
        ${tileAccentColor ? 'tile-card-accented' : ''}
        ${isDragging ? 'dragging' : ''}
        ${isFolderDropTarget ? 'folder-drop-target' : ''}
        ${isFolderCreateTarget ? 'folder-create-target' : ''}`}
      style={{
        opacity: isDragging ? 0.5 : opacity,
        borderRadius,
        aspectRatio: '1',
        '--tile-accent-color': tileAccentColor || 'transparent',
        ...bgStyle,
      } as CSSProperties & { '--tile-accent-color': string }}
      onClick={handleClick}
      onPointerEnter={scheduleTitleTooltip}
      onPointerLeave={hideTitleTooltip}
      onPointerDown={hideTitleTooltip}
      onContextMenu={hideTitleTooltip}
      onAuxClick={(e) => {
        hideTitleTooltip();
        if (e.button === 1 && tile.url) {
          e.preventDefault();
          void openUrlFromStartPage(tile.url, 'new-tab', tile.containerCookieStoreId);
        }
      }}
    >
      {hasPreview && (
        <>
          <img
            src={previewSrc}
            alt={tile.title}
            className="tile-preview absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={handlePreviewError}
          />
          <div className="tile-preview-shade absolute inset-0 rounded-[inherit]" />
        </>
      )}

      {tileAccentColor && (
        <div className="tile-accent-wash absolute inset-0 rounded-[inherit]" aria-hidden="true" />
      )}

      {tile.type === 'folder' && !hasPreview && folderPreview.length > 0 && (
        <div
          className="folder-preview-grid relative z-10"
          data-preview-count={Math.min(folderPreview.length, 4)}
        >
          {folderPreview.map((child) => {
            const childFavicon = child.favicon || (child.url ? getFaviconUrl(child.url) : '');
            return (
              <span
                key={child.id}
                className={`folder-preview-cell ${child.type === 'folder' ? 'folder-preview-cell-folder' : ''}`}
                data-child-type={child.type}
              >
                {childFavicon ? (
                  <img
                    src={childFavicon}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : getInitial(child.title)}
              </span>
            );
          })}
        </div>
      )}

      {tile.type === 'folder' && !hasPreview && folderPreview.length === 0 && (
        <div className="folder-preview-empty relative z-10" aria-hidden="true" />
      )}

      {tile.type !== 'folder' && !hasPreview && (
        <div className="tile-main-icon relative z-10 mb-2 flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.07] text-lg font-semibold text-white/75">
          {faviconSrc ? (
            <img
              src={faviconSrc}
              alt=""
              className="h-8 w-8 object-contain"
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : getInitial(tile.title)}
        </div>
      )}

      {showFaviconBadge && (
        <div className="tile-favicon-badge absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg border border-white/20 bg-black/35 backdrop-blur-md">
          <img
            src={faviconSrc}
            alt=""
            className="h-5 w-5 object-contain"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      )}

      {folderModeLabel && settings.showFolderModeBadge && (
        <span className="folder-mode-badge absolute left-2 top-2 z-20" data-folder-mode={folderMode}>
          {folderModeLabel}
        </span>
      )}

      {tile.pinnedAt && (
        <span className="tile-pin-badge absolute right-2 top-2 z-20" aria-label="Закреплено" title="Закреплено">
          <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M12.76 2.35a1 1 0 00-1.52 1.3l.55.64-4.5 4.5-1.13-.3a1.4 1.4 0 00-1.35.37L3.7 9.97a1 1 0 00.24 1.6l3.14 1.57-3.37 3.37a1 1 0 101.42 1.42l3.37-3.37 1.57 3.14a1 1 0 001.6.24l1.11-1.11c.35-.35.49-.86.37-1.35l-.3-1.13 4.5-4.5.64.55a1 1 0 001.3-1.52l-6.53-6.53z" />
          </svg>
        </span>
      )}

      {tile.type === 'tile' && tile.containerCookieStoreId && (
        <span
          className={`tile-container-badge absolute ${tile.pinnedAt ? 'right-7' : 'right-2'} top-2 z-20`}
          title={tile.containerName ? `Контейнер: ${tile.containerName}` : 'Открывается в контейнере Firefox'}
          aria-label={tile.containerName ? `Контейнер: ${tile.containerName}` : 'Открывается в контейнере Firefox'}
          style={{ background: containerBadgeColor, color: containerBadgeColor }}
        />
      )}

      {isFolderCreateTarget && (
        <div className="folder-create-hint absolute inset-0 z-20 flex items-center justify-center rounded-[inherit]">
          <div className="folder-create-preview-shell" aria-hidden="true">
            <div className="folder-create-preview-tab" />
            <div className="folder-create-preview-grid">
              <span className="folder-create-preview-icon">
                {faviconSrc ? (
                  <img src={faviconSrc} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                ) : getInitial(tile.title)}
              </span>
              <span className="folder-create-preview-icon folder-create-preview-icon-incoming">
                {partnerFaviconSrc ? (
                  <img src={partnerFaviconSrc} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                ) : getInitial(folderCreatePartner?.title || tile.title)}
              </span>
            </div>
          </div>
          <div className="folder-create-chip">
            <span className="folder-create-icon" aria-hidden="true">
              <span />
              <span />
            </span>
            <span>Папка</span>
          </div>
        </div>
      )}

      <span className={`${hasPreview ? 'tile-title-preview' : 'tile-title'} ${tile.type === 'folder' ? 'folder-title' : ''} relative z-10 text-center font-medium leading-tight text-white/85`}>
        {tile.title}
      </span>

      {tile.type === 'folder' && childCount > 0 && settings.showFolderItemCount && (
        <span className={`folder-child-count-badge absolute z-10 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] text-white/60 ${tile.pinnedAt ? 'folder-child-count-with-pin' : ''}`}>
          {childCount}
        </span>
      )}

      {titleTooltip && typeof document !== 'undefined' && createPortal(
        <div
          className={`tile-title-tooltip tile-title-tooltip-${titleTooltip.placement}`}
          role="tooltip"
          style={{ left: titleTooltip.left, top: titleTooltip.top }}
        >
          {tile.title}
        </div>,
        document.body
      )}
    </div>
  );
});
