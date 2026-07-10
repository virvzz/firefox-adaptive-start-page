# Adaptive Start Page

Adaptive Start Page is a Firefox new tab extension with customizable tiles,
folders, themes, generated backgrounds, local profile import/export, and
bookmarks integration.

## Mozilla Add-ons source review

This repository contains the human-written project source, package metadata,
build script, tests, and review notes. Third-party dependencies are not bundled;
install them with `npm ci`.

### Build environment

Tested environment:

- Windows 10/11
- Windows PowerShell 5.1 or newer
- Node.js 20 or newer
- npm 10 or newer

The project itself is a Vite/TypeScript web extension and can be built on other
operating systems, but the included release packaging script is written for
PowerShell. On Linux or macOS, install PowerShell 7 and run the same script from
a PowerShell session.

### Install required tools

1. Install Node.js 20 LTS or newer from https://nodejs.org/
2. Confirm the installed versions:

```powershell
node --version
npm --version
powershell -Version
```

3. Install the locked dependency tree:

```powershell
npm.cmd ci
```

### Build the exact submitted extension package

For self-distribution signing, run this from the source package root:

```powershell
$env:FASP_UPDATE_URL = 'https://virvzz.github.io/firefox-adaptive-start-page/updates.json'
npm.cmd run release:package
```

For a future public/listed AMO submission, build the listed package instead.
This package intentionally does not inject `update_url`, because AMO manages
updates for listed add-ons:

```powershell
npm.cmd run release:package:listed
```

The script performs all required build and packaging steps:

1. Runs `vite build`.
2. Copies the production extension files from `dist/`.
3. Injects `browser_specific_settings.gecko.update_url` into the packaged
   manifest only for self-distributed/unlisted builds when `FASP_UPDATE_URL` is
   set.
4. Creates the AMO upload archive with forward-slash zip entry names.
5. Creates a matching source archive for review.

Expected output files:

```text
release/adaptive-start-page-<version>-unlisted.zip
release/adaptive-start-page-<version>-listed.zip
release/adaptive-start-page-<version>-source.zip
```

The `*-unlisted.zip` file is the extension package submitted for
self-distribution signing. The `*-listed.zip` file is for a future public AMO
listing.

### Optional verification

```powershell
npm.cmd run build
node.exe .\tests\smoke.mjs
```

The smoke test builds the extension, starts a local Vite preview server, and
checks the main new-tab workflows in a browser. It requires Playwright: either
install it locally (`npm i -D playwright`), or point `FASP_PLAYWRIGHT_PATH` at
an existing playwright package (or `FASP_NODE_MODULES_PATH` at a node_modules
directory that contains one).

### Project notes

- The extension uses React 19, TypeScript, Vite, Tailwind CSS, Zustand, idb, and
  dnd-kit.
- The production JavaScript is bundled and minified by Vite.
- No build-time secrets, API keys, remote code, or private services are required.
- By default no tile URLs leave the browser: previews are rendered locally.
  Online thumbnails/favicons and the weather widget are opt-in settings that
  request Firefox optional data-collection consent before enabling.
- The extension targets Firefox Desktop 142.0 and newer. Firefox for Android is
  not declared in `browser_specific_settings` because the new tab override and
  bookmark APIs used by this project are not supported there.
