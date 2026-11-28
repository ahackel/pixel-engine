/// <reference types="vite/client" />
// Images kept as sheets: 8-bit indexed PNGs with a JSON atlas (docs/image-spec.md). A sheet is decoded at build time
// (`import x from './images/icons.png?sheet'`, dev/sheet-plugin.ts, and scripts/hooks.mjs under Node), so drawing
// from it is synchronous and needs no DOM. Every image is a horizontal strip of frames of one size; its pixels are
// indices into colours that are a named palette entry or a free hex colour.
import { PALETTE, ramp, type Cell, type PaletteKey, type Tone } from './palette.ts';

/** Which palette a sheet's colour names come from: the game world's or the editor and UI assets'. */
export type PaletteId = 'game' | 'editor';

/** What a `?sheet` import gives: the PNG decoded (pixels as base64 indices) and its atlas. */
export interface RawSheet { name: string; w: number; h: number; colors: string[]; pixels: string; atlas: Atlas }

/** The atlas JSON: the "hash" layout of Aseprite and TexturePacker, with this format's additions in `meta`. */
export interface Atlas {
  frames: Record<string, { frame: Rect; duration: number }>;
  meta: {
    app: string; version: string; image: string; format: 'I8'; size: { w: number; h: number };
    palette: PaletteId;
    frameTags: { name: string; from: number; to: number; direction: 'forward' }[];
    slices: { name: string; keys: { frame: number; bounds: Rect }[] }[];
    names: Record<string, string>;
    images: Record<string, { fps: number; data: Record<string, unknown> }>;
  };
}
export interface Rect { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }

/** One palette slot of a sheet: the colour it shows today, and its name when it is a named colour. */
export interface SheetColor { hex: string; name?: string }

/** One image: its frames side by side as one strip (`w * frames` by `h`), each pixel an index into `colors` (0 empty). */
export interface Img {
  name: string; w: number; h: number; frames: number; fps: number;
  points: Record<string, Point>; data: Record<string, unknown>;
  px: Uint8Array; colors: SheetColor[]; palette: PaletteId;
  /** Where the image comes from: the engine's sheet or the game's. */
  from: 'engine' | 'game';
}
export interface Sheet { name: string; palette: PaletteId; images: Record<string, Img> }

export const NAME = /^[a-z0-9][a-z0-9.-]*$/;
export const MAX_COLORS = 256;

// ---- palettes ----

/** The game palette's own part (`src/content/palette.json`): colours added or overridden by name. */
let gameColors: Record<string, string> = {};
try {
  for (const file of Object.values(import.meta.glob<Record<string, string>>('/src/content/palette.json', { eager: true, import: 'default' }))) gameColors = { ...gameColors, ...file };
} catch { /* plain Node has no import.meta.glob */ }
/** Sets the game palette's own part (Node scripts, which have no glob). */
export const setGameColors = (colors: Record<string, string>) => void ((gameColors = { ...colors }), resolved.clear());

const editorColors: Record<string, string> = {};
/** The editor palette (ui/theme.ts registers it). */
export const setEditorColors = (colors: Record<string, string>) => void (Object.assign(editorColors, colors), resolved.clear());

/** A name's base key and tone: `wood` base, `wood-` shade, `wood+` light. */
export function splitName(name: string): { key: string; tone: Tone } {
  const last = name[name.length - 1];
  return last === '-' ? { key: name.slice(0, -1), tone: 'shade' } : last === '+' ? { key: name.slice(0, -1), tone: 'light' } : { key: name, tone: 'base' };
}
const suffix = (tone: Tone) => (tone === 'shade' ? '-' : tone === 'light' ? '+' : '');

/** The colours the face roles are shown in where no character gives them (the image editor, other tools): a stand-in face. */
const ROLE_COLORS: Record<string, string> = {
  'face.ink': PALETTE.ink.base, 'face.eye': PALETTE.blue.shade, 'face.white': PALETTE.tooth.base, 'face.mouth': PALETTE.mouth.base,
  'face.skin-': PALETTE.skinB.shade, 'face.brow': PALETTE.hairBrown.shade,
};

