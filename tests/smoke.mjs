import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const require = createRequire(import.meta.url);
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const viteBin = join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');

function findPackageCandidates(nodeModulesDir, packageName) {
  // Prefer pnpm store entries: they colocate the package with its own
  // dependencies (e.g. playwright-core), unlike the top-level stub.
  const pnpmDir = join(nodeModulesDir, '.pnpm');
  const candidates = [];
  try {
    candidates.push(...readdirSync(pnpmDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${packageName}@`))
      .map((entry) => join(pnpmDir, entry.name, 'node_modules', packageName))
      .sort()
      .reverse());
  } catch {
    // No pnpm store in this node_modules directory.
  }
  candidates.push(join(nodeModulesDir, packageName));
  return candidates;
}

const playwrightCandidates = [
  process.env.FASP_PLAYWRIGHT_PATH,
  ...(process.env.FASP_NODE_MODULES_PATH
    ? findPackageCandidates(process.env.FASP_NODE_MODULES_PATH, 'playwright')
    : []),
].filter(Boolean);

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    for (const candidate of playwrightCandidates) {
      if (existsSync(candidate)) return require(candidate);
    }
    throw new Error('Playwright is not installed. Install playwright locally, or point FASP_PLAYWRIGHT_PATH at a playwright package (or FASP_NODE_MODULES_PATH at a node_modules directory that contains one).');
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 4173;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForServer(url, processRef) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (processRef.exitCode !== null) {
      throw new Error(`Preview server exited early with code ${processRef.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startPreview(port) {
  return spawn(process.execPath, [
    viteBin,
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
}

function smokeManifestPermissions() {
  const manifest = JSON.parse(readFileSync(join(rootDir, 'dist', 'manifest.json'), 'utf8'));
  const permissions = new Set(manifest.permissions || []);
  assert(permissions.has('contextualIdentities'), 'Manifest should request contextualIdentities for Firefox containers');
  assert(permissions.has('cookies'), 'Manifest should request cookies so cookieStoreId can open container tabs');
}

function findInstalledChromium() {
  const candidates = [
    process.env.FASP_BROWSER_EXECUTABLE,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

async function launchChromium(chromium) {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const executablePath = findInstalledChromium();
    if (!executablePath) throw error;
    return await chromium.launch({ headless: true, executablePath });
  }
}

async function stopPreview(processRef) {
  if (!processRef || processRef.exitCode !== null) return;
  processRef.kill();
  await new Promise((resolve) => processRef.once('exit', resolve));
}

const browserMockScript = () => {
  const bookmarkTree = [
    {
      id: 'root________',
      title: '',
      children: [
        {
          id: 'toolbar_____',
          title: 'Избранное',
          children: [
            {
              id: 'bookmark-folder-work',
              title: 'Работа',
              index: 0,
              children: [
                { id: 'bookmark-work-1', title: 'Example', url: 'https://example.com', index: 0 },
                { id: 'bookmark-work-2', title: 'Docs', url: 'https://developer.mozilla.org', index: 1 },
              ],
            },
            {
              id: 'bookmark-folder-dev',
              title: 'Разработка',
              index: 1,
              children: [
                { id: 'bookmark-dev-1', title: 'React', url: 'https://react.dev', index: 0 },
              ],
            },
          ],
        },
      ],
    },
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function findNode(nodes, id) {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = findNode(node.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  function readStorage() {
    try {
      return JSON.parse(localStorage.getItem('__fasp_mock_storage__') || '{}');
    } catch {
      return {};
    }
  }

  function writeStorage(data) {
    localStorage.setItem('__fasp_mock_storage__', JSON.stringify(data));
  }

  window.__faspOpenedUrls = [];

  window.browser = {
    storage: {
      local: {
        async get(keys) {
          const data = readStorage();
          if (!keys) return clone(data);
          if (typeof keys === 'string') return { [keys]: data[keys] };
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, data[key]]));
          }
          if (typeof keys === 'object') {
            return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, data[key] ?? fallback]));
          }
          return {};
        },
        async set(items) {
          writeStorage({ ...readStorage(), ...items });
        },
        async remove(keys) {
          const data = readStorage();
          for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
          writeStorage(data);
        },
        async clear() {
          writeStorage({});
        },
      },
    },
    runtime: {
      onMessage: { addListener() {}, removeListener() {} },
      async sendMessage(message) {
        if (message?.type === 'get-bookmarks') return clone(bookmarkTree);
        return null;
      },
    },
    bookmarks: {
      async getTree() {
        return clone(bookmarkTree);
      },
      async getSubTree(id) {
        const node = findNode(bookmarkTree, id);
        return node ? [clone(node)] : [];
      },
      async create(details) {
        return {
          id: `created-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          title: details.title || '',
          url: details.url,
          parentId: details.parentId,
          index: details.index ?? 0,
          children: details.url ? undefined : [],
        };
      },
      async update(id, changes) {
        return { id, ...changes };
      },
      async remove() {},
      async removeTree() {},
      async move(id, destination) {
        return { id, ...destination };
      },
    },
    tabs: {
      async query() { return []; },
      async create(details = {}) {
        window.__faspOpenedUrls.push({ kind: 'tab', ...details });
        return { id: Date.now(), active: details.active ?? true, ...details };
      },
      async update(...args) {
        const details = args.length === 1 ? args[0] : args[1];
        window.__faspOpenedUrls.push({ kind: 'current', ...details });
        return { id: 1, active: details?.active ?? true, ...details };
      },
    },
    windows: {
      async create(details = {}) {
        window.__faspOpenedUrls.push({ kind: 'window', ...details });
        return { id: Date.now(), tabs: [{ id: Date.now() + 1, url: details.url }] };
      },
    },
    topSites: {
      async get() {
        return [
          { title: 'Example', url: 'https://example.com' },
          { title: 'MDN', url: 'https://developer.mozilla.org' },
        ];
      },
    },
    sessions: {
      async getRecentlyClosed() {
        return [
          { tab: { title: 'Closed Example', url: 'https://closed.example', sessionId: 'closed-1' } },
        ];
      },
      async restore() { return {}; },
    },
    contextualIdentities: {
      async query() {
        return [
          { cookieStoreId: 'firefox-container-work', name: 'Work', color: 'blue', icon: 'briefcase' },
          { cookieStoreId: 'firefox-container-personal', name: 'Personal', color: 'purple', icon: 'circle' },
        ];
      },
    },
  };
};

async function clearAppData(page, baseUrl) {
  await page.goto(`${baseUrl}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    localStorage.clear();
    window.__faspOpenedUrls = [];
    if (indexedDB.databases) {
      const databases = await indexedDB.databases();
      await Promise.all(
        databases
          .map((database) => database.name)
          .filter(Boolean)
          .map((name) => new Promise((resolve) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = request.onerror = request.onblocked = () => resolve();
          }))
      );
    }
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tile-surface-root"]').waitFor({ state: 'visible' });
}

async function putMediaAsset(page, assetId) {
  await page.evaluate(async (id) => {
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGklEQVR42mP8z8Dwn4GBgYERJjDgAABQYQICZ6eL8QAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('fasp-media-assets', 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('assets')) {
          database.createObjectStore('assets', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    await new Promise((resolve, reject) => {
      const transaction = db.transaction('assets', 'readwrite');
      transaction.objectStore('assets').put({
        id,
        kind: 'wallpaper',
        blob,
        mimeType: 'image/png',
        width: 2,
        height: 2,
        createdAt: Date.now(),
        originalBytes: blob.size,
      });
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }, assetId);
}

async function setBookmarkMode(page, mode) {
  await page.evaluate(async (nextMode) => {
    await window.browser.storage.local.set({
      'fasp-settings': {
        borderRadiusDefault: 12,
        tileOpacityDefault: 0.9,
        showSearchBar: false,
        showClock: false,
        showWeather: false,
        weatherLocation: '',
        weatherDisplayMode: 'inline',
        searchBarWidth: 60,
        searchResultLimit: 50,
        bookmarkFolderMode: nextMode,
      },
    });
  }, mode);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tile-surface-root"]').waitFor({ state: 'visible' });
}

async function createTile(page, title, url) {
  await page.locator('[data-testid="add-tile-button"]').first().click();
  await page.locator('[data-testid="add-tile-modal"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid="add-tile-url"]').fill(url);
  await page.locator('[data-testid="add-tile-title"]').fill(title);
  await page.locator('[data-testid="create-tile-button"]').click();
  await page.locator('[data-testid="add-tile-modal"]').waitFor({ state: 'detached' });
}

async function smokeCustomTileIcon(page, baseUrl) {
  await clearAppData(page, baseUrl);
  const iconDataUrl = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2214%22 fill=%22%2322c55e%22/%3E%3Cpath d=%22M19 35l8 8 18-22%22 fill=%22none%22 stroke=%22white%22 stroke-width=%226%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E';

  await page.locator('[data-testid="add-tile-button"]').first().click();
  await page.locator('[data-testid="add-tile-modal"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid="add-tile-url"]').fill('https://custom-icon.example');
  await page.locator('[data-testid="add-tile-title"]').fill('Custom Icon');
  await page.locator('[data-testid="add-tile-icon-input"]').fill(iconDataUrl);
  await page.locator('[data-testid="create-tile-button"]').click();
  await page.locator('[data-testid="add-tile-modal"]').waitFor({ state: 'detached' });
  await page.locator('[data-testid="tile-card"][data-tile-title="Custom Icon"]').waitFor({ state: 'visible' });

  const stored = await page.evaluate(async () => {
    const result = await window.browser.storage.local.get('fasp.grid-state');
    const items = Object.values(result['fasp.grid-state']?.state?.items || {});
    return items[0];
  });
  assert(stored.customIcon === iconDataUrl, 'Custom tile icon should be saved separately from tile images');
  assert(stored.customImage === undefined, 'Custom tile icon should not become a tile background image');

  const rendered = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="tile-card"][data-tile-title="Custom Icon"]');
    return {
      iconSrc: card?.querySelector('.tile-main-icon img')?.getAttribute('src') || '',
      hasPreview: Boolean(card?.querySelector('.tile-preview')),
    };
  });
  assert(rendered.iconSrc === iconDataUrl, 'Custom tile icon should render in the icon slot');
  assert(!rendered.hasPreview, 'Custom tile icon should not render as the tile preview image');
}

async function addBookmarkFolder(page, expectedMode) {
  await page.locator('[data-testid="add-tile-button"]').first().click();
  await page.locator('[data-testid="add-tile-modal"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid="add-tab-folder"]').click();
  await page.locator('[data-testid="bookmark-folder-row"]').first().waitFor({ state: 'visible' });
  await page.locator('[data-testid="bookmark-folder-row"][data-bookmark-folder-id="bookmark-folder-work"]').click();
  await page.locator('[data-testid="add-bookmark-folder-button"]').click();
  await page.locator('[data-testid="add-tile-modal"]').waitFor({ state: 'detached' });
  await page.locator(`[data-testid="tile-card"][data-tile-type="folder"][data-folder-mode="${expectedMode}"]`).waitFor({ state: 'visible' });
}

async function smokeDnd(page, baseUrl) {
  await clearAppData(page, baseUrl);
  await createTile(page, 'Alpha', 'https://alpha.example');
  await createTile(page, 'Beta', 'https://beta.example');

  const rootSurface = page.locator('[data-testid="tile-surface-root"]');
  const tiles = rootSurface.locator('[data-testid="tile-card"][data-tile-type="tile"]');
  await expectCount(tiles, 2, 'Two manually created tiles should be visible before DnD');

  const first = await tiles.nth(0).boundingBox();
  const second = await tiles.nth(1).boundingBox();
  assert(first && second, 'Tile bounding boxes should be available for DnD');

  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width + 12, second.y + second.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  await expectCount(rootSurface.locator('[data-testid="tile-card"][data-tile-type="tile"]'), 2, 'DnD smoke should keep two tiles on root surface');
}

async function smokeReferenceClone(page, baseUrl) {
  await clearAppData(page, baseUrl);
  await setBookmarkMode(page, 'reference');
  await addBookmarkFolder(page, 'reference');

  await clearAppData(page, baseUrl);
  await setBookmarkMode(page, 'clone');
  await addBookmarkFolder(page, 'clone');
}

async function smokeThemeEngine(page, baseUrl) {
  await clearAppData(page, baseUrl);
  await page.locator('[data-testid="settings-button"]').click();
  await page.locator('[data-testid="settings-modal"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid="settings-section-themes"]').click();
  await page.locator('[data-testid="theme-live-stage"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid="theme-preset-card"][data-theme-id="nord-glass"] [data-testid="theme-apply-button"]').click();
  await page.waitForTimeout(100);

  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fasp-accent').trim());
  assert(accent.length > 0, 'Theme Engine should expose the active accent CSS variable');
}

async function smokeLayoutSettings(page, baseUrl) {
  await clearAppData(page, baseUrl);
  await page.locator('[data-testid="settings-button"]').click();
  await page.locator('[data-testid="settings-modal"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid="theme-live-preview"]').waitFor({ state: 'visible' });
  const themePreviewMetrics = await page.evaluate(() => {
    const panel = document.querySelector('.theme-live-preview-panel');
    const stage = document.querySelector('.theme-live-stage');
    const panelRect = panel?.getBoundingClientRect();
    const stageRect = stage?.getBoundingClientRect();
    return {
      panel: panelRect ? { width: panelRect.width, height: panelRect.height } : null,
      stage: stageRect ? { width: stageRect.width, height: stageRect.height } : null,
    };
  });

  await page.locator('[data-testid="settings-section-layout"]').click();
  await page.locator('.layout-live-preview-panel').waitFor({ state: 'visible' });

  const dropdowns = page.locator('.settings-layout-controls .settings-dropdown-trigger');
  await expectCount(dropdowns, 6, 'Layout settings should expose six dropdown controls');
  await expectCount(page.locator('.layout-grid-preview-panel'), 0, 'Legacy layout preview should not be rendered');

  const sliders = page.locator('.settings-layout-controls input[type="range"]');
  await expectCount(sliders, 3, 'Layout settings should expose three slider controls');
  for (const index of [0, 1]) {
    const box = await sliders.nth(index).boundingBox();
    assert(box, `Layout slider ${index + 1} should have a bounding box`);
    await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  }
  await page.waitForTimeout(100);

  const baseMetrics = await page.evaluate(() => {
    const preview = document.querySelector('.layout-live-preview-panel');
    const stage = document.querySelector('.layout-live-stage');
    const previewRect = preview?.getBoundingClientRect();
    const stageRect = stage?.getBoundingClientRect();
    const rootGrid = document.querySelector('.layout-live-grid');
    const folderGrid = document.querySelector('.layout-live-folder');
    return {
      bodyOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      contentOverflowX: document.querySelector('.settings-modal-content')
        ? document.querySelector('.settings-modal-content').scrollWidth - document.querySelector('.settings-modal-content').clientWidth
        : 0,
      panel: previewRect ? { width: previewRect.width, height: previewRect.height } : null,
      stage: stageRect ? { width: stageRect.width, height: stageRect.height } : null,
      stageFits: stage ? stage.scrollHeight <= stage.clientHeight + 1 : false,
      rootTiles: document.querySelectorAll('.layout-live-grid .layout-preview-tile').length,
      folderTiles: document.querySelectorAll('.layout-live-folder .layout-preview-tile').length,
      rootColumns: rootGrid ? getComputedStyle(rootGrid).gridTemplateColumns.split(' ').length : 0,
      folderColumns: folderGrid ? getComputedStyle(folderGrid).gridTemplateColumns.split(' ').length : 0,
    };
  });
  assert(baseMetrics.bodyOverflowX === 0, 'Layout settings should not create page-level horizontal overflow');
  assert(baseMetrics.contentOverflowX === 0, 'Layout settings should not create modal horizontal overflow');
  assert(themePreviewMetrics.panel && baseMetrics.panel, 'Both live preview panels should be measurable');
  assert(
    Math.abs(themePreviewMetrics.panel.width - baseMetrics.panel.width) <= 1
      && Math.abs(themePreviewMetrics.panel.height - baseMetrics.panel.height) <= 1,
    'Theme and layout live preview panels should share the same size'
  );
  assert(baseMetrics.panel.width >= 500, 'Layout live preview should be wide enough for dense previews');
  assert(baseMetrics.panel.height >= 560, 'Layout live preview should be taller than the compact card');
  assert(baseMetrics.stageFits, 'Layout live preview stage should fit without internal scrolling');
  assert(baseMetrics.rootTiles === 12 && baseMetrics.rootColumns === 12, 'Layout preview should render 12 root columns at the maximum setting');
  assert(baseMetrics.folderTiles === 12 && baseMetrics.folderColumns === 12, 'Layout preview should render 12 folder columns at the maximum setting');

  await dropdowns.nth(0).click();
  await page.locator('.settings-dropdown-menu .settings-dropdown-option').nth(2).click();
  await page.locator('.layout-preview-thumbnail').first().waitFor({ state: 'visible' });
  await expectCount(page.locator('.layout-preview-favicon-badge'), 0, 'Thumbnail mode should hide favicon badges in the preview');

  await dropdowns.nth(1).click();
  await page.locator('.settings-dropdown-menu .settings-dropdown-option').nth(1).click();
  const denseMetrics = await page.evaluate(() => {
    const denseTitles = Array.from(document.querySelectorAll('.layout-live-grid-dense .layout-preview-title'));
    return {
      denseTitleCount: denseTitles.length,
      visibleDenseTitleCount: denseTitles.filter((title) => getComputedStyle(title).display !== 'none').length,
    };
  });
  assert(denseMetrics.denseTitleCount > 0, 'Dense preview should contain tile titles to compact');
  assert(denseMetrics.visibleDenseTitleCount === 0, 'Dense thumbnail previews should hide cramped labels');

  await dropdowns.nth(2).click();
  await page.locator('.settings-dropdown-menu .settings-dropdown-option').nth(1).click();
  await page.locator('.layout-live-folder-list').waitFor({ state: 'visible' });
  const listMetrics = await page.evaluate(() => {
    const stage = document.querySelector('.layout-live-stage');
    const listTiles = Array.from(document.querySelectorAll('.layout-live-folder-list .layout-preview-tile'));
    const thumbnails = Array.from(document.querySelectorAll('.layout-live-folder-list .layout-preview-thumbnail'));
    return {
      folderTileCount: document.querySelectorAll('.layout-live-folder-list .layout-preview-tile').length,
      stageFits: stage ? stage.scrollHeight <= stage.clientHeight + 1 : false,
      maxTileHeight: listTiles.reduce((height, tile) => Math.max(height, tile.getBoundingClientRect().height), 0),
      maxThumbnailWidth: thumbnails.reduce((width, thumbnail) => Math.max(width, thumbnail.getBoundingClientRect().width), 0),
    };
  });
  assert(listMetrics.folderTileCount === 2, 'List preview should stay compact');
  assert(listMetrics.stageFits, 'List preview should fit without internal scrolling');
  assert(listMetrics.maxTileHeight <= 56, 'List preview rows should not expand into thumbnail cards');
  assert(listMetrics.maxThumbnailWidth <= 36, 'Thumbnail mode in list preview should use compact thumbnails');

  await dropdowns.nth(3).click();
  await page.locator('.settings-dropdown-menu .settings-dropdown-option').nth(1).click();
  await page.locator('.layout-live-context-demo-active').waitFor({ state: 'visible' });

  await dropdowns.nth(3).click();
  await page.locator('.settings-dropdown-menu .settings-dropdown-option').nth(2).click();
  await expectCount(page.locator('.layout-live-context-demo-active'), 0, 'Off focus mode should disable preview dimming');
}

async function smokeStartupFolderState(page, baseUrl) {
  await clearAppData(page, baseUrl);
  await page.evaluate(async () => {
    const now = Date.now();
    const folderId = 'folder-stale-open';
    const childId = 'tile-inside-stale-folder';
    await window.browser.storage.local.set({
      'fasp.grid-state': {
        schemaVersion: 3,
        state: {
          items: {
            [folderId]: {
              id: folderId,
              type: 'folder',
              title: 'test',
              childrenIds: [childId],
              source: 'manual',
              createdAt: now,
              updatedAt: now,
              order: 0,
            },
            [childId]: {
              id: childId,
              type: 'tile',
              title: 'Inside stale folder',
              url: 'https://inside.example',
              source: 'manual',
              createdAt: now,
              updatedAt: now,
              order: 0,
            },
          },
          containers: {
            root: {
              id: 'root',
              title: 'Root',
              childrenIds: [folderId],
              createdAt: now,
              updatedAt: now,
            },
            [folderId]: {
              id: folderId,
              title: 'test',
              childrenIds: [childId],
              parentId: 'root',
              createdAt: now,
              updatedAt: now,
            },
          },
          rootContainerId: 'root',
          currentContainerId: folderId,
          containerStack: ['root', folderId],
          dragState: null,
        },
      },
    });
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tile-surface-root"]').waitFor({ state: 'visible' });
  await expectCount(page.locator('[data-folder-overlay]'), 0, 'Startup should not restore an open folder overlay');

  const storedNavigation = await page.evaluate(async () => {
    const result = await window.browser.storage.local.get('fasp.grid-state');
    const state = result['fasp.grid-state']?.state;
    return {
      currentContainerId: state?.currentContainerId,
      containerStack: state?.containerStack,
      dragState: state?.dragState,
    };
  });
  assert(storedNavigation.currentContainerId === 'root', 'Startup should reset persisted currentContainerId to root');
  assert(Array.isArray(storedNavigation.containerStack) && storedNavigation.containerStack.join(',') === 'root', 'Startup should reset persisted containerStack to root only');
  assert(storedNavigation.dragState === null, 'Startup should reset persisted dragState');
}

async function smokeTileTitleTooltip(page, baseUrl) {
  await clearAppData(page, baseUrl);
  const longTitle = 'Very long tile title that should appear completely inside the delayed accent tooltip';
  await createTile(page, longTitle, 'https://tooltip.example');

  const tile = page.locator('[data-testid="tile-card"][data-tile-type="tile"]').first();
  await tile.hover();
  await page.waitForTimeout(1100);
  await page.locator('.tile-title-tooltip').waitFor({ state: 'visible' });

  const tooltipMetrics = await page.evaluate((expectedTitle) => {
    const tooltip = document.querySelector('.tile-title-tooltip');
    const rect = tooltip?.getBoundingClientRect();
    const style = tooltip ? getComputedStyle(tooltip) : null;
    return {
      text: tooltip?.textContent || '',
      visible: Boolean(rect && rect.width > 0 && rect.height > 0),
      backgroundImage: style?.backgroundImage || '',
      backgroundColor: style?.backgroundColor || '',
      pointerEvents: style?.pointerEvents || '',
      matchesTitle: tooltip?.textContent === expectedTitle,
    };
  }, longTitle);

  assert(tooltipMetrics.matchesTitle, 'Tile title tooltip should show the complete tile title');
  assert(tooltipMetrics.visible, 'Tile title tooltip should be visible after hover delay');
  assert(tooltipMetrics.pointerEvents === 'none', 'Tile title tooltip should not capture pointer events');
  assert(
    tooltipMetrics.backgroundImage.includes('gradient') || tooltipMetrics.backgroundColor !== 'rgba(0, 0, 0, 0)',
    'Tile title tooltip should use an opaque accent surface'
  );

  await page.mouse.move(4, 4);
  await page.waitForTimeout(100);
  await expectCount(page.locator('.tile-title-tooltip'), 0, 'Tile title tooltip should hide when the pointer leaves');
}

async function smokeContextMenuReadability(page, baseUrl) {
  await clearAppData(page, baseUrl);
  await createTile(page, 'Context Tile', 'https://context.example');

  const tile = page.locator('[data-testid="tile-card"][data-tile-type="tile"]').first();
  const tileBox = await tile.boundingBox();
  assert(tileBox, 'Context menu smoke tile should have a bounding box');
  await page.mouse.click(tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2, { button: 'right' });
  await page.locator('[data-testid="context-menu"]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => (
    document.activeElement?.classList.contains('context-menu-item-active')
  ));

  const metrics = await page.evaluate(() => {
    const menu = document.querySelector('[data-testid="context-menu"]');
    const active = document.activeElement;
    const menuStyle = menu ? getComputedStyle(menu) : null;
    const activeStyle = active ? getComputedStyle(active) : null;
    return {
      menuVisible: Boolean(menu?.getBoundingClientRect().width && menu?.getBoundingClientRect().height),
      menuBackground: menuStyle?.backgroundImage || menuStyle?.backgroundColor || '',
      menuShadow: menuStyle?.boxShadow || '',
      activeText: active?.textContent?.trim() || '',
      activeClass: active?.className || '',
      activeBackground: activeStyle?.backgroundImage || activeStyle?.backgroundColor || '',
      activeShadow: activeStyle?.boxShadow || '',
      activeColor: activeStyle?.color || '',
    };
  });

  assert(metrics.menuVisible, 'Context menu should be visible over tiles');
  assert(metrics.menuBackground.includes('gradient'), 'Context menu should use a dense modern surface');
  assert(metrics.menuShadow !== 'none', 'Context menu should keep a visible separation shadow');
  assert(metrics.activeText === 'Открыть', 'Context menu should focus the first action');
  assert(metrics.activeClass.includes('context-menu-item-active'), 'Focused context menu item should get the active class');
  assert(metrics.activeBackground.includes('gradient'), 'Focused context menu item should use an opaque active surface');
  assert(metrics.activeShadow !== 'none', 'Focused context menu item should keep a visible active shadow');
  assert(metrics.activeColor !== 'rgba(255, 255, 255, 0.78)', 'Focused context menu item should increase text contrast');
}

async function smokeTileContainersAndOpenTarget(page, baseUrl) {
  await clearAppData(page, baseUrl);
  await page.locator('[data-testid="add-tile-button"]').first().click();
  await page.locator('[data-testid="add-tile-modal"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid="add-tile-url"]').fill('https://container.example');
  await page.locator('[data-testid="add-tile-title"]').fill('Container Tile');
  await page.waitForFunction(() => !document.querySelector('[data-testid="add-tile-container-trigger"]')?.disabled);
  await page.locator('[data-testid="add-tile-container-trigger"]').click();
  await page.locator('[data-testid="add-tile-container-option"][data-container-id="firefox-container-work"]').click();
  await page.locator('[data-testid="create-tile-button"]').click();
  await page.locator('[data-testid="add-tile-modal"]').waitFor({ state: 'detached' });
  await page.locator('.tile-container-badge').waitFor({ state: 'visible' });

  await page.evaluate(() => { window.__faspOpenedUrls = []; });
  await page.locator('[data-testid="tile-card"][data-tile-type="tile"]').first().click();
  await page.waitForFunction(() => window.__faspOpenedUrls?.length === 1);
  const containerOpen = await page.evaluate(() => window.__faspOpenedUrls[0]);
  assert(containerOpen.kind === 'tab', 'Container tiles should open in a container tab when current tab target is selected');
  assert(containerOpen.cookieStoreId === 'firefox-container-work', 'Container tile should pass the selected cookieStoreId');

  await clearAppData(page, baseUrl);
  await createTile(page, 'Window Tile', 'https://window-target.example');
  await page.evaluate(async () => {
    const result = await window.browser.storage.local.get('fasp-settings');
    await window.browser.storage.local.set({
      'fasp-settings': {
        ...(result['fasp-settings'] || {}),
        tileOpenTarget: 'new-window',
      },
    });
    window.__faspOpenedUrls = [];
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tile-surface-root"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid="tile-card"][data-tile-type="tile"]').first().click();
  await page.waitForFunction(() => window.__faspOpenedUrls?.length === 1);
  const windowOpen = await page.evaluate(() => window.__faspOpenedUrls[0]);
  assert(windowOpen.kind === 'window', 'New window open target should use the windows API');
  assert(windowOpen.url === 'https://window-target.example', 'New window target should keep the tile URL');
}

async function smokeBulkTileAccent(page, baseUrl) {
  await clearAppData(page, baseUrl);
  await createTile(page, 'Accent Alpha', 'https://accent-alpha.example');
  await createTile(page, 'Accent Beta', 'https://accent-beta.example');

  await page.locator('[data-testid="settings-button"]').click();
  await page.locator('[data-testid="settings-modal"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid="settings-section-layout"]').click();
  await page.locator('[data-testid="tile-bulk-color-input"]').scrollIntoViewIfNeeded();
  const bulkApplyButtonMetrics = await page.evaluate(() => {
    const button = document.querySelector('[data-testid="tile-bulk-color-apply"]');
    const style = button ? getComputedStyle(button) : null;
    return {
      backgroundImage: style?.backgroundImage || '',
      borderColor: style?.borderTopColor || '',
      boxShadow: style?.boxShadow || '',
      color: style?.color || '',
      minHeight: style?.minHeight || '',
      paddingLeft: style?.paddingLeft || '',
      paddingRight: style?.paddingRight || '',
    };
  });
  assert(bulkApplyButtonMetrics.backgroundImage.includes('gradient'), 'Bulk accent apply button should use a themed gradient');
  assert(bulkApplyButtonMetrics.borderColor !== 'rgba(0, 0, 0, 0)', 'Bulk accent apply button should have a visible border');
  assert(bulkApplyButtonMetrics.boxShadow !== 'none', 'Bulk accent apply button should have a visible shadow');
  assert(bulkApplyButtonMetrics.color.length > 0, 'Bulk accent apply button should expose readable text color');
  assert(parseFloat(bulkApplyButtonMetrics.minHeight) >= 40, 'Bulk accent apply button should keep comfortable vertical padding');
  assert(
    parseFloat(bulkApplyButtonMetrics.paddingLeft) >= 18 && parseFloat(bulkApplyButtonMetrics.paddingRight) >= 18,
    'Bulk accent apply button should keep comfortable horizontal padding'
  );
  const actionButtonRowMetrics = await page.evaluate(() => {
    const selectors = [
      '[data-testid="tile-bulk-color-apply"]',
      '[data-testid="tile-bulk-color-clear"]',
    ];
    const rects = selectors.map((selector) => document.querySelector(selector)?.getBoundingClientRect());
    const tops = rects.map((rect) => rect?.top ?? NaN);
    return {
      count: rects.filter(Boolean).length,
      topSpread: Math.max(...tops) - Math.min(...tops),
    };
  });
  assert(actionButtonRowMetrics.count === 2, 'Bulk action row should render both color buttons');
  assert(actionButtonRowMetrics.topSpread <= 12, 'Bulk color action buttons should stay in one row on desktop');
  await page.locator('[data-testid="tile-bulk-color-input"]').fill('#22c55e');
  await page.locator('[data-testid="tile-bulk-color-apply"]').click();
  await page.waitForTimeout(100);

  const appliedColors = await page.evaluate(async () => {
    const result = await window.browser.storage.local.get('fasp.grid-state');
    const items = Object.values(result['fasp.grid-state']?.state?.items || {});
    return items.map((item) => item.tileAccentColor);
  });
  assert(appliedColors.length === 2, 'Bulk accent smoke should have two tiles');
  assert(appliedColors.every((color) => color === '#22c55e'), 'Bulk accent should apply the selected color to every tile');

  const renderedAccents = await page.evaluate(() => (
    Array.from(document.querySelectorAll('[data-testid="tile-card"][data-tile-type="tile"]')).map((tile) => ({
      accented: tile.classList.contains('tile-card-accented'),
      accentColor: tile.style.getPropertyValue('--tile-accent-color').trim(),
      hasWash: Boolean(tile.querySelector('.tile-accent-wash')),
      borderColor: getComputedStyle(tile).borderTopColor,
    }))
  ));
  assert(renderedAccents.length === 2, 'Bulk accent should keep both tile cards rendered');
  assert(renderedAccents.every((tile) => tile.accented), 'Bulk accent should mark every rendered tile as accented');
  assert(renderedAccents.every((tile) => tile.accentColor === '#22c55e'), 'Bulk accent should expose the selected color as a CSS variable');
  assert(renderedAccents.every((tile) => tile.hasWash), 'Bulk accent should render a visible accent wash on every tile');

  await page.keyboard.press('Escape');
  await page.locator('[data-testid="settings-modal"]').waitFor({ state: 'detached' });
  await page.locator('[data-testid="add-tile-button"]').first().click();
  await page.locator('[data-testid="add-tile-modal"]').waitFor({ state: 'visible' });
  const inheritedColorCode = await page.locator('[data-testid="add-tile-color-code"]').inputValue();
  assert(inheritedColorCode === '#22C55E', 'New tile dialog should show the predominant tile color as HEX');
  await page.locator('[data-testid="add-tile-url"]').fill('https://accent-gamma.example');
  await page.locator('[data-testid="add-tile-title"]').fill('Accent Gamma');
  await page.locator('[data-testid="create-tile-button"]').click();
  await page.locator('[data-testid="add-tile-modal"]').waitFor({ state: 'detached' });

  const inheritedColors = await page.evaluate(async () => {
    const result = await window.browser.storage.local.get('fasp.grid-state');
    const items = Object.values(result['fasp.grid-state']?.state?.items || {});
    return items.map((item) => item.tileAccentColor);
  });
  assert(inheritedColors.length === 3, 'Bulk accent inheritance smoke should have three tiles');
  assert(inheritedColors.every((color) => color === '#22c55e'), 'New tiles should inherit the predominant tile accent color');
}

async function smokeTileVisualReset(page, baseUrl) {
  await clearAppData(page, baseUrl);
  await page.evaluate(async () => {
    const now = Date.now();
    await window.browser.storage.local.set({
      'fasp.grid-state': {
        schemaVersion: 3,
        state: {
          items: {
            'tile-reset-smoke': {
              id: 'tile-reset-smoke',
              type: 'tile',
              title: 'Styled Tile',
              url: 'https://example.com',
              customImage: 'data:image/png;base64,iVBORw0KGgo=',
              thumbnail: 'https://example.com/tile.png',
              customIcon: 'data:image/png;base64,iVBORw0KGgo=',
              dominantColor: '#604848',
              tileAccentColor: '#604848',
              favicon: 'data:image/png;base64,iVBORw0KGgo=',
              faviconUpdatedAt: now,
              glassmorphism: false,
              borderRadius: 28,
              opacity: 0.42,
              createdAt: now,
              updatedAt: now,
              order: 0,
            },
            'folder-reset-smoke': {
              id: 'folder-reset-smoke',
              type: 'folder',
              title: 'Styled Folder',
              childrenIds: [],
              customImage: 'data:image/png;base64,iVBORw0KGgo=',
              thumbnail: 'https://example.com/folder.png',
              customIcon: 'data:image/png;base64,iVBORw0KGgo=',
              dominantColor: '#604848',
              tileAccentColor: '#604848',
              favicon: 'data:image/png;base64,iVBORw0KGgo=',
              faviconUpdatedAt: now,
              glassmorphism: false,
              borderRadius: 28,
              opacity: 0.42,
              createdAt: now,
              updatedAt: now,
              order: 0,
            },
          },
          containers: {
            root: {
              id: 'root',
              title: 'Root',
              childrenIds: ['tile-reset-smoke', 'folder-reset-smoke'],
              createdAt: now,
              updatedAt: now,
            },
            'folder-reset-smoke': {
              id: 'folder-reset-smoke',
              title: 'Styled Folder',
              parentId: 'root',
              childrenIds: [],
              createdAt: now,
              updatedAt: now,
            },
          },
          rootContainerId: 'root',
          currentContainerId: 'root',
          containerStack: ['root'],
          dragState: null,
        },
      },
    });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tile-surface-root"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid="settings-button"]').click();
  await page.locator('[data-testid="settings-modal"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid="settings-section-layout"]').click();
  await page.locator('[data-testid="tile-visual-reset"]').click();
  await page.locator('text=Плитки возвращены к стандартному виду').waitFor({ state: 'visible' });

  const { tile, folder } = await page.evaluate(async () => {
    const result = await window.browser.storage.local.get('fasp.grid-state');
    const items = result['fasp.grid-state']?.state?.items || {};
    return {
      tile: items['tile-reset-smoke'],
      folder: items['folder-reset-smoke'],
    };
  });
  for (const item of [tile, folder]) {
    assert(item, 'Tile visual reset smoke should keep every item');
    assert(item.customImage === undefined, 'Tile visual reset should clear custom images');
    assert(item.thumbnail === undefined, 'Tile visual reset should clear thumbnails');
    assert(item.customIcon === undefined, 'Tile visual reset should clear custom icons');
    assert(item.dominantColor === undefined, 'Tile visual reset should clear dominant color');
    assert(item.tileAccentColor === undefined, 'Tile visual reset should clear tile accent color');
    assert(item.favicon === undefined, 'Tile visual reset should clear cached favicons');
    assert(item.faviconUpdatedAt === undefined, 'Tile visual reset should clear favicon timestamps');
    assert(item.glassmorphism === undefined, 'Tile visual reset should return to theme glass setting');
    assert(item.borderRadius === undefined, 'Tile visual reset should clear custom radius');
    assert(item.opacity === undefined, 'Tile visual reset should clear custom opacity');
  }
}

async function smokeStartupBackgroundHydration(page, baseUrl) {
  await clearAppData(page, baseUrl);
  await page.addInitScript(() => {
    window.__faspBackgroundKindsAfterReady = [];
    const recordBackgroundKind = () => {
      if (document.documentElement.dataset.faspVisualReady !== 'true') return;
      const kind = document.querySelector('[data-testid="background-layer"]')?.getAttribute('data-background-kind');
      if (kind) window.__faspBackgroundKindsAfterReady.push(kind);
    };
    const installObserver = () => {
      if (!document.documentElement) {
        setTimeout(installObserver, 0);
        return;
      }
      const observer = new MutationObserver(recordBackgroundKind);
      observer.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    };
    installObserver();
    document.addEventListener('DOMContentLoaded', () => {
      requestAnimationFrame(recordBackgroundKind);
    }, { once: true });
  });

  const assetId = 'asset_smoke_static_wallpaper';
  await putMediaAsset(page, assetId);
  await page.evaluate(async (staticImageAssetId) => {
    const theme = {
      schemaVersion: 1,
      engineVersion: '1.0.0',
      id: 'smoke-static-theme',
      name: 'Smoke Static Theme',
      colors: {
        accent: '#f97316',
        accent2: '#22d3ee',
        text: '#f8fafc',
        mutedText: 'rgba(248, 250, 252, 0.52)',
        surface: 'rgba(255, 255, 255, 0.08)',
        surfaceStrong: 'rgba(15, 23, 42, 0.86)',
        border: 'rgba(255, 255, 255, 0.14)',
        danger: '#fb7185',
      },
      glass: { enabled: true, blur: 18, opacity: 0.88, saturation: 140 },
      tiles: { radius: 20, opacity: 0.9, shadow: 'deep', hoverScale: 1.03 },
      layout: { spacing: 12 },
      background: {
        style: 'static',
        staticImageAssetId,
        gradient: 'linear-gradient(135deg, #05070d, #101827)',
      },
      animation: { speed: 'normal' },
      font: { family: 'system' },
    };
    await window.browser.storage.local.set({
      'fasp-theme-engine': {
        schemaVersion: 1,
        activeThemeId: theme.id,
        customThemes: [theme],
      },
    });
  }, assetId);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tile-surface-root"]').waitFor({ state: 'visible' });

  const metrics = await page.evaluate(() => ({
    visualReady: document.documentElement.dataset.faspVisualReady,
    themeBackground: document.documentElement.dataset.faspThemeBackground,
    backgroundKind: document.querySelector('[data-testid="background-layer"]')?.getAttribute('data-background-kind'),
    backgroundKindsAfterReady: window.__faspBackgroundKindsAfterReady || [],
    bootScreenCount: document.querySelectorAll('.app-boot-screen').length,
    canvasCount: document.querySelectorAll('canvas[data-testid="background-layer"]').length,
  }));

  assert(metrics.visualReady === 'true', 'Startup should mark visual hydration as ready');
  assert(metrics.themeBackground === 'static', 'Startup should apply the persisted static theme before rendering');
  assert(metrics.backgroundKind === 'theme-static', 'Startup should render the persisted static theme background');
  assert(metrics.bootScreenCount === 0, 'Startup boot screen should be removed after hydration');
  assert(metrics.canvasCount === 0, 'Static theme startup should not render a generative canvas fallback');
  assert(
    metrics.backgroundKindsAfterReady.every((kind) => kind === 'theme-static'),
    `Only the final static theme background should appear after visual ready. Saw: ${metrics.backgroundKindsAfterReady.join(', ')}`
  );

  await clearAppData(page, baseUrl);
  const configAssetId = 'asset_smoke_config_static_wallpaper';
  await putMediaAsset(page, configAssetId);
  await page.evaluate(async (staticImageAssetId) => {
    await window.browser.storage.local.set({
      'fasp-theme-engine': {
        schemaVersion: 1,
        activeThemeId: 'fasp-default',
        customThemes: [],
      },
      'fasp-background': {
        mode: 'static',
        staticImageAssetId,
        generativeType: 'reaction-diffusion',
        animationEnabled: true,
        fpsLimit: 30,
        blur: 1,
        brightness: 0.8,
      },
    });
  }, configAssetId);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tile-surface-root"]').waitFor({ state: 'visible' });

  const configMetrics = await page.evaluate(() => ({
    visualReady: document.documentElement.dataset.faspVisualReady,
    themeBackground: document.documentElement.dataset.faspThemeBackground,
    backgroundKind: document.querySelector('[data-testid="background-layer"]')?.getAttribute('data-background-kind'),
    backgroundKindsAfterReady: window.__faspBackgroundKindsAfterReady || [],
    bootScreenCount: document.querySelectorAll('.app-boot-screen').length,
    canvasCount: document.querySelectorAll('canvas[data-testid="background-layer"]').length,
  }));

  assert(configMetrics.visualReady === 'true', 'Config static startup should mark visual hydration as ready');
  assert(configMetrics.themeBackground === 'current', 'Config static startup should keep the theme background in current mode');
  assert(configMetrics.backgroundKind === 'config-static', 'Config static startup should render the persisted static background');
  assert(configMetrics.bootScreenCount === 0, 'Config static startup boot screen should be removed after hydration');
  assert(configMetrics.canvasCount === 0, 'Config static startup should not render a generative canvas fallback');
  assert(
    configMetrics.backgroundKindsAfterReady.every((kind) => kind === 'config-static'),
    `Only the final config static background should appear after visual ready. Saw: ${configMetrics.backgroundKindsAfterReady.join(', ')}`
  );
}

async function smokeProfileTransfer(page, baseUrl) {
  await clearAppData(page, baseUrl);
  const assetId = 'asset_smoke_profile_wallpaper';
  await putMediaAsset(page, assetId);
  await page.evaluate(async (staticImageAssetId) => {
    await window.browser.storage.local.set({
      'fasp-settings': {
        showSearchBar: true,
        showClock: true,
        showWeather: false,
        weatherLocation: '',
        weatherDisplayMode: 'inline',
        searchBarWidth: 72,
        searchResultLimit: 25,
        bookmarkFolderMode: 'clone',
        showFolderItemCount: true,
        showFolderModeBadge: true,
        tileVisualMode: 'mixed',
        tileLabelMode: 'full',
        folderViewMode: 'list',
        contextMenuFocusMode: 'always',
      },
      'fasp-layout': {
        columns: 9,
        folderColumns: 7,
        spacing: 18,
      },
      'fasp-background': {
        mode: 'static',
        staticImageAssetId,
        generativeType: 'aurora',
        animationEnabled: false,
        fpsLimit: 24,
        blur: 2,
        brightness: 0.9,
      },
    });
  }, assetId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tile-surface-root"]').waitFor({ state: 'visible' });
  await createTile(page, 'Profile Alpha', 'https://profile-alpha.example');
  await createTile(page, 'Profile Beta', 'https://profile-beta.example');

  await page.locator('[data-testid="settings-button"]').click();
  await page.locator('[data-testid="settings-modal"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid="settings-section-sync"]').click();
  await page.locator('[data-testid="profile-export-button"]').waitFor({ state: 'visible' });
  await page.evaluate(() => {
    window.__faspExportedProfileText = '';
    window.__faspExportedProfileName = '';
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob && blob.type === 'application/json') {
        void blob.text().then((text) => {
          window.__faspExportedProfileText = text;
        });
      }
      return originalCreateObjectURL(blob);
    };
    HTMLAnchorElement.prototype.click = function clickProfileAnchor() {
      window.__faspExportedProfileName = this.download || '';
    };
  });
  await page.locator('[data-testid="profile-export-button"]').click();
  await page.waitForFunction(() => Boolean(window.__faspExportedProfileText));

  const exported = await page.evaluate(() => ({
    name: window.__faspExportedProfileName,
    text: window.__faspExportedProfileText,
    parsed: JSON.parse(window.__faspExportedProfileText),
  }));
  assert(exported.name.endsWith('.json'), 'Profile export should use a JSON filename');
  assert(exported.parsed.profile === 'adaptive-start-page', 'Profile export should mark the profile format');
  assert(exported.parsed.data.background.staticImageAssetId === assetId, 'Profile export should include the saved wallpaper reference');
  assert(exported.parsed.mediaAssets.length === 1, 'Profile export should include referenced media assets');
  assert(Object.keys(exported.parsed.data.tiles.state.items).length === 2, 'Profile export should include current tiles');

  await page.evaluate(async () => {
    const now = Date.now();
    await window.browser.storage.local.set({
      'fasp-settings': { showClock: false },
      'fasp-layout': { columns: 2, folderColumns: 2, spacing: 4 },
      'fasp-background': { mode: 'generative', animationEnabled: true, fpsLimit: 30, blur: 0, brightness: 1 },
      'fasp.grid-state': {
        schemaVersion: 3,
        state: {
          items: {},
          containers: {
            root: {
              id: 'root',
              title: 'Root',
              childrenIds: [],
              createdAt: now,
              updatedAt: now,
            },
          },
          rootContainerId: 'root',
          currentContainerId: 'root',
          containerStack: ['root'],
          dragState: null,
        },
      },
    });
  });

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-testid="profile-import-input"]').setInputFiles({
    name: 'adaptive-start-page-profile-smoke.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exported.text, 'utf8'),
  });
  await page.locator('text=Профиль импортирован').waitFor({ state: 'visible' });

  const restored = await page.evaluate(async () => {
    const data = await window.browser.storage.local.get([
      'fasp-settings',
      'fasp-layout',
      'fasp-background',
      'fasp.grid-state',
    ]);
    const state = data['fasp.grid-state']?.state;
    return {
      showClock: data['fasp-settings']?.showClock,
      folderViewMode: data['fasp-settings']?.folderViewMode,
      columns: data['fasp-layout']?.columns,
      folderColumns: data['fasp-layout']?.folderColumns,
      staticImageAssetId: data['fasp-background']?.staticImageAssetId,
      currentContainerId: state?.currentContainerId,
      titles: Object.values(state?.items || {}).map((item) => item.title).sort(),
    };
  });
  assert(restored.showClock === true, 'Profile import should restore settings');
  assert(restored.folderViewMode === 'list', 'Profile import should restore layout-related settings');
  assert(restored.columns === 9 && restored.folderColumns === 7, 'Profile import should restore layout config');
  assert(restored.staticImageAssetId === assetId, 'Profile import should restore wallpaper asset references');
  assert(restored.currentContainerId === 'root', 'Profile import should keep grid navigation reset to root');
  assert(
    restored.titles.join(',') === 'Profile Alpha,Profile Beta',
    `Profile import should restore tile titles. Saw: ${restored.titles.join(',')}`
  );
}

async function smokeAdaptiveControlContrast(page, baseUrl) {
  await clearAppData(page, baseUrl);
  await page.locator('[data-testid="settings-button"]').click();
  await page.locator('[data-testid="settings-modal"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid="settings-section-advanced"]').click();
  await page.locator('[data-testid="adaptive-control-contrast-toggle"]').waitFor({ state: 'visible' });

  const initial = await page.evaluate(() => document.documentElement.dataset.faspControlContrast);
  assert(initial === 'off', 'Adaptive control contrast should be off by default');

  await page.locator('[data-testid="adaptive-control-contrast-toggle"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.faspControlContrast === 'on');

  const metrics = await page.evaluate(async () => {
    const settings = await window.browser.storage.local.get('fasp-settings');
    const switchElement = document.querySelector('[data-testid="adaptive-control-contrast-toggle"]');
    const report = document.querySelector('.settings-contrast-report');
    const styles = switchElement ? getComputedStyle(switchElement) : null;
    return {
      saved: settings['fasp-settings']?.adaptiveControlContrast,
      mode: document.documentElement.dataset.faspControlContrast,
      reason: document.documentElement.dataset.faspControlContrastReason,
      reportVisible: Boolean(report),
      borderColor: styles?.borderTopColor || '',
      boxShadow: styles?.boxShadow || '',
    };
  });

  assert(metrics.saved === true, 'Adaptive control contrast should be saved in settings');
  assert(metrics.mode === 'on', 'Adaptive control contrast should mark the document root');
  assert(metrics.reason && metrics.reason !== 'disabled', 'Adaptive control contrast should expose an analysis reason');
  assert(metrics.reportVisible, 'Adaptive control contrast should show the analysis report');
  assert(metrics.borderColor !== 'rgba(0, 0, 0, 0)', 'Adaptive control contrast switch should have a visible border');
  assert(metrics.boxShadow !== 'none', 'Adaptive control contrast switch should have a visible shadow');
}

async function expectCount(locator, expected, message) {
  const count = await locator.count();
  assert(count === expected, `${message}. Expected ${expected}, got ${count}`);
}

async function main() {
  assert(existsSync(viteBin), `Vite binary not found at ${viteBin}`);
  const { chromium } = loadPlaywright();
  await run(process.execPath, [viteBin, 'build'], 'vite build');
  smokeManifestPermissions();

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let preview;
  let browser;
  try {
    preview = startPreview(port);
    preview.stdout.on('data', () => {});
    preview.stderr.on('data', (chunk) => process.stderr.write(chunk));
    await waitForServer(`${baseUrl}/newtab.html`, preview);
    browser = await launchChromium(chromium);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 820 },
      reducedMotion: 'reduce',
    });
    await context.addInitScript(browserMockScript);

    const page = await context.newPage();
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (text.startsWith('Failed to load resource:')) return;
      failures.push(text);
    });

    await smokeDnd(page, baseUrl);
    await smokeCustomTileIcon(page, baseUrl);
    await smokeReferenceClone(page, baseUrl);
    await smokeThemeEngine(page, baseUrl);
    await smokeLayoutSettings(page, baseUrl);
    await smokeStartupFolderState(page, baseUrl);
    await smokeTileTitleTooltip(page, baseUrl);
    await smokeContextMenuReadability(page, baseUrl);
    await smokeTileContainersAndOpenTarget(page, baseUrl);
    await smokeBulkTileAccent(page, baseUrl);
    await smokeTileVisualReset(page, baseUrl);
    await smokeAdaptiveControlContrast(page, baseUrl);
    await smokeStartupBackgroundHydration(page, baseUrl);
    await smokeProfileTransfer(page, baseUrl);

    assert(failures.length === 0, `Browser errors during smoke run:\n${failures.join('\n')}`);
    console.log('Smoke tests passed: Manifest Permissions, DnD, Custom Tile Icon, Reference/Clone, Theme Engine, Layout Settings, Startup Folder State, Tile Title Tooltip, Context Menu Readability, Tile Containers/Open Target, Bulk Tile Accent, Tile Visual Reset, Adaptive Control Contrast, Startup Background Hydration, Profile Transfer');
  } finally {
    if (browser) await browser.close();
    await stopPreview(preview);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
