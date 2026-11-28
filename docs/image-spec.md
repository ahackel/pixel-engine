# Images: one format, one editor

Status: **draft, agreed in an interview on 2026-11-28; not implemented yet.** Open points are listed at the end.

Today hand-drawn pixel pictures live in several places and formats: the 9×9 icons in `ui/icons.json` (+ a game's
`src/content/icons.json`), the game's bag and ground pictures as letter rows with hex legends inside TypeScript
(`src/things.ts`, `fire.ts`, `fishing.ts`, `pictures.ts`), wardrobe items drawn by the model in
`engine/character/data/sprite-*.json`, and the eyes, mouths and brows in `face-shapes.json`. Each has its own editor or none.

This spec replaces them with **one image format** (indexed PNG sprite sheets with a JSON atlas) and **one editor**
(`tools/images`, replacing `tools/icons`) that lists and edits every image of the game.

**Every bitmap that is saved is saved as a sheet.** Besides the images above, that covers the pixels other tools save:
the parts editor's hand edits to wardrobe items, the props tool's painted and frozen props, and the walls tool's painted
walls. Those tools keep their own editing pages; only the way they store pixels changes (see *Bitmaps other tools save*).

Out of scope: things drawn by rules and saved as rules, not pixels (plants, animals, objects, terrain, rule-built walls,
wardrobe items in the `recipe` and `shell` formats). They are only bitmaps once they are drawn, and are not saved that way.

## Goals

- Small files and fast loading.
- A standard format that other tools can open and preview: macOS Preview and Finder, Aseprite, a browser, GitHub.
- Future-proof: nothing that only this code can read.
- Named colours, so one change to the palette changes every image that uses it, and so the game can swap colours at runtime
  (a player's clothes).
- Many small images per file (sprite sheets), not one file each.

## The format

A **sheet** is two files with the same name side by side:

```
icons.png    8-bit indexed PNG: every image of the sheet, packed
icons.json   the atlas: where each image is, its frames, points and named colours
```

### The PNG

- Colour type 3 (indexed), bit depth 8, one `PLTE` of at most 256 entries for the whole sheet, a `tRNS` chunk making
  **index 0 fully transparent**. Every other index is opaque.
- No other chunks are needed or read. Anything else in the file is ignored and not kept when the editor saves.
- Each palette entry holds the colour that index shows **today**. Other tools show the sheet correctly from that alone.
  For a named slot (below) the game ignores the stored colour and uses the palette's current colour for that name. The
  editor writes the current colour on every save, so the PNG stays a true preview.

### The atlas JSON

It uses the "hash" layout that Aseprite and TexturePacker write, so their readers understand the parts they know, with this
format's additions under `meta`.

```jsonc
{
  "frames": {
    // one entry per frame: "<image> <frame>", frames counted from 0
    "torch 0": { "frame": { "x": 0, "y": 0, "w": 7, "h": 9 }, "duration": 125 },
    "torch 1": { "frame": { "x": 7, "y": 0, "w": 7, "h": 9 }, "duration": 125 },
    "coconut 0": { "frame": { "x": 14, "y": 0, "w": 8, "h": 6 }, "duration": 100 }
  },
  "meta": {
    "app": "pixel-engine images",
    "version": "1",
    "image": "items.png",
    "format": "I8",
    "size": { "w": 64, "h": 32 },
    // which palette the names below come from: "game" or "editor"
    "palette": "game",
    // one tag per image: its frames, in order
    "frameTags": [
      { "name": "torch", "from": 0, "to": 1, "direction": "forward" },
      { "name": "coconut", "from": 2, "to": 2, "direction": "forward" }
    ],
    // points of an image, in its frame's own pixels (same in every frame)
    "slices": [
      { "name": "torch/foot", "keys": [{ "frame": 0, "bounds": { "x": 3, "y": 8, "w": 1, "h": 1 } }] },
      { "name": "torch/fx", "keys": [{ "frame": 0, "bounds": { "x": 3, "y": 0, "w": 1, "h": 1 } }] }
    ],
    // ---- this format's own additions ----
    // palette index -> named colour; indices not listed keep the PNG's own colour (a fixed hex)
    "names": { "1": "wood", "2": "wood-", "3": "wood+", "7": "coconut" },
    // per image: the data the game needs besides pixels (kept as is by the editor, shown as fields where it knows them)
    "images": {
      "torch": { "fps": 8, "data": { "hold": "pole" } },
      "coconut": { "fps": 0, "data": { "pick": [5, 2] } }
    }
  }
}
```

Rules:

- **Every image is a horizontal strip of frames of one size.** Frame *n* lies right of frame *n − 1* in the sheet.
  The atlas still lists every frame's rectangle, so readers don't need to know this.
- An image's name is unique in its sheet: lower case letters, digits and `-`. Frame keys are `"<name> <n>"`.
- `duration` (ms per frame) is written for other tools and comes from `images.<name>.fps` (0 or a single frame: 100).
- Points are 1×1 slices named `<image>/<point>`, with one key at frame 0 (they hold for every frame). Known points:
  `foot` (where it stands on the ground: the pivot), `fx` (where a particle system is attached). The editor can add others
  by name. An image with no `foot` stands at its bottom middle.
- `meta.names` is the only place names live. Pixels only store indices.
- What the game must not lose but the format doesn't define goes in `images.<name>.data`.

### Named colours

There are **two palettes**, and every sheet names which one its colours come from (`meta.palette`):

- **The editor palette** (`"editor"`): the colours of the editor and UI assets, today `PAINT` in `ui/theme.ts`: `ink`,
  `paper` and the rest. The `icons` sheets use it. It belongs to the engine, and games don't change it (a game retheming the
  UI may come later).
