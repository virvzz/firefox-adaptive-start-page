# Reviewer notes

Adaptive Start Page is a local new tab extension. It does not use analytics,
advertising, telemetry, tracking pixels, or a developer-operated backend.

By default the extension makes no network requests for tile artwork: tiles are
rendered locally from a letter monogram and accent color. The user can opt in to
"online previews" in settings; the toggle explains that tile/bookmark URLs will
be sent to the external preview services (WordPress mShots, Google Favicons,
thum.io) that render the thumbnails and favicons. The optional weather widget
(also off by default) fetches from wttr.in, the only host in
`host_permissions`.

The manifest declares no required data transmission at install time
(`required: ["none"]`) and declares these transmissions as optional Firefox data
collection permissions:

- `browsingActivity` and `bookmarksInfo` for online tile/bookmark preview URLs.
- `locationInfo` for the optional wttr.in weather widget.

Enabling either feature calls `browser.permissions.request({ data_collection:
[...] })` from the user-activated settings toggle. If consent is not granted,
the setting remains disabled and no external request is enabled by the setting.
The extension targets Firefox Desktop 142.0+, so it uses Firefox's built-in data
collection consent experience.

The extension uses React 19 and react-dom for rendering. The release build
disables React DOM's unused `<script>` and `dangerouslySetInnerHTML` runtime
branches so the bundled file does not assign to `innerHTML`. The project source
does not use `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, or
`insertAdjacentHTML` in application code.

No test account is required. All extension data is stored locally in browser
storage or IndexedDB.

The `cookies` permission is used only to pass `cookieStoreId` to
`browser.tabs.create()` / `browser.windows.create()` when the user assigns a
Firefox container to a tile. The extension does not read, write, collect, or
transmit cookies.
