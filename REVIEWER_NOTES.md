# Reviewer notes

Adaptive Start Page is a local new tab extension. It does not collect or transmit
personal data.

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