- **The game palette** (`"game"`): the colours of everything in the game world. It is the engine's master palette
  (`engine/core/palette.ts`) with the game's own additions and overrides laid over it, as **one list of names**. Every
  other sheet uses it. The game's part is `src/content/palette.json`:

  ```jsonc
  { "coconut": "#7a4a24", "coconut-": "#4e2e16", "wood": "#9a6a47" }
  ```

A name in the game palette is one of:

- `wood`, `wood-`, `wood+`: a colour in its base, shade (`-`) or light (`+`) tone. This is the same code
  `engine/core/stamp.ts` already writes in `Art` legends. The engine works out the shade and light tones from the base by
  its ramp rule; a game's `palette.json` may give a tone of its own, as with `coconut-` above.
- `face.ink`, `face.eye`, `face.white`, `face.mouth`, `face.skin-`, `face.brow`: the roles of a face stamp (today the
  letters `I C T M % e`). They are worked out for each character when its face is built, so they have no fixed colour.
- Others the engine already draws with, such as stubble's see-through skin and the warmed ears and nose (`mix` and
  `flush` in `Cell`), get role names the same way when their images are converted.

Each name is **one entry**: a ramp is three names (`wood`, `wood-`, `wood+`), not one.

A name that a sheet's palette doesn't know is an error the check script reports. Loading falls back to the PNG's stored
colour.

**Swapping colours at runtime.** Drawing an image takes an optional swap, `{ red: 'blue' }`, applied to names before
colours are looked up. `red` → `blue` also turns `red-` → `blue-` and `red+` → `blue+`. This replaces `recolor()` in
`catalog.ts` for drawn items.

**Free colours.** A palette index with no name is a fixed hex colour. It is allowed in every sheet; the editor marks it, and
offers to turn it into a name. The wardrobe sheet only allows named colours, because players swap them (the check
script enforces this).

### Sheets

