# Adaptive Start Page updates

This folder is intended for GitHub Pages hosting.

For self-distributed Firefox builds, the extension can point
`browser_specific_settings.gecko.update_url` to:

```text
https://virvzz.github.io/firefox-adaptive-start-page/updates.json
```

After Mozilla signs a new `.xpi`, upload the signed file to GitHub Releases and
add its HTTPS download URL to `updates.json`.
