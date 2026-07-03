import type { TileOpenTarget } from '../../types';

export interface FirefoxContainer {
  cookieStoreId: string;
  name: string;
  color?: string;
  icon?: string;
}

export const containerColorMap: Record<string, string> = {
  blue: '#37adff',
  turquoise: '#00c79a',
  green: '#51cd00',
  yellow: '#ffcb00',
  orange: '#ff9f00',
  red: '#ff613d',
  pink: '#ff4bda',
  purple: '#af51f5',
  toolbar: '#8b5cf6',
};

export async function listFirefoxContainers(): Promise<FirefoxContainer[]> {
  try {
    if (typeof browser === 'undefined' || !browser.contextualIdentities?.query) return [];
    return await browser.contextualIdentities.query({});
  } catch {
    return [];
  }
}

export function getContainerColor(color: string | undefined): string {
  return containerColorMap[color || ''] || 'rgba(255,255,255,0.5)';
}

export async function openUrlFromStartPage(
  url: string,
  target: TileOpenTarget,
  cookieStoreId?: string
): Promise<void> {
  if (!url.trim()) return;
  const canUseCurrentTab = target === 'current-tab' && !cookieStoreId;

  if (canUseCurrentTab) {
    try {
      if (typeof browser !== 'undefined' && browser.tabs?.update) {
        await browser.tabs.update({ url });
        return;
      }
    } catch {
      // Fall back to regular navigation below.
    }
    window.location.assign(url);
    return;
  }

  if (target === 'new-window') {
    try {
      if (typeof browser !== 'undefined' && browser.windows?.create) {
        await browser.windows.create({
          url,
          focused: true,
          ...(cookieStoreId ? { cookieStoreId } : {}),
        });
        return;
      }
    } catch {
      // Fall back to a tab if the window API is unavailable.
    }
  }

  try {
    if (typeof browser !== 'undefined' && browser.tabs?.create) {
      await browser.tabs.create({
        url,
        active: true,
        ...(cookieStoreId ? { cookieStoreId } : {}),
      });
      return;
    }
  } catch {
    // Fall back to a normal tab without a container.
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}
