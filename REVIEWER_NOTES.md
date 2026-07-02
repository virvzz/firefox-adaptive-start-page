# Reviewer notes

Adaptive Start Page is a local new tab extension. It does not collect or transmit
personal data.

The extension uses React 19 and react-dom for rendering. The AMO validator may
report warnings for `innerHTML` inside the bundled React DOM runtime. The project
source does not use `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, or
`insertAdjacentHTML` in application code.

No test account is required. All extension data is stored locally in browser
storage or IndexedDB.