const resolved = new Map<string, string | null>();
/** The colour a name has in a palette today (a face role: its stand-in colour), or null for a name the palette does not know. */
export function colorOfName(palette: PaletteId, name: string): string | null {
  const id = palette + ':' + name;
  if (resolved.has(id)) return resolved.get(id)!;
  let out: string | null = null;
  if (palette === 'editor') out = editorColors[name] ?? null;
  else if (name in gameColors) out = gameColors[name];
  else if (name in ROLE_COLORS) out = ROLE_COLORS[name];
  else {
    const { key, tone } = splitName(name);
    if (key in PALETTE) out = PALETTE[key as PaletteKey][tone];
    else if (key in gameColors) out = ramp(gameColors[key])[tone];
  }
  resolved.set(id, out);
  return out;
}
/** Whether a palette knows a name. Face roles (`face.*`) and other roles (`role.*`) are known to the game palette without a colour. */
export const knownName = (palette: PaletteId, name: string): boolean =>
  colorOfName(palette, name) !== null || (palette === 'game' && /^(face|role)\.[a-z-]+[-+]?$/.test(name));

/** Every name a palette offers to paint with, in order. */
export function paletteNames(palette: PaletteId): string[] {
  if (palette === 'editor') return Object.keys(editorColors);
  const keys = [...new Set([...Object.keys(PALETTE), ...Object.keys(gameColors).map((n) => splitName(n).key)])];
  return keys.flatMap((k) => ['', '-', '+'].map((s) => k + s)).filter((n) => colorOfName('game', n) !== null);
}

/** A name with a swap applied: `{ red: 'blue' }` turns `red`, `red-` and `red+` into `blue`, `blue-`, `blue+`. */
export function swapped(name: string, swap?: Record<string, string>): string {
  if (!swap) return name;
  if (name in swap) return swap[name];
  const { key, tone } = splitName(name);
  return key in swap ? swap[key] + suffix(tone) : name;
}

/** The colour a slot shows: its named colour today (after the swap), else its stored hex. */
export function hexOfColor(palette: PaletteId, c: SheetColor, swap?: Record<string, string>): string {
  return (c.name && colorOfName(palette, swapped(c.name, swap))) || c.hex;
}

/** A game palette name as a paint cell, or null when it is no master palette entry. */
export function cellOfName(name: string): Cell | null {
  const { key, tone } = splitName(name);
  if (!(key in PALETTE)) return null;
  return { key: key as PaletteKey, shade: tone === 'shade', ...(tone === 'light' ? { light: true } : {}) };
}
/** A paint cell's name in the game palette. */
export const nameOfCell = (c: Cell): string => c.key + (c.shade ? '-' : c.light ? '+' : '');

// ---- decoding ----

const fromBase64 = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
export const toBase64 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

/** A decoded sheet's images, each cut out of the sheet as its own strip. */
export function readSheet(raw: RawSheet, from: Img['from'] = 'engine'): Sheet {
  const pixels = fromBase64(raw.pixels);
  const { meta, frames } = raw.atlas;
  const colors: SheetColor[] = raw.colors.map((hex, i) => (meta.names[i] ? { hex, name: meta.names[i] } : { hex }));
  if (!colors.length) colors.push({ hex: '#000000' });
  const images: Record<string, Img> = {};
  for (const tag of meta.frameTags) {
    const n = tag.to - tag.from + 1;
    const rects = Array.from({ length: n }, (_, f) => frames[`${tag.name} ${f}`]?.frame);
    if (!rects[0] || rects.some((r) => !r)) continue;
    const { w, h } = rects[0];
    const px = new Uint8Array(w * n * h);
    rects.forEach((r, f) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w * n + f * w + x] = pixels[(r.y + y) * raw.w + r.x + x];
    });
    const points: Record<string, Point> = {};
    for (const s of meta.slices) {
      const [img, point] = s.name.split('/');
      if (img === tag.name && point && s.keys[0]) points[point] = { x: s.keys[0].bounds.x, y: s.keys[0].bounds.y };
    }
    const info = meta.images[tag.name] ?? { fps: 0, data: {} };
    images[tag.name] = { name: tag.name, w, h, frames: n, fps: info.fps ?? 0, points, data: info.data ?? {}, px, colors, palette: meta.palette, from };
  }
  return { name: raw.name, palette: meta.palette, images };
}

/** Sheets of one name laid over each other by image name: the engine's, then the game's. */
export function layer(name: string, ...sheets: Sheet[]): Sheet {
  const images: Record<string, Img> = {};
  for (const s of sheets) Object.assign(images, s.images);
  return { name, palette: sheets[0]?.palette ?? 'game', images };
}

