const UI_SURFACE_MODE_KEY = 'fasp.ui.surfaceMode';

type UiSurfaceMode = 'modern' | 'legacy';

function readSurfaceMode(): UiSurfaceMode {
  try {
    return localStorage.getItem(UI_SURFACE_MODE_KEY) === 'legacy' ? 'legacy' : 'modern';
  } catch {
    return 'modern';
  }
}

function writeSurfaceMode(mode: UiSurfaceMode): void {
  try {
    localStorage.setItem(UI_SURFACE_MODE_KEY, mode);
  } catch {
    // Keep the visual mode best-effort if storage is not available.
  }
}

function applySurfaceClass(mode = readSurfaceMode()): void {
  document.documentElement.classList.toggle('fasp-modern-surfaces', mode === 'modern');
}

function reloadSoon(): void {
  window.setTimeout(() => window.location.reload(), 30);
}

export function installUiSurfaceModeApi(): void {
  applySurfaceClass();

  window.faspUi = {
    ...(window.faspUi ?? {}),
    surfaceMode: () => readSurfaceMode(),
    useModernSurfaces: () => {
      writeSurfaceMode('modern');
      applySurfaceClass('modern');
      reloadSoon();
    },
    useLegacySurfaces: () => {
      writeSurfaceMode('legacy');
      applySurfaceClass('legacy');
      reloadSoon();
    },
  };
}

declare global {
  interface Window {
    faspUi?: {
      surfaceMode?: () => UiSurfaceMode;
      useModernSurfaces?: () => void;
      useLegacySurfaces?: () => void;
      [key: string]: unknown;
    };
  }
}