| Sheet | Where | What | Frames |
| --- | --- | --- | --- |
| `icons` | engine `ui/images/`, game `src/content/images/` | the 9×9 UI and quest icons | 1 |
| `items` | game `src/content/images/` | bag items, held tools, things on the ground | 1 or more (torch flames) |
| `wear` | engine `engine/character/images/` | wardrobe items drawn in the `sprite` format | the drawn views in a fixed order (below) |
| `faces` | engine `engine/character/images/` | eyes, mouths, brows | the states, in a fixed order (below) |
| `parts` | game `src/content/images/` (the tool's own) | the parts editor's hand edits | one image per item and layer |
| `props` | game `src/content/images/` (the tool's own) | painted and frozen props | the prop's views |
| `walls` | game `src/content/images/` (the tool's own) | painted walls | the wall's views |

`icons` uses the editor palette; all the others use the game palette.

A game's sheet of the same name **adds to and overrides the engine's by image name**, the way `src/content/icons.json` does
today. The editor saves into the game's copy; the `engine-promote` skill moves it into the engine.

**Packing.** `icons` is a fixed grid of 9×9 cells, 16 per row, in name order. Other sheets are packed in rows (tallest
first, then by name) at most 256 pixels wide. The editor repacks a sheet on every save, so the packing is always stable for
the same content and small changes stay small.

**Wear frame order.** A wardrobe image's frames are its drawn views in the order the item format defines them (front, back;
then any further drawn views from `VIEW_WORDS` in `character/parts.ts`). Its slot, name and other fields go in
`images.<name>.data`. **The old `sprite-*.json` grids are converted once and removed; nothing keeps reading the old format.**

**Face frame order.** One image per view and shape: `eyes-<view>-<shape>` with the frames in `EYE_STATES` order,
`mouths-<view>` in mood order, `brows-<view>-<style>` in `BROW_STATES` order (all in `character/base.ts`). Frame size is
the region size in `FACE_REGIONS`.

### Bitmaps other tools save

**Tools keep nothing but preferences on the device** (see *Tools save to the project*). The parts, props and walls tools keep their work on the device today (`readStore`/`writeStore` under `pixel-parts`,
`pixel-props` and the walls store), and only write it to `src/content/store/` when asked. Their pixels are stored there as
text (the `Art` of `engine/core/stamp.ts`: a legend and letter rows per view, with its pivot). From now on:

- Their pixels are the `parts`, `props` and `walls` sheets in `src/content/images/`, and everything else they save (a
  prop's kind, a wall's settings, which item a part belongs to) is a plain JSON file next to them in `src/content/`. That
  file refers to images by name. Both are read with `import.meta.glob` (fresh on every visit) and written with
  `saveToProject`.
- An `Art`'s views become the image's frames, and its pivot (`ox`, `oy`) becomes the `foot` point. A part's layer is the
  image `<item id>.<layer>`, for example `hat-3.front`.
- `Art` stays as the way pixels are held in memory while painting. Only how they are saved changes.
- `readStore`'s fallback to `store/` files, and the stores themselves, go for these three tools. The game reads the
  project files directly.

## Tools save to the project

This rule holds for **every tool**, not only those that save bitmaps. As the scene editor already does:

- A tool reads its work from the project's files on every visit (`import.meta.glob`), so a change made outside it (a git
  revert, a pull) always shows.
- Edits are held in memory until **Save to project**, which writes data as JSON (and bitmaps as sheets) into
  `src/content/` with `saveToProject`. The tool warns before you leave with unsaved changes.
- **Browser storage holds only user preferences**: the language, the chosen tool, zoom, panel widths, what was open or
  selected (by file or id). Never content and never drafts.
- The game reads the same files. `readStore`, `writeStore`, `saveStores`, `storeTracker`, `projectStore` and the
  `src/content/store/` folder go once no tool uses them.

What moves, by tool:

| Tool | Browser storage today | Becomes |
| --- | --- | --- |
| parts | `pixel-parts` | `parts` sheet + `parts.json` |
| props | `pixel-props` | `props` sheet + `props.json` |
| walls | `pixel-walls` | `walls` sheet + `walls.json` |
| objects | `pixel-objects`, `pixel-object-draft` | `objects.json` (the draft goes; `pixel-objects-current` stays as a preference) |
| animals | `pixel-animals`, `pixel-animal-draft` | `animals.json` (the draft goes; `pixel-animals-current` stays) |
| flora | `island-flora` | `flora.json` |
| particles | `pixel-particles` | `particles.json` |
| wardrobe | `castaway-characters` (`loadRoster`) | `characters.json` |
| scene | settings only (`pixel-scenes-ui`) | unchanged |

The file names are a proposal; each lands in `src/content/` and replaces that tool's `store/*.json`. **Before the change,
use "Save to project" in every tool**: no code reads the old browser copies, and work kept only there is not carried over.
The engine's `CLAUDE.md` (*Conventions*) is updated to state the rule.

## Loading

The game draws pictures synchronously while its modules load (for example `const COCO = picture(...)`), and tests run in
plain Node. So sheets are **decoded at build time** and nothing extra is fetched while the game runs:

- A Vite plugin (in `engine/dev/`) turns `import items from './images/items.png?sheet'` into a module that exports the
  decoded sheet: its size, indices as a base64 `Uint8Array`, the palette, and the atlas. The sheet module is loaded once and
  shared by every image in it.
- The Node test loader (`scripts/pixel-alias.mjs`, and the engine's own) gets the same `?sheet` hook, decoding with
  `node:zlib`.
- The engine API, in `engine/core/images.ts` (no DOM, so tests can use it):

```ts
interface Sheet { w: number; h: number; pixels: Uint8Array; palette: string[]; names: Record<number, string>; images: Record<string, ImageInfo> }
interface ImageInfo { name: string; w: number; h: number; frames: number; fps: number; points: Record<string, { x: number; y: number }>; data: Record<string, unknown> }
/** All the sheets of a name, engine's then game's, laid over by image name. */
function sheet(name: 'icons' | 'items' | 'wear' | 'faces' | string): Sheet;
/** One frame as a picture: colours looked up through the palette, `swap` applied to names first. */
function picture(sheet: Sheet, image: string, frame?: number, swap?: Record<string, string>): Picture & { w: number; h: number; foot: { x: number; y: number } };
/** One frame as palette cells, for the puppet and stamps. */
function cells(sheet: Sheet, image: string, frame?: number): Grid;
```

- A PNG reader and writer for 8-bit indexed images (`shared/png.ts`, no dependency): inflate and deflate with
  `DecompressionStream`/`CompressionStream` in the browser and `node:zlib` in Node, CRC-32, filters on read, filter 0 on
  write.

## Saving

The dev server's save endpoint (`engine/dev/content-plugin.ts`) learns to write a sheet: `POST /__save/images/<name>.png`
with the PNG as the body and `POST /__save/images/<name>.json` with the atlas. The server checks the PNG's signature,
`IHDR` (indexed, 8 bit), and that the atlas parses and matches the PNG's size. `shared/project.ts` gets
`saveSheetToProject(name, png, atlas)`. Like today, the editor's own saves don't reload the page, and saving is dev server only.

## The editor: `tools/images`

Replaces `tools/icons` (removed, along with `ui/icons.json` once converted). Built from `ui/components.ts` like the other
tools, and its text in English and German.

- **Left, the library.** Images grouped by sheet (Icons, Items, Wear, Faces), each a tile showing frame 0, with search.
  Images the game overrides are marked as the game's.
- **Middle, the canvas.** The shared pixel editor (`tools/paint/pixel-editor.ts`, extended): pencil, eraser, fill, picker,
  line, rectangle, grid, mirror, zoom. All frames are shown side by side as one strip, so you can paint across them. Under it:
  an **animation preview** playing the frames at the image's fps, with play/pause and the fps. For wear, the body is drawn
  faintly underneath as an onion skin. For faces, the head region is shown underneath.
- **Right, the inspector.**
  - Name (rename), size (grow and trim, keeping frames aligned; icons are fixed at 9×9) and frame count (adding a frame copies
    the last one).
  - Points: `foot`, `fx`, others by name, set by clicking on the canvas.
  - The sheet's colours: its named colours and its free colours as swatches (`choice(..., 'colors')` or `colorField` past 16).
    You can add a colour from the master palette (named) or from `colorPicker` (free), change a free colour's hex, give
    it a name, or remove one nothing uses. Changing a colour changes it for every image in the sheet that uses it.
  - Known `data` fields as fields. Anything else is shown read-only.
- **Actions:** new image, copy, delete, undo and redo (`shared/history.ts`), and **Save** (the whole sheet, as the icon editor
  does today, with the same saved/unsaved mark).
- The palette is one per sheet with at most 255 colours. The editor refuses to add a 256th and says so.

The wardrobe's face shape editor (`tools/wardrobe/shapes.ts`) and the icon editor are replaced by this tool. The wardrobe
keeps its preview of moods and links to the faces in `tools/images`.

## Converting what exists

Done once by a script (`engine/scripts/to-sheets.mjs`). The old data and the code that read it are removed in the same
change. **The engine keeps no compatibility with the old formats.** Other games pick this up when they upgrade the engine;
the upgrade notes say so.

1. **Icons:** `ui/icons.json` and `src/content/icons.json` become the `icons` sheets. `ICONS` becomes a view over the sheet,
   so callers keep working while they are moved over.
2. **Items:** the letter rows and hex legends in `src/things.ts`, `fire.ts`, `fishing.ts` and `pictures.ts` become the game's
   `items` sheet. Their foot points and `fx` become slices, and data such as pick radius and how a tool is held goes into
   `data` where the code doesn't already keep it. Pictures that code builds (torch flames, the blanket's stripes, fish from a
   grid) are **baked**: drawn once into plain frames, and the code that built them is removed. Hex colours stay free colours.
   Turning them into names is left for later, one at a time in the editor.
3. **Wear:** each `sprite`-format item in `engine/character/data/sprite-*.json` becomes an image in the engine's `wear`
   sheet; its legend becomes named colours (all named; it is already palette keys). `catalog.ts` and `items.ts` read the sheet.
   `scripts/make-specs.mjs` and the model's spec (`docs/specs/spec-sprite.md`) still ask the model for letter grids: an import
   step turns its answer into images in the `wear` sheet, and the model's text answer is then deleted. The sheet is the only
   copy; git history keeps the original answers.
4. **Faces:** `face-shapes.json` (engine and game) becomes the `faces` sheets with the `face.*` role names. `FACE_SHAPES` is
   built from it, and the content plugin's `face-shapes.json` validator is removed.
5. **Parts, props and walls:** what they saved in `src/content/store/` becomes the `parts`, `props` and `walls` sheets plus
   their JSON files. No code reads the device's old copies. **Before this step, use "Save to project" in each of the three
   tools**, or work kept only on the device is not converted.

**Proof nothing changed.** Before each conversion, a script renders every affected picture (icons; bag slots and ground
things; every wardrobe item in every view and clip via `scripts/sheet.mjs` and the turntable; every face state) into PNGs.
After it, the same script runs again and the two sets must be **identical pixel for pixel**, except where a bake is meant
to change something (reported and approved one by one). The existing checks (`check-all`, `parts-check`,
`turntable-check`, `animal-frames-check`, `npm test`, `npm run build`) must pass.

## Checks

`engine/scripts/images-check.mjs`, also run by `check-all`:

- every sheet's PNG is 8-bit indexed with index 0 transparent and matches its atlas (size, frames inside the image,
  frame sizes equal within an image, one tag per image, no overlapping images);
