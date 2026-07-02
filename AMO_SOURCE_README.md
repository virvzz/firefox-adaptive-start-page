# Adaptive Start Page source package

This source package is provided for Mozilla Add-ons review.

## Build environment

- Node.js 20 or newer
- npm 10 or newer

## Build steps

```powershell
npm.cmd ci
npm.cmd run build
```

The production extension is generated in `dist/`. The upload package is made from
the contents of `dist/`, with `manifest.json` at the archive root.

For a self-distributed package with automatic updates, the release script injects
`browser_specific_settings.gecko.update_url` into the packaged manifest when the
`FASP_UPDATE_URL` environment variable is set:

```powershell
$env:FASP_UPDATE_URL = 'https://your-domain.example/fasp/updates.json'
npm.cmd run release:package
```

## Project notes

- The extension uses React, TypeScript, Vite, Tailwind CSS, Zustand, idb, and dnd-kit.
- The production JavaScript is bundled and minified by Vite.
- No build-time secrets are required.
- The extension targets Firefox Desktop 142.0 and newer. Firefox for Android is not declared in
  `browser_specific_settings` because the new tab override and bookmark APIs used
  by this project are not supported there.
