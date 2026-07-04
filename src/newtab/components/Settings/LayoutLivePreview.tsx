import type { CSSProperties } from 'react';
import type { AppSettings, LayoutConfig, ThemeDefinition } from '../../../types';

export function LayoutLivePreview({
  layout,
  settings,
  theme,
}: {
  layout: LayoutConfig;
  settings: AppSettings;
  theme: ThemeDefinition;
}) {
  const rootColumns = Math.min(Math.max(layout.columns, 2), 12);
  const folderColumns = Math.min(Math.max(layout.folderColumns || layout.columns, 2), 12);
  const rootItems = Array.from({ length: rootColumns });
  const folderItems = Array.from({ length: settings.folderViewMode === 'list' ? 2 : folderColumns });
  const previewGap = Math.max(4, Math.min(theme.layout.spacing, 10));
  const tileRadius = Math.min(theme.tiles.radius, 34);
  const tileOpacity = theme.tiles.opacity;
  const showThumbnail = settings.tileVisualMode !== 'favicon';
  const showFavicon = settings.tileVisualMode !== 'thumbnail';
  const compactLabels = settings.tileLabelMode === 'compact';
  const contextFocusEnabled = settings.contextMenuFocusMode !== 'off';
  const rootGridDense = rootColumns > 8;
  const folderGridDense = settings.folderViewMode !== 'list' && folderColumns > 8;

  const tileStyle = {
    '--layout-preview-radius': `${tileRadius}px`,
    '--layout-preview-opacity': String(tileOpacity),
    '--layout-preview-opacity-percent': `${Math.round(tileOpacity * 100)}%`,
  } as CSSProperties;

  const renderTile = (index: number, isFolder = false) => {
    const isClone = index % 4 === 2;
    const title = isFolder
      ? (settings.folderViewMode === 'list' ? 'Документы и ссылки' : 'Папка')
      : (compactLabels ? 'Очень длинное название сайта' : 'Сайт');

    return (
      <div
        key={`${isFolder ? 'folder' : 'root'}-${index}`}
        className={`layout-preview-tile ${isFolder ? 'layout-preview-folder' : 'layout-preview-page'} ${isClone ? 'layout-preview-clone' : 'layout-preview-reference'} layout-preview-${settings.tileVisualMode} ${compactLabels ? 'layout-preview-compact-label' : 'layout-preview-full-label'}`}
        style={tileStyle}
      >
        {isFolder ? (
          <>
            {settings.showFolderModeBadge && (
              <span className="layout-preview-mode-badge">
                {isClone ? 'CLONE' : 'REF'}
              </span>
            )}
            {settings.showFolderItemCount && (
              <span className="layout-preview-count-badge">
                {isClone ? 6 : 12}
              </span>
            )}
            <div className="layout-preview-folder-grid">
              {Array.from({ length: 4 }).map((_, cellIndex) => (
                <span key={cellIndex}>{cellIndex === 1 ? 'G' : cellIndex === 2 ? 'Y' : ''}</span>
              ))}
            </div>
          </>
        ) : (
          <>
            {showThumbnail && (
              <div className="layout-preview-thumbnail">
                <span />
                <span />
                <span />
              </div>
            )}
            {showFavicon && (
              <span className={settings.tileVisualMode === 'mixed' ? 'layout-preview-favicon-badge' : 'layout-preview-icon'}>
                {index % 3 === 0 ? 'F' : 'S'}
              </span>
            )}
          </>
        )}
        <span className="layout-preview-title">{title}</span>
      </div>
    );
  };

  return (
    <aside className="layout-live-preview-panel">
      <div className="theme-live-preview-header">
        <div>
          <h3>Живая демонстрация</h3>
          <p>Показывает, как выбранные настройки будут выглядеть на странице.</p>
        </div>
        <span>
          {settings.folderViewMode === 'list' ? 'Список' : 'Сетка'}
        </span>
      </div>

      <div className="layout-live-stage">
        <section className="layout-live-section">
          <div className="layout-live-section-title">
            <strong>Главная</strong>
            <span>{layout.columns} в ряду</span>
          </div>
          <div
            className={`layout-live-grid ${rootGridDense ? 'layout-live-grid-dense' : ''}`}
            style={{
              gap: `${previewGap}px`,
              gridTemplateColumns: `repeat(${rootColumns}, minmax(0, 1fr))`,
            }}
          >
            {rootItems.map((_, index) => renderTile(index, index % 5 === 1 || index % 5 === 4))}
          </div>
        </section>

        <section className="layout-live-section layout-live-folder-section">
          <div className="layout-live-section-title">
            <strong>Открытая папка</strong>
            <span>{settings.folderViewMode === 'list' ? 'список' : `${layout.folderColumns || layout.columns} в ряду`}</span>
          </div>
          <div
            className={`layout-live-folder ${settings.folderViewMode === 'list' ? 'layout-live-folder-list' : 'layout-live-folder-grid'} ${folderGridDense ? 'layout-live-grid-dense' : ''}`}
            style={{
              gap: `${Math.min(previewGap, 14)}px`,
              gridTemplateColumns: settings.folderViewMode === 'list' ? '1fr' : `repeat(${folderColumns}, minmax(0, 1fr))`,
            }}
          >
            {folderItems.map((_, index) => renderTile(index, index % 4 === 1))}
          </div>
        </section>

        <section className={`layout-live-context-demo ${contextFocusEnabled ? 'layout-live-context-demo-active' : ''}`}>
          <div className="layout-live-section-title">
            <strong>ПКМ-фокус</strong>
            <span>
              {settings.contextMenuFocusMode === 'folder-only'
                ? 'только папки'
                : settings.contextMenuFocusMode === 'always'
                  ? 'везде'
                  : 'выключен'}
            </span>
          </div>
          <div className="layout-live-context-row">
            <div className="layout-live-context-tiles">
              <i />
              <i />
              <i />
            </div>
            <div className="layout-live-context-menu">
              <span>Открыть</span>
              <span>Изменить цвет</span>
              <span>Удалить</span>
            </div>
          </div>
        </section>
      </div>

      <div className="theme-live-metrics layout-live-metrics">
        <div>
          <span>Страницы</span>
          <strong>{settings.tileVisualMode === 'thumbnail' ? 'Эскизы' : settings.tileVisualMode === 'favicon' ? 'Иконка сайта' : 'Смешано'}</strong>
        </div>
        <div>
          <span>Подписи</span>
          <strong>{compactLabels ? '2 строки' : 'Полные'}</strong>
        </div>
        <div>
          <span>Радиус</span>
          <strong>{theme.tiles.radius}px</strong>
        </div>
      </div>
    </aside>
  );
}