/** The game's own sheets (`src/content/images/*.png`), by name. Empty under plain Node. */
const gameRaw: Record<string, RawSheet> = {};
try {
  for (const raw of Object.values(import.meta.glob<RawSheet>('/src/content/images/*.png', { query: '?sheet', eager: true, import: 'default' }))) gameRaw[raw.name] = raw;
} catch { /* plain Node has no import.meta.glob */ }

/** The game's own sheet of a name as its `?sheet` import gives it, if the game has one. */
export const gameRawSheet = (name: string): RawSheet | undefined => gameRaw[name];

const sheets = new Map<string, Sheet>();
/**
 * All the sheets of a name: the engine's own (`engine`, the module's import of it), then the game's laid over by image
 * name. `game` passes the game's sheet in for code that must load under plain Node, where there is no glob.
 */
export function sheet(name: string, engine?: RawSheet | null, game?: RawSheet): Sheet {
  let s = sheets.get(name);
  if (!s) {
    const own = game ?? gameRaw[name];
    s = layer(name, ...(engine ? [readSheet(engine, 'engine')] : []), ...(own && own !== engine ? [readSheet(own, 'game')] : []));
    sheets.set(name, s);
  }
  return s;
}

// ---- drawing ----

/** An image's frame as a picture: `get` gives each pixel's colour or null, with `swap` applied to names first. */
export function picture(img: Img, frame = 0, swap?: Record<string, string>): { get(x: number, y: number): string | null; w: number; h: number; foot: Point } {
  const f = Math.max(0, Math.min(img.frames - 1, frame));
  const hexes = img.colors.map((c, i) => (i ? hexOfColor(img.palette, c, swap) : null));
  const stride = img.w * img.frames;
  return {
    w: img.w, h: img.h, foot: footOf(img),
    get: (x, y) => (x < 0 || y < 0 || x >= img.w || y >= img.h ? null : hexes[img.px[y * stride + f * img.w + x]] ?? null),
  };
}
/** Where an image stands on the ground: its `foot` point, else the middle of its bottom row. */
export const footOf = (img: Img): Point => img.points.foot ?? { x: Math.floor(img.w / 2), y: img.h - 1 };

/** One frame as rows of colour names, null where empty or where a slot has no name. */
export function names(img: Img, frame = 0): (string | null)[][] {
  const stride = img.w * img.frames;
  return Array.from({ length: img.h }, (_, y) => Array.from({ length: img.w }, (_, x) => {
    const i = img.px[y * stride + frame * img.w + x];
    return i ? img.colors[i]?.name ?? null : null;
  }));
}
/** One frame as paint cells (`stamp.ts` Grid), for the puppet and stamps: names that are master palette entries. */
export const cells = (img: Img, frame = 0): (Cell | null)[][] => names(img, frame).map((row) => row.map((n) => (n ? cellOfName(n) : null)));

/** The index of a pixel of a frame. */
export const indexAt = (img: Img, frame: number, x: number, y: number): number => img.px[y * img.w * img.frames + frame * img.w + x];

// ---- writing ----

/** A sheet ready to write: its PNG's pixels and colours, and its atlas. */
export interface Packed { w: number; h: number; pixels: Uint8Array; colors: string[]; atlas: Atlas }

const key = (c: SheetColor) => (c.name ? 'n:' + c.name : 'h:' + c.hex.toLowerCase());

/**
 * Packs images into one sheet: one palette for them all (slot 0 empty, then the colours used, named ones first, in first
 * use), the images placed by `layout`: `grid` cells of `cell` pixels, 16 a row, in name order (icons); otherwise rows at
 * most 256 pixels wide, tallest first, then by name. The same images always pack the same.
 */