- every named index is a name the palette knows, and the `wear` sheet has no free colours;
- every image the code asks for exists (by name, in the sheet it is asked of);
- reading and then writing a sheet gives the same bytes.

## Phases

Each phase is its own commit (or a few), and leaves the game and every check working.

1. **Format:** `shared/png.ts`, `engine/core/images.ts`, the `?sheet` Vite plugin and the Node hook, `palette.json`, the save
   endpoint, `images-check.mjs`, with tests. Nothing uses it yet.
2. **Editor on icons:** `tools/images` with the library, canvas, frames, preview and inspector; icons converted and
   `tools/icons` removed; added to `vite.config.ts`, `shared/tools.ts`/`shell.ts` `TOOLS` and the start page.
3. **Items:** the game's pictures converted and baked; the before/after comparison passes.
4. **Wear and faces:** converted. The catalogue, the puppet, the parts and wardrobe tools, and the bake and turntable scripts
   read the sheets; the face shape editor is removed; the comparison passes.
5. **Parts, props and walls:** these tools read from and save to the project only, with their pixels as sheets, and what
   they had saved is converted.
6. **Every other tool:** objects, animals, flora, particles and the wardrobe's characters read and write project files
   only (*Tools save to the project*); the store helpers and `src/content/store/` are removed; `CLAUDE.md` is updated.
7. **Promote:** the engine part moves into pixel-engine with `engine-promote`.

## Open points

Settled since the first draft: every saved bitmap is a sheet (parts, props and walls included); one editor palette and one
game palette; games don't retheme the UI for now; the model's text answers are deleted once imported; every tool saves its
work as project files and keeps only preferences in browser storage.

None open. Waiting for the go to start phase 1.
