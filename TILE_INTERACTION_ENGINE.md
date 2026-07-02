# Unified Grid Item Engine

## Product Vision

Homepage OS replaces the standard Firefox new tab page with a local visual OS.

The user works with a grid of objects. An object can be a link tile or a
folder. A folder is a container. Root and folder contents must feel like the
same place rendered at different paths, not like two different components.

## Domain Model

Any object in a grid is a `GridItem`.

```ts
type GridItem = LinkTile | Folder
```

Every item has:

- `id`
- `type`
- `title`
- `createdAt`
- `updatedAt`

Link tiles add URL/preview fields. Folders add `childrenIds` for preview and
compatibility, but the source of truth for ordering is the matching
`Container.childrenIds`.

## Containers

Root and every folder are containers.

```ts
interface Container {
  id: string
  title: string
  childrenIds: string[]
}
```

`root` is the root container. A folder item uses its own id as its container id.

The grid does not read item `position` as source of truth. Reorder mutates the
container's `childrenIds` array.

## State Architecture

The single store owns:

- `items: Record<string, GridItem>`
- `containers: Record<string, Container>`
- `currentContainerId`
- `containerStack`
- `dragState`

Existing React grid components receive a derived `tiles[]` view for compatibility.
That view includes `parentId` and `order`, but those fields are not persisted as
the canonical ordering model.

## Drag State

Drag is modeled as a state machine:

- `idle`
- `pressing`
- `dragging`
- `hovering-target`
- `drop`

Only one intent may be active:

- `reorder`
- `create-folder`
- `move-between-containers`
- `extract-from-folder`
- `idle`

The current @dnd-kit surface still owns pointer event callbacks, but intent
resolution is centralized in `surfaceInteractionEngine.ts`.

## Interaction Zones

The target item is evaluated against stable rects captured at drag start.

- `center-zone`: create folder or move into folder.
- `edge-zone`: reorder.
- `outside`: no usable target.

Active folder intents use hysteresis so DOM transforms do not make the intent
flicker.

## Folder Creation Priority

Folder creation has priority over temporary reordering.

When a dragged tile enters another tile's stable bounds and has not crossed the
reorder threshold, the surface starts a `300ms` hover timer. During this pending
period:

- layout sorting is locked.
- placeholder position is locked.
- the target tile remains in place.
- no reorder operation may be committed.

If the hover survives for the full delay, `intent = create-folder` becomes
active and the folder preview is shown. Releasing while that preview is active
commits `createFolder(sourceId, targetId)` immediately.

If the cursor leaves the target bounds, the target changes, or the cursor moves
into the reorder threshold/edge zone, the hover is cancelled and reorder becomes
available again.

## Commit Rules

- `create-folder`: create a folder in the current container, replace the two
  source tiles with that folder, and set the folder container children to
  `[targetId, sourceId]`.
- `move-between-containers`: remove item id from source container and append it
  to destination container.
- `extract-from-folder`: move item id from current folder container to parent
  container.
- `reorder`: reorder `Container.childrenIds`; never do direct pairwise swap.

## Folder Visual Representation

A folder is a first-class grid item. The folder tile itself is the folder visual.

The UI must not render a nested folder icon inside a tile. Child previews are
rendered directly inside the folder tile:

- 1 child: single preview.
- 2-4 children: 2x2 preview grid.
- 5+ children: first 4 previews.

Folder tiles use folder-specific background, border, depth, and shadow. They do
not require a separate folder glyph to be identifiable.

## Persistence

Canonical grid state is persisted through `browser.storage.local`.

```ts
interface PersistedState {
  schemaVersion: number
  state: AppState
}
```

Current schema: `1`.

Legacy IndexedDB tile data is read once as a migration source and converted to
`AppState`.

## Bookmarks Integration

The extension imports Firefox bookmark toolbar contents into the grid:

- bookmarks become `type: "tile"` items with `source: "bookmark"`.
- bookmark folders become `type: "folder"` items and containers.
- nested bookmark folders are supported.
- background bookmark events trigger a merge sync for imported bookmark items.

Manual items are preserved when bookmark sync runs.

## Firefox Extension Layer

The extension uses Manifest V3, React, TypeScript, Vite, and
`chrome_url_overrides.newtab`.

Required permissions:

- `bookmarks`
- `storage`
- `unlimitedStorage`
- `topSites`
- `sessions`

The page runs locally without a server.
