import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTileStore, type BookmarkFolderOption } from '../../stores/tilesStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { createThemeColorSwatches, normalizeThemeAccentColor } from '../../ui/themeColors';
import { getScreenshotThumbnailUrl } from '../../../engines/tileAppearance';
import {
  getContainerColor,
  listFirefoxContainers,
  type FirefoxContainer,
} from '../../containers/firefoxContainers';

interface AddTileModalProps {
  onClose: () => void;
  parentId?: string | null;
  initialEntryMode?: 'site' | 'bookmark-folder';
}

export function AddTileModal({ onClose, parentId = null, initialEntryMode = 'site' }: AddTileModalProps) {
  const { addTile, tiles, listBookmarkFolders, addBookmarkFolder } = useTileStore();
  const { settings } = useSettingsStore();
  const { runtimeTheme } = useThemeStore();
  const themeAccent = normalizeThemeAccentColor(runtimeTheme.colors.accent);
  const colorSwatches = createThemeColorSwatches(themeAccent);
  const [entryMode, setEntryMode] = useState<'site' | 'bookmark-folder'>(initialEntryMode);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<'auto' | 'custom'>('auto');
  const [customImage, setCustomImage] = useState('');
  const [tileColor, setTileColor] = useState(themeAccent);
  const [folderTitle, setFolderTitle] = useState('');
  const [folderColor, setFolderColor] = useState(themeAccent);
  const [urlValid, setUrlValid] = useState(false);
  const [faviconHost, setFaviconHost] = useState('');
  const [autoPreviewUrl, setAutoPreviewUrl] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [bookmarkFolders, setBookmarkFolders] = useState<BookmarkFolderOption[]>([]);
  const [selectedBookmarkFolderId, setSelectedBookmarkFolderId] = useState<string | null>(null);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);
  const [containers, setContainers] = useState<FirefoxContainer[]>([]);
  const [containersLoading, setContainersLoading] = useState(false);
  const [selectedContainerId, setSelectedContainerId] = useState('');
  const [containerMenuOpen, setContainerMenuOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const tileColorRef = useRef<HTMLInputElement>(null);
  const folderColorRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !modalRef.current) return;
      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    if (!url.trim()) {
      setUrlValid(false);
      setFaviconHost('');
      setAutoPreviewUrl('');
      return;
    }
    try {
      let u = url.trim();
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      const parsed = new URL(u);
      setUrlValid(true);
      setFaviconHost(parsed.hostname);
      setAutoPreviewUrl(getScreenshotThumbnailUrl(parsed.toString()));
    } catch {
      setUrlValid(false);
      setFaviconHost('');
      setAutoPreviewUrl('');
    }
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    setContainersLoading(true);
    listFirefoxContainers()
      .then((items) => {
        if (!cancelled) setContainers(items);
      })
      .catch(() => {
        if (!cancelled) setContainers([]);
      })
      .finally(() => {
        if (!cancelled) setContainersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (entryMode !== 'bookmark-folder') return;
    let cancelled = false;
    setBookmarkLoading(true);
    setBookmarkError(null);
    listBookmarkFolders()
      .then((folders) => {
        if (!cancelled) setBookmarkFolders(folders);
      })
      .catch((error) => {
        if (!cancelled) setBookmarkError((error as Error).message || 'Failed to load bookmark folders');
      })
      .finally(() => {
        if (!cancelled) setBookmarkLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entryMode, listBookmarkFolders]);

  useEffect(() => {
    setSelectedBookmarkFolderId((current) => (
      current && bookmarkFolders.some((folder) => folder.id === current) ? current : null
    ));
  }, [bookmarkFolders]);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => setCustomImage(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleFile(file);
    }
  }, [handleFile]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    let u = url.trim();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;

    try {
      const hostname = new URL(u).hostname.replace('www.', '');
      const t = title.trim() || hostname;
      const selectedContainer = containers.find((container) => container.cookieStoreId === selectedContainerId);

      addTile({
        id: crypto.randomUUID(),
        type: 'tile',
        title: t,
        url: u,
        thumbnail: mode === 'auto' ? (getScreenshotThumbnailUrl(u) || undefined) : undefined,
        customImage: (mode === 'custom' && customImage) ? customImage : undefined,
        dominantColor: (mode === 'custom' && customImage) ? undefined : tileColor,
        containerCookieStoreId: selectedContainerId || undefined,
        containerName: selectedContainerId ? selectedContainer?.name : undefined,
        containerColor: selectedContainerId ? selectedContainer?.color : undefined,
        parentId: parentId || undefined,
        order: tiles.filter(ti => (parentId ? ti.parentId === parentId : !ti.parentId)).length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      onClose();
    } catch { /* invalid url */ }
  }, [url, title, containers, mode, customImage, selectedContainerId, tileColor, tiles, parentId, addTile, onClose]);

  const handleCreateFolder = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const name = folderTitle.trim() || 'Новая папка';
    await addTile({
      id: crypto.randomUUID(),
      type: 'folder',
      title: name,
      childrenIds: [],
      dominantColor: folderColor,
      parentId: parentId || undefined,
      order: tiles.filter(ti => (parentId ? ti.parentId === parentId : !ti.parentId)).length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    onClose();
  }, [addTile, folderColor, folderTitle, onClose, parentId, tiles]);

  const handleAddBookmarkFolder = useCallback(async (bookmarkFolderId: string) => {
    await addBookmarkFolder(bookmarkFolderId, settings.bookmarkFolderMode, parentId);
    onClose();
  }, [addBookmarkFolder, onClose, parentId, settings.bookmarkFolderMode]);

  const handleAddSelectedBookmarkFolder = useCallback(async () => {
    if (!selectedBookmarkFolderId) return;
    await handleAddBookmarkFolder(selectedBookmarkFolderId);
  }, [handleAddBookmarkFolder, selectedBookmarkFolderId]);

  const selectedContainer = containers.find((container) => container.cookieStoreId === selectedContainerId);

  const modal = (
    <div
      className="overlay add-tile-overlay"
      data-testid="add-tile-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(7, 10, 18, 0.76)',
        backdropFilter: 'blur(22px)',
        WebkitBackdropFilter: 'blur(22px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 9999,
        animation: 'fadeIn 0.18s ease-out',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="add-tile-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Add tile or folder"
        data-testid="add-tile-modal"
        style={{
          width: 'min(760px, calc(100vw - 32px))',
          minHeight: '560px',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          padding: '42px',
          boxSizing: 'border-box',
          borderRadius: '24px',
          background: 'rgba(18, 20, 35, 0.92)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 0 45px rgba(0,0,0,0.42), 0 0 18px color-mix(in srgb, var(--fasp-accent) 18%, transparent)',
          backdropFilter: 'blur(35px)',
          WebkitBackdropFilter: 'blur(35px)',
          animation: 'modalAppear 0.18s ease',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: '34px' }}>
          <h1 style={{
            fontSize: '36px',
            fontWeight: 700,
            color: 'white',
            marginBottom: '8px',
            lineHeight: 1.1,
          }}>
            ✨ Добавить плитку
          </h1>
          <p style={{
            color: 'rgba(255,255,255,0.58)',
            fontSize: '15px',
            margin: 0,
          }}>
            Добавьте новый сайт для быстрого доступа
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '22px' }}>
          {([
            ['site', 'Создать плитку'],
            ['bookmark-folder', 'Создать папку'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-testid={value === 'site' ? 'add-tab-site' : 'add-tab-folder'}
              className={`add-dialog-tab ${entryMode === value ? 'add-dialog-tab-active' : ''}`}
              onClick={() => setEntryMode(value)}
              style={{
                flex: 1,
                height: '44px',
                border: 'none',
                borderRadius: '12px',
                background: entryMode === value ? 'color-mix(in srgb, var(--fasp-accent) 22%, rgba(255,255,255,0.05))' : 'rgba(255,255,255,0.05)',
                color: entryMode === value ? 'var(--fasp-text)' : 'rgba(255,255,255,0.65)',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
                transition: '180ms',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Form */}
        {entryMode === 'site' ? (
        <form onSubmit={handleSubmit}>
          {/* URL field */}
          <label style={{
            display: 'block',
            marginTop: '22px',
            marginBottom: '10px',
            color: 'rgba(255,255,255,0.84)',
            fontSize: '14px',
            fontWeight: 600,
          }}>
            Адрес сайта
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              data-testid="add-tile-url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                height: '58px',
                borderRadius: '14px',
                padding: '0 18px',
                paddingRight: urlValid ? '44px' : '18px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.07)',
                color: 'white',
                fontSize: '16px',
                outline: 'none',
                transition: '180ms',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => {
                e.target.style.border = '1px solid color-mix(in srgb, var(--fasp-accent) 58%, rgba(255,255,255,0.12))';
                e.target.style.boxShadow = '0 0 0 4px color-mix(in srgb, var(--fasp-accent) 15%, transparent)';
              }}
              onBlur={(e) => {
                e.target.style.border = '1px solid rgba(255,255,255,0.07)';
                e.target.style.boxShadow = 'none';
              }}
            />
            {urlValid && (
              <span style={{
                position: 'absolute',
                right: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#34d399',
                fontSize: '18px',
              }}>
                ✓
              </span>
            )}
          </div>

          {/* Title field */}
          <label style={{
            display: 'block',
            marginTop: '22px',
            marginBottom: '10px',
            color: 'rgba(255,255,255,0.84)',
            fontSize: '14px',
            fontWeight: 600,
          }}>
            Название
          </label>
          <input
            type="text"
            data-testid="add-tile-title"
            placeholder="Введите название"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{
              width: '100%',
              height: '58px',
              borderRadius: '14px',
              padding: '0 18px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.07)',
              color: 'white',
              fontSize: '16px',
              outline: 'none',
              transition: '180ms',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => {
              e.target.style.border = '1px solid color-mix(in srgb, var(--fasp-accent) 58%, rgba(255,255,255,0.12))';
              e.target.style.boxShadow = '0 0 0 4px color-mix(in srgb, var(--fasp-accent) 15%, transparent)';
            }}
            onBlur={(e) => {
              e.target.style.border = '1px solid rgba(255,255,255,0.07)';
              e.target.style.boxShadow = 'none';
            }}
          />

          <label style={{
            display: 'block',
            marginTop: '22px',
            marginBottom: '10px',
            color: 'rgba(255,255,255,0.84)',
            fontSize: '14px',
            fontWeight: 600,
          }}>
            Всегда запускать в контейнере
          </label>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              data-testid="add-tile-container-trigger"
              disabled={containersLoading}
              onClick={() => setContainerMenuOpen((open) => !open)}
              style={{
                width: '100%',
                height: '58px',
                borderRadius: '14px',
                padding: '0 18px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.07)',
                color: containersLoading ? 'rgba(255,255,255,0.42)' : 'white',
                fontSize: '16px',
                outline: 'none',
                transition: '180ms',
                boxSizing: 'border-box',
                cursor: containersLoading ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                textAlign: 'left',
              }}
            >
              <span style={{ display: 'flex', minWidth: 0, alignItems: 'center', gap: '14px' }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: '11px',
                    height: '11px',
                    borderRadius: '999px',
                    flexShrink: 0,
                    background: selectedContainer ? getContainerColor(selectedContainer.color) : 'rgba(255,255,255,0.28)',
                    boxShadow: selectedContainer ? `0 0 16px ${getContainerColor(selectedContainer.color)}` : 'none',
                  }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {containersLoading ? 'Загрузка контейнеров...' : selectedContainer?.name || 'Без контейнера'}
                </span>
              </span>
              <span
                aria-hidden="true"
                style={{
                  color: 'rgba(255,255,255,0.45)',
                  fontSize: '15px',
                  transform: containerMenuOpen ? 'rotate(180deg)' : 'none',
                  transition: '160ms',
                }}
              >
                ˅
              </span>
            </button>
            {containerMenuOpen && !containersLoading && (
              <div
                data-testid="add-tile-container-menu"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 'calc(100% + 8px)',
                  zIndex: 20,
                  maxHeight: '190px',
                  overflowY: 'auto',
                  padding: '6px',
                  borderRadius: '14px',
                  background: 'rgba(18, 20, 35, 0.98)',
                  border: '1px solid rgba(255,255,255,0.11)',
                  boxShadow: '0 18px 36px rgba(0,0,0,0.38), 0 0 0 1px rgba(255,255,255,0.04) inset',
                  backdropFilter: 'blur(22px)',
                  WebkitBackdropFilter: 'blur(22px)',
                }}
              >
                {[
                  { cookieStoreId: '', name: 'Без контейнера', color: undefined },
                  ...containers,
                ].map((container) => {
                  const selected = selectedContainerId === container.cookieStoreId;
                  return (
                    <button
                      key={container.cookieStoreId || 'default-container'}
                      type="button"
                      data-testid="add-tile-container-option"
                      data-container-id={container.cookieStoreId}
                      onClick={() => {
                        setSelectedContainerId(container.cookieStoreId);
                        setContainerMenuOpen(false);
                      }}
                      style={{
                        width: '100%',
                        minHeight: '40px',
                        border: 0,
                        borderRadius: '10px',
                        background: selected ? 'color-mix(in srgb, var(--fasp-accent) 20%, transparent)' : 'transparent',
                        color: selected ? 'white' : 'rgba(255,255,255,0.72)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '0 12px',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '999px',
                          flexShrink: 0,
                          background: container.cookieStoreId ? getContainerColor(container.color) : 'rgba(255,255,255,0.28)',
                        }}
                      />
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {container.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <input
              type="hidden"
              data-testid="add-tile-container-select"
              value={selectedContainerId}
              readOnly
            />
          </div>

          {/* Image mode */}
          <label style={{
            display: 'block',
            marginTop: '22px',
            marginBottom: '10px',
            color: 'rgba(255,255,255,0.84)',
            fontSize: '14px',
            fontWeight: 600,
          }}>
            Изображение плитки
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setMode('auto')}
              style={{
                flex: 1,
                height: '48px',
                border: 'none',
                borderRadius: '12px',
                background: mode === 'auto' ? 'linear-gradient(135deg, var(--fasp-accent), color-mix(in srgb, var(--fasp-accent-2) 38%, var(--fasp-accent)))' : 'rgba(255,255,255,0.05)',
                color: mode === 'auto' ? 'var(--fasp-on-accent)' : 'rgba(255,255,255,0.65)',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
                transition: '180ms',
                boxShadow: mode === 'auto' ? '0 10px 24px color-mix(in srgb, var(--fasp-accent) 28%, transparent)' : 'none',
              }}
            >
              Авто-превью
            </button>
            <button
              type="button"
              onClick={() => setMode('custom')}
              style={{
                flex: 1,
                height: '48px',
                border: 'none',
                borderRadius: '12px',
                background: mode === 'custom' ? 'linear-gradient(135deg, var(--fasp-accent), color-mix(in srgb, var(--fasp-accent-2) 38%, var(--fasp-accent)))' : 'rgba(255,255,255,0.05)',
                color: mode === 'custom' ? 'var(--fasp-on-accent)' : 'rgba(255,255,255,0.65)',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
                transition: '180ms',
                boxShadow: mode === 'custom' ? '0 10px 24px color-mix(in srgb, var(--fasp-accent) 28%, transparent)' : 'none',
              }}
            >
              Загрузить файл
            </button>
          </div>

          <div className="add-dialog-color-strip" aria-label="Цвет плитки">
            <button
              type="button"
              className="add-dialog-color-globe"
              onClick={() => setTileColor(themeAccent)}
              aria-label="Основной цвет"
            >
              <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M3.8 12h16.4" />
                <path d="M12 3.5c2.2 2.3 3.2 5.1 3.2 8.5s-1 6.2-3.2 8.5" />
                <path d="M12 3.5C9.8 5.8 8.8 8.6 8.8 12s1 6.2 3.2 8.5" />
              </svg>
            </button>
            <div className="add-dialog-color-dots">
              {colorSwatches.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  className={`add-dialog-color-dot ${tileColor === swatch ? 'add-dialog-color-dot-active' : ''}`}
                  style={{ background: swatch }}
                  onClick={() => setTileColor(swatch)}
                  aria-label={swatch}
                />
              ))}
              <button
                type="button"
                className="add-dialog-color-dot add-dialog-color-custom-dot"
                onClick={() => tileColorRef.current?.click()}
                aria-label="Выбрать произвольный цвет"
              >
                ...
              </button>
            </div>
          </div>
          <input
            ref={tileColorRef}
            type="color"
            value={tileColor}
            onChange={(event) => setTileColor(event.target.value)}
            className="hidden"
          />

          {/* Preview / Upload area */}
          {mode === 'auto' && urlValid && (
            <div style={{
              marginTop: '24px',
              width: '100%',
              height: '170px',
              borderRadius: '16px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              overflow: 'hidden',
              position: 'relative',
            }}>
              {autoPreviewUrl && (
                <img
                  src={autoPreviewUrl}
                  alt="Preview"
                  referrerPolicy="no-referrer"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
              )}
              <div style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.62))',
              }} />
              <span style={{
                position: 'absolute',
                left: '16px',
                bottom: '14px',
                color: 'rgba(255,255,255,0.76)',
                fontSize: '13px',
                fontWeight: 500,
              }}>
                {faviconHost}
              </span>
            </div>
          )}

          {mode === 'custom' && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                marginTop: '24px',
                width: '100%',
                height: '140px',
                borderRadius: '16px',
                border: `2px dashed ${dragOver ? 'color-mix(in srgb, var(--fasp-accent) 60%, transparent)' : 'rgba(255,255,255,0.1)'}`,
                background: dragOver ? 'color-mix(in srgb, var(--fasp-accent) 7%, transparent)' : 'rgba(255,255,255,0.02)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                cursor: 'pointer',
                transition: '180ms',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              {customImage ? (
                <>
                  <img
                    src={customImage}
                    alt="Preview"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      borderRadius: '14px',
                    }}
                  />
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0,0,0,0.4)',
                    borderRadius: '14px',
                  }} />
                  <span style={{ position: 'relative', zIndex: 1, color: 'rgba(255,255,255,0.6)', fontSize: '13px' }}>
                    Нажмите, чтобы изменить
                  </span>
                </>
              ) : (
                <>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
                    <path d="M4 8a4 4 0 014-4h8a4 4 0 014 4v8a4 4 0 01-4 4H8a4 4 0 01-4-4V8z" />
                    <circle cx="8.5" cy="8.5" r="1.5" fill="rgba(255,255,255,0.2)" />
                    <path d="M20 15l-5-5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '14px', marginTop: '8px' }}>
                    Перетащите изображение сюда
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '12px', marginTop: '4px' }}>
                    или нажмите для выбора файла
                  </span>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </div>
          )}

          {/* Footer buttons */}
          <div style={{
            marginTop: '40px',
            display: 'flex',
            justifyContent: 'space-between',
          }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: '170px',
                height: '54px',
                border: 'none',
                borderRadius: '14px',
                background: 'rgba(255,255,255,0.05)',
                color: 'rgba(255,255,255,0.75)',
                fontSize: '15px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: '180ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              }}
            >
              Отмена
            </button>
            <button
              type="submit"
              data-testid="create-tile-button"
              disabled={!url.trim()}
              style={{
                width: '240px',
                height: '54px',
                border: 'none',
                borderRadius: '14px',
                background: url.trim()
                  ? 'linear-gradient(135deg, var(--fasp-accent), color-mix(in srgb, var(--fasp-accent-2) 38%, var(--fasp-accent)))'
                  : 'rgba(255,255,255,0.08)',
                color: url.trim() ? 'var(--fasp-on-accent)' : 'rgba(255,255,255,0.3)',
                fontSize: '15px',
                fontWeight: 600,
                cursor: url.trim() ? 'pointer' : 'not-allowed',
                boxShadow: url.trim()
                  ? '0 10px 26px color-mix(in srgb, var(--fasp-accent) 30%, transparent)'
                  : 'none',
                transition: '180ms',
              }}
            >
              ✨ Создать плитку
            </button>
          </div>
        </form>
        ) : (
          <div>
            <form className="add-dialog-folder-create" onSubmit={handleCreateFolder}>
              <div
                className="add-dialog-folder-preview"
                aria-hidden="true"
                style={{
                  borderColor: `color-mix(in srgb, ${folderColor} 34%, rgba(255,255,255,0.12))`,
                  background: `radial-gradient(circle at 50% 42%, color-mix(in srgb, ${folderColor} 28%, transparent), transparent 50%), rgba(255,255,255,0.055)`,
                  color: folderColor,
                }}
              >
                <svg
                  width="62"
                  height="62"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  style={{ filter: `drop-shadow(0 14px 24px color-mix(in srgb, ${folderColor} 34%, transparent))` }}
                >
                  <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
                </svg>
              </div>
              <input
                type="text"
                data-testid="add-folder-title"
                placeholder="Новая папка"
                value={folderTitle}
                onChange={(event) => setFolderTitle(event.target.value)}
              />
              <div className="add-dialog-folder-rail" aria-label="Цвет папки">
                <button
                  type="button"
                  className={`add-dialog-folder-choice ${folderColor === themeAccent ? 'add-dialog-folder-choice-active' : ''}`}
                  onClick={() => setFolderColor(themeAccent)}
                >
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
                  </svg>
                </button>
                {colorSwatches.slice(1, 7).map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    className={`add-dialog-folder-choice ${folderColor === swatch ? 'add-dialog-folder-choice-active' : ''}`}
                    onClick={() => setFolderColor(swatch)}
                    aria-label={swatch}
                  >
                    <span style={{ background: swatch }} />
                  </button>
                ))}
                <button
                  type="button"
                  className="add-dialog-folder-choice add-dialog-folder-custom-color"
                  onClick={() => folderColorRef.current?.click()}
                  aria-label="Выбрать произвольный цвет"
                >
                  ...
                </button>
              </div>
              <input
                ref={folderColorRef}
                type="color"
                value={folderColor}
                onChange={(event) => setFolderColor(event.target.value)}
                className="hidden"
              />
              <div className="add-dialog-folder-actions">
                <button type="button" onClick={onClose}>Отмена</button>
                <button type="submit" data-testid="create-folder-button">Создать</button>
              </div>
            </form>

            <div style={{
              marginBottom: '16px',
              padding: '14px 16px',
              borderRadius: '14px',
              background: 'rgba(255,255,255,0.045)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.68)',
              fontSize: '13px',
              lineHeight: 1.5,
            }}>
              Режим добавления: <strong style={{ color: 'white' }}>{settings.bookmarkFolderMode === 'reference' ? 'Reference' : 'Clone'}</strong>
              <br />
              {settings.bookmarkFolderMode === 'reference'
                ? 'Изменения в такой папке будут синхронизироваться с оригинальной папкой Firefox bookmarks.'
                : 'Будет создана независимая локальная копия выбранной папки.'}
            </div>

            <div className="add-dialog-bookmark-heading">
              <span>Папки из Избранного</span>
              <small>Выберите папку Firefox bookmarks для добавления на этот уровень.</small>
            </div>

            <div style={{
              height: '340px',
              overflowY: 'auto',
              borderRadius: '16px',
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.025)',
            }}>
              {bookmarkLoading && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'rgba(255,255,255,0.45)' }}>
                  Загрузка папок...
                </div>
              )}

              {!bookmarkLoading && bookmarkError && (
                <div style={{ padding: '24px', textAlign: 'center', color: '#fca5a5' }}>
                  {bookmarkError}
                </div>
              )}

              {!bookmarkLoading && !bookmarkError && bookmarkFolders.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'rgba(255,255,255,0.45)' }}>
                  В Избранном не найдено папок.
                </div>
              )}

              {!bookmarkLoading && !bookmarkError && bookmarkFolders.map((folder) => {
                const selected = selectedBookmarkFolderId === folder.id;
                return (
                  <button
                    key={folder.id}
                    type="button"
                    aria-pressed={selected}
                    data-testid="bookmark-folder-row"
                    data-bookmark-folder-id={folder.id}
                    onClick={() => setSelectedBookmarkFolderId(folder.id)}
                    onDoubleClick={() => void handleAddBookmarkFolder(folder.id)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '14px 16px',
                      border: 'none',
                      borderBottom: '1px solid rgba(255,255,255,0.055)',
                      background: selected ? 'color-mix(in srgb, var(--fasp-accent) 18%, transparent)' : 'transparent',
                      color: 'white',
                      textAlign: 'left',
                      cursor: 'pointer',
                      boxShadow: selected ? 'inset 3px 0 0 color-mix(in srgb, var(--fasp-accent) 88%, white)' : 'none',
                      transition: '160ms',
                    }}
                  >
                    <span style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: selected
                        ? 'color-mix(in srgb, var(--fasp-accent) 42%, transparent)'
                        : 'color-mix(in srgb, var(--fasp-accent) 18%, transparent)',
                      color: 'rgba(255,255,255,0.82)',
                      flexShrink: 0,
                    }}>
                      <svg width="19" height="19" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                      </svg>
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: '14px', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {folder.title}
                      </span>
                      <span style={{ display: 'block', marginTop: '3px', fontSize: '12px', color: 'rgba(255,255,255,0.38)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {folder.path}
                      </span>
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '12px' }}>
                      {folder.childCount}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="add-dialog-bookmark-actions" style={{ margin: '28px 0 22px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  width: '170px',
                  height: '54px',
                  border: 'none',
                  borderRadius: '14px',
                  background: 'rgba(255,255,255,0.05)',
                  color: 'rgba(255,255,255,0.75)',
                  fontSize: '15px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: '180ms',
                }}
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={!selectedBookmarkFolderId}
                data-testid="add-bookmark-folder-button"
                onClick={() => void handleAddSelectedBookmarkFolder()}
                style={{
                  width: '220px',
                  height: '54px',
                  border: 'none',
                  borderRadius: '14px',
                  background: selectedBookmarkFolderId
                    ? 'linear-gradient(135deg, var(--fasp-accent), color-mix(in srgb, var(--fasp-accent-2) 38%, var(--fasp-accent)))'
                    : 'rgba(255,255,255,0.08)',
                  color: selectedBookmarkFolderId ? 'var(--fasp-on-accent)' : 'rgba(255,255,255,0.3)',
                  fontSize: '15px',
                  fontWeight: 650,
                  cursor: selectedBookmarkFolderId ? 'pointer' : 'not-allowed',
                  boxShadow: selectedBookmarkFolderId
                    ? '0 10px 26px color-mix(in srgb, var(--fasp-accent) 30%, transparent)'
                    : 'none',
                  transition: '180ms',
                }}
              >
                Добавить
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