export function pack(name: string, palette: PaletteId, list: Img[], layout: { grid?: number } = {}): Packed {
  const imgs = [...list].sort((a, b) => (layout.grid ? 0 : b.h - a.h) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  // One palette: slot 0 empty, then every colour that is used, in order of first use.
  const slots: SheetColor[] = [{ hex: '#000000' }];
  const index = new Map<string, number>();
  const remaps = new Map<Img, number[]>();
  for (const img of imgs) {
    const used = new Set(img.px);
    const remap = img.colors.map((c, i) => {
      if (!i || !used.has(i)) return 0;
      const k = key(c);
      let n = index.get(k);
      if (n === undefined) {
        n = slots.length;
        if (n >= MAX_COLORS) throw new Error(`sheet ${name} has more than ${MAX_COLORS - 1} colours`);
        index.set(k, n);
        slots.push({ hex: hexOfColor(palette, c), ...(c.name ? { name: c.name } : {}) });
      }
      return n;
    });
    remaps.set(img, remap);
  }
  // Places.
  const at = new Map<Img, Point>();
  let w = 1, h = 1;
  if (layout.grid) {
    const g = layout.grid;
    imgs.forEach((img, i) => at.set(img, { x: (i % 16) * g, y: Math.floor(i / 16) * g }));
    w = Math.min(16, Math.max(1, imgs.length)) * g;
    h = Math.max(1, Math.ceil(imgs.length / 16)) * g;
  } else {
    const MAX = 256;
    let x = 0, y = 0, row = 0;
    for (const img of imgs) {
      const iw = img.w * img.frames;
      if (x && x + iw > MAX) { y += row; x = 0; row = 0; }
      at.set(img, { x, y });
      x += iw;
      row = Math.max(row, img.h);
      w = Math.max(w, x);
    }
    h = Math.max(1, y + row);
  }
  const pixels = new Uint8Array(w * h);
  const frames: Atlas['frames'] = {};
  const tags: Atlas['meta']['frameTags'] = [];
  const slices: Atlas['meta']['slices'] = [];
  const infos: Atlas['meta']['images'] = {};
  let n = 0;
  for (const img of [...imgs].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = at.get(img)!, remap = remaps.get(img)!, stride = img.w * img.frames;
    for (let y = 0; y < img.h; y++) for (let x = 0; x < stride; x++) pixels[(p.y + y) * w + p.x + x] = remap[img.px[y * stride + x]] ?? 0;
    const duration = img.fps > 0 && img.frames > 1 ? Math.round(1000 / img.fps) : 100;
    for (let f = 0; f < img.frames; f++) frames[`${img.name} ${f}`] = { frame: { x: p.x + f * img.w, y: p.y, w: img.w, h: img.h }, duration };
    tags.push({ name: img.name, from: n, to: n + img.frames - 1, direction: 'forward' });
    n += img.frames;
    for (const [point, q] of Object.entries(img.points).sort(([a], [b]) => (a < b ? -1 : 1)))
      slices.push({ name: `${img.name}/${point}`, keys: [{ frame: 0, bounds: { x: q.x, y: q.y, w: 1, h: 1 } }] });
    infos[img.name] = { fps: img.fps, data: img.data };
  }
  const named: Record<string, string> = {};
  slots.forEach((c, i) => c.name && (named[i] = c.name));
  const atlas: Atlas = {
    frames,
    meta: {
      app: 'pixel-engine images', version: '1', image: `${name}.png`, format: 'I8', size: { w, h }, palette,
      frameTags: tags, slices, names: named, images: infos,
    },
  };
  return { w, h, pixels, colors: slots.map((c) => c.hex), atlas };
}

/** A packed sheet as what a `?sheet` import gives, so freshly made sheets can be read back the same way. */
export const rawOf = (name: string, p: Packed): RawSheet => ({ name, w: p.w, h: p.h, colors: p.colors, pixels: toBase64(p.pixels), atlas: p.atlas });

/** A new image of one colour list, empty. */
export function blankImg(name: string, w: number, h: number, frames: number, palette: PaletteId, colors: SheetColor[] = [{ hex: '#000000' }]): Img {
  return { name, w, h, frames, fps: 0, points: {}, data: {}, px: new Uint8Array(w * frames * h), colors, palette, from: 'game' };
}

/**
 * An image from rows of letters per frame and what each letter is (a name in the palette, or a `#hex` free colour);
 * '.' and letters without an entry are empty. For converting the old letter formats.
 */
export function imgFromRows(name: string, palette: PaletteId, frames: readonly (readonly string[])[], legend: Record<string, string>): Img {
  const h = Math.max(1, ...frames.map((f) => f.length));
  const w = Math.max(1, ...frames.flatMap((f) => f.map((r) => r.length)));
  const colors: SheetColor[] = [{ hex: '#000000' }];
  const slot = new Map<string, number>();
  const img = blankImg(name, w, h, frames.length, palette, colors);
  frames.forEach((rows, f) => rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const v = legend[ch];
    if (!v || ch === '.') return;
    let i = slot.get(v);
    if (i === undefined) {
      i = colors.length;
      slot.set(v, i);
      colors.push(v.startsWith('#') ? { hex: v.toLowerCase() } : { hex: colorOfName(palette, v) ?? '#ff00ff', name: v });
    }
    img.px[y * w * frames.length + f * w + x] = i;
  })));
  return img;
}
