# Release and AMO signing

This project can be submitted to Mozilla Add-ons as an unlisted/self-distributed
extension. The signed `.xpi` can then be installed in Firefox Release or Beta as a
normal persistent extension.

## Package locally

Without automatic updates:

```powershell
npm.cmd run release:package
```

With automatic updates for a self-distributed build:

```powershell
$env:FASP_UPDATE_URL = 'https://your-domain.example/fasp/updates.json'
npm.cmd run release:package
```

For the GitHub Pages setup in this repository, use:

```powershell
$env:FASP_UPDATE_URL = 'https://virvzz.github.io/firefox-adaptive-start-page/updates.json'
npm.cmd run release:package
```

The script creates:

- `release/firefox-adaptive-start-page-<version>-unlisted.zip`
- `release/firefox-adaptive-start-page-<version>-source.zip`

Upload the `unlisted.zip` file to AMO. If AMO asks for source code, upload the
`source.zip` file.

If you run the command from Command Prompt or a shell where npm scripts are not
blocked, `npm run release:package` works too.

## Self-distributed updates

For self-distribution, Firefox reads update information from the URL stored in
`browser_specific_settings.gecko.update_url`. The release script injects this
field into the AMO upload archive only when `FASP_UPDATE_URL` is set.

The update URL must be a stable HTTPS URL that hosts a JSON update manifest. After
AMO signs a new `.xpi`, upload that signed file somewhere under HTTPS and update
the JSON manifest using `updates-template.json` as the starting point.

## AMO flow

1. Open Mozilla Add-ons Developer Hub.
2. Choose Submit a New Add-on.
3. Choose self-distribution / unlisted / On your own.
4. Upload `release/firefox-adaptive-start-page-<version>-unlisted.zip`.
5. Address validation warnings if there are any.
6. Upload the source package if requested.
7. Download the signed `.xpi` from AMO and install it in Firefox.

## Important

- Keep the extension ID stable: `@firefox-adaptive-start-page`.
- Increment `version` in `public/manifest.json` and `package.json` before each new
  AMO upload.
- The archive uploaded to AMO must contain `manifest.json` at the archive root,
  not inside a `dist/` folder.
