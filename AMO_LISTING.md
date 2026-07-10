# AMO Listing Draft

## Summary

A customizable Firefox new tab with local tiles, folders, themes, backgrounds,
bookmarks, and optional widgets.

## Description

Adaptive Start Page replaces Firefox's new tab page with a customizable local
dashboard. It supports tiles, folders, Firefox bookmark folders, manual icons,
theme presets, generated backgrounds, keyboard navigation, local profile
import/export, and optional search widgets for bookmarks and open tabs.

Privacy-focused defaults are used: online thumbnails, site icons, and weather
are off until the user enables them. With online services disabled, tiles are
rendered locally from a letter and color. When online thumbnails/site icons are
enabled, tile and bookmark URLs are requested from external preview services
(WordPress mShots, Google Favicons, and thum.io). When weather is enabled, the
configured weather location is requested from wttr.in.

## Suggested Categories

- Appearance
- Bookmarks

## Permissions Rationale

- `bookmarks`: import, search, display, and optionally sync Firefox bookmark
  folders as tiles.
- `tabs`: open tiles and focus existing open tabs from the local search widget.
- `sessions`: show and restore recently closed tabs when that widget is enabled.
- `topSites`: offer optional popular-site shortcuts.
- `contextualIdentities`: list Firefox containers for container-specific tiles.
- `cookies`: pass `cookieStoreId` when opening container tabs/windows. The
  extension does not read or transmit cookie values.
- `storage`: store settings, tiles, themes, and profile data locally.
- `host_permissions` for `https://wttr.in/*`: fetch optional weather data only
  when the weather widget is enabled.

## Optional Data Permissions

- `browsingActivity`: tile URLs/domains are sent to external preview services
  only if online thumbnails/site icons are enabled.
- `bookmarksInfo`: bookmark tile URLs/domains are sent to external preview
  services only if online thumbnails/site icons are enabled.
- `locationInfo`: the configured weather location is sent to wttr.in only if the
  weather widget is enabled.

## Screenshots To Prepare

- Main tile grid with local letter/color previews.
- Settings page showing online preview disclosure.
- Theme/background customization.
- Folder view and keyboard preview.
