// The image editor: every image of the game's sheets (docs/image-spec.md), drawn pixel by pixel. Pick an image in the
// library on the left (grouped by sheet), paint all its frames side by side in the middle, watch them play under it, and
// set its name, size, frames, points, colours and data in the inspector on the right. "Save" writes each changed sheet
// into the game's `src/content/images/` as an indexed PNG and its atlas; the game lays them over the engine's sheets,
// and the engine-promote skill moves them into the engine. Nothing is kept on the device but the panels' preferences.
import { saveSheetToProject, canSaveToProject } from '../../shared/project.ts';
import { history } from '../../shared/history.ts';
import { currentLang } from '../../shared/lang.ts';
import { encodePngInBrowser } from '../../shared/png.ts';
import { label, pixelCanvas } from '../../shared/pixel-ui.ts';
import {
  colorOfName, hexOfColor, NAME, pack, paletteNames, readSheet, setEditorColors, MAX_COLORS,
  type Img, type PaletteId, type RawSheet, type SheetColor,
} from '../../engine/core/images.ts';
import {
  box, choice, colorField, colorPicker, confirmDialog, field, fields, filterToggles, iconPicture, library, numberField, pixelButton, section,
  sidebarButton, sidePanel, textField, toast, type Option,
} from '../../ui/components.ts';
import { uiPage } from '../../ui/page.ts';
import { C, EDITOR_COLORS, S } from '../../ui/theme.ts';
import { underlayOf } from './underlay.ts';

setEditorColors(EDITOR_COLORS);
const L = (en: string, de: string) => (currentLang() === 'de' ? de : en);
/** Words in the pixel font. */
const words = (s: string) => label(s, C.ink, S);

// ---- the sheets: the engine's (read only) and the game's (edited and saved) ----

const ENGINE_RAW = Object.values({
  ...import.meta.glob<RawSheet>('../../ui/images/*.png', { query: '?sheet', eager: true, import: 'default' }),
  ...import.meta.glob<RawSheet>('../../engine/character/images/*.png', { query: '?sheet', eager: true, import: 'default' }),
});
const GAME_RAW = Object.values(import.meta.glob<RawSheet>('/src/content/images/*.png', { query: '?sheet', eager: true, import: 'default' }));

/** One sheet being edited: its palette and colours (one list for all its images), and the game's images by name. */
interface Edit { name: string; palette: PaletteId; colors: SheetColor[]; images: Record<string, Img> }
/** Sheets laid on a fixed grid, and their cell size: the icons, 9 by 9. */
const GRID: Record<string, number> = { icons: 9 };
const ORDER = ['icons', 'items', 'wear', 'faces', 'parts', 'props', 'walls'];
const SHEET_WORDS: Record<string, [string, string]> = {
  icons: ['Icons', 'Symbole'], items: ['Items', 'Dinge'], wear: ['Wear', 'Kleidung'], faces: ['Faces', 'Gesichter'],
  parts: ['Parts', 'Teile'], props: ['Props', 'Requisiten'], walls: ['Walls', 'Wände'],
};
const sheetWords = (name: string) => (SHEET_WORDS[name] ? L(...SHEET_WORDS[name]) : name);

const engineImages: Record<string, Record<string, Img>> = {};
for (const raw of ENGINE_RAW) engineImages[raw.name] = readSheet(raw, 'engine').images;
let edits: Record<string, Edit> = {};
for (const raw of GAME_RAW) {
  const s = readSheet(raw, 'game');
  const colors = Object.values(s.images)[0]?.colors ?? [{ hex: '#000000' }];
  edits[raw.name] = { name: raw.name, palette: s.palette, colors, images: s.images };
}
for (const raw of ENGINE_RAW) if (!edits[raw.name]) edits[raw.name] = { name: raw.name, palette: raw.atlas.meta.palette, colors: [{ hex: '#000000' }], images: {} };
const sheetNames = () => Object.keys(edits).sort((a, b) => ((ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99)) || (a < b ? -1 : 1));

/** What is shown of a sheet: the engine's images, the game's laid over. */
const shownOf = (sheet: string): Record<string, Img> => ({ ...engineImages[sheet], ...edits[sheet]?.images });

// ---- what is picked, and undo ----

const PREFS = 'pixel-images-ui';
let prefs: { sheet?: string; image?: string; zoom?: number; filter?: string } = {};
try { prefs = JSON.parse(localStorage.getItem(PREFS) ?? '{}'); } catch { /* none */ }
const keepPrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* not kept */ } };

let sheetName = prefs.sheet && edits[prefs.sheet] ? prefs.sheet : sheetNames()[0];
let imageName = prefs.image && shownOf(sheetName)[prefs.image] ? prefs.image : Object.keys(shownOf(sheetName)).sort()[0] ?? '';
let ink = 1;
type Tool = 'draw' | 'erase' | 'line' | 'rect' | 'fill' | 'pick' | 'point';
let tool: Tool = 'draw';
let pointName = 'foot';
let zoom = prefs.zoom ?? 0;
let filter = prefs.filter ?? 'all';
// A link to a sheet (`#faces`, from the wardrobe) opens on it.
const asked = decodeURIComponent(location.hash.slice(1));
if (asked && edits[asked]) {
  filter = sheetName = asked;
  imageName = Object.keys(shownOf(asked)).sort()[0] ?? '';
}

/** A sheet as plain JSON, for undo and to see whether it changed since saving. */
const snap = (e: Edit) => ({
  colors: e.colors,
  images: Object.fromEntries(Object.entries(e.images).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, i]) => [k, { w: i.w, h: i.h, frames: i.frames, fps: i.fps, points: i.points, data: i.data, px: Array.from(i.px) }])),
});
const unsnap = (e: Edit, v: ReturnType<typeof snap>) => {
  e.colors.splice(0, e.colors.length, ...v.colors);
  e.images = Object.fromEntries(Object.entries(v.images).map(([k, i]) => [k, { name: k, ...i, px: Uint8Array.from(i.px), colors: e.colors, palette: e.palette, from: 'game' as const }]));
};
const saved = new Map(Object.values(edits).map((e) => [e.name, JSON.stringify(snap(e))]));
const changedSheets = () => Object.values(edits).filter((e) => JSON.stringify(snap(e)) !== saved.get(e.name));

const undo = history(() => ({ sheet: sheetName, image: imageName, all: Object.fromEntries(Object.values(edits).map((e) => [e.name, snap(e)])) }), (v) => {
  for (const [k, s] of Object.entries(v.all)) unsnap(edits[k], s);
  sheetName = v.sheet;
  imageName = v.image;
  render();
});
const changed = () => { undo.commit(); render(); };

const edit = () => edits[sheetName];
const current = (): Img | undefined => shownOf(sheetName)[imageName];
/** The image to paint: the game's own copy, made from the engine's when it has none yet (it then overrides it). */
function own(): Img | undefined {
  const e = edit(), img = current();
  if (!img) return;
  if (img.from === 'game') return img;
  const copy = adopt(e, img, img.name);
  e.images[img.name] = copy;
  return copy;
}
/** An image copied into a sheet's own colours under a name. */
function adopt(e: Edit, img: Img, name: string): Img {
  const remap = img.colors.map((c, i) => (i ? slotOf(e, c) : 0));
  return { ...img, name, points: structuredClone(img.points), data: structuredClone(img.data), px: img.px.map((v) => remap[v]), colors: e.colors, from: 'game' };
}
/** The slot of a colour in a sheet's colours, added when new. */
function slotOf(e: Edit, c: SheetColor): number {
  const at = e.colors.findIndex((s, i) => i && (c.name ? s.name === c.name : !s.name && s.hex.toLowerCase() === c.hex.toLowerCase()));
  if (at > 0) return at;
  if (e.colors.length >= MAX_COLORS) { toast(L(`A sheet holds at most ${MAX_COLORS - 1} colours`, `Ein Blatt fasst höchstens ${MAX_COLORS - 1} Farben`)); return 0; }
  e.colors.push({ ...c });
  return e.colors.length - 1;
}

// ---- the page ----

const status = document.createElement('span');
status.className = 'urow';
const setSaved = (v: boolean | null) => status.replaceChildren(...(v ? [iconPicture('check')] : []));
async function saveNow(): Promise<boolean> {
  for (const e of changedSheets()) {
    try {
      const packed = pack(e.name, e.palette, Object.values(e.images), { grid: GRID[e.name] });
      if (!(await saveSheetToProject(e.name, await encodePngInBrowser(packed), packed.atlas))) return false;
      saved.set(e.name, JSON.stringify(snap(e)));
    } catch (error) {
      toast(String((error as Error).message ?? error));
      return false;
    }
  }
  return true;
}
const uniqueName = (base: string) => {
  let n = 1, name = base;
  while (shownOf(sheetName)[name]) name = `${base}-${++n}`;
  return name;
};
const main = uiPage('images', {
  sidebar: sidebarButton(L('Side panel', 'Seitenleiste')),
  inspector: sidebarButton(L('Inspector', 'Inspektor'), 'right'),
  undo: () => { undo.undo(); setSaved(null); },
  redo: () => { undo.redo(); setSaved(null); },
  save: {
    label: canSaveToProject() ? L('Save to project', 'Im Projekt speichern') : L('Saving needs the dev server', 'Speichern braucht den Dev-Server'),
    disabled: !canSaveToProject(), on: async () => setSaved(await saveNow()), unsaved: () => changedSheets().length > 0, saveNow,
  },
  status,
  actions: [
    { icon: 'plus', label: L('New image', 'Neues Bild'), on: () => {
      const g = GRID[sheetName] ?? 16;
      const name = uniqueName('new');
      edit().images[name] = { name, w: g, h: g, frames: 1, fps: 0, points: {}, data: {}, px: new Uint8Array(g * g), colors: edit().colors, palette: edit().palette, from: 'game' };
      imageName = name;
      changed();
    } },
    { icon: 'copy', label: L('Copy', 'Kopieren'), on: () => {
      const img = current();
      if (!img) return;
      const name = uniqueName(img.name);
      edit().images[name] = adopt(edit(), img, name);
      imageName = name;
      changed();
    } },
    { icon: 'trash', label: L('Delete (the engine’s image shows again)', 'Löschen (das Bild der Engine erscheint wieder)'), on: async () => {
      const img = current();
      if (!img || img.from !== 'game') return toast(L('Only the game’s own images can be deleted', 'Nur eigene Bilder des Spiels lassen sich löschen'));
      if (!(await confirmDialog(L(`Delete ${img.name}?`, `${img.name} löschen?`)))) return;
      delete edit().images[img.name];
      if (!current()) imageName = Object.keys(shownOf(sheetName)).sort()[0] ?? '';
      changed();
    } },
  ],
});
main.className = 'uworkspace';
document.body.classList.add('upage--fill');
addEventListener('beforeunload', (e) => { if (changedSheets().length) e.preventDefault(); });

const shelf = sidePanel('left', 'pixel-images-library');
const area = document.createElement('div');
area.className = 'uwork';
area.style.overflow = 'auto';
const inspector = sidePanel('right', 'pixel-images-inspector', 240);
main.append(shelf.panel, area, inspector.panel);

/** A picture of an image's first frame, `scale` screen pixels a pixel. */
function thumb(img: Img, scale: number, frame = 0): HTMLCanvasElement {
  const { canvas, ctx } = pixelCanvas(img.w, img.h, scale);
  const hexes = img.colors.map((c, i) => (i ? hexOfColor(img.palette, c) : null));
  const stride = img.w * img.frames;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const hex = hexes[img.px[y * stride + frame * img.w + x]];
    if (hex) { ctx.fillStyle = hex; ctx.fillRect(x, y, 1, 1); }
  }
  return canvas;
}

const list = library({
  key: 'pixel-images',
  items: () => sheetNames().filter((s) => filter === 'all' || filter === s).flatMap((s) =>
    Object.values(shownOf(s)).sort((a, b) => (a.name < b.name ? -1 : 1)).map((img) => ({
      id: `${s}/${img.name}`, picture: thumb(img, Math.max(1, Math.min(S, Math.floor(36 / Math.max(img.w, img.h))))),
      words: img.name, find: sheetWords(s), mark: img.from === 'game' && engineImages[s]?.[img.name] ? 'pencil' : undefined,
    }))),
  selected: () => `${sheetName}/${imageName}`,
  pick: (id) => {
    const at = id.indexOf('/');
    sheetName = id.slice(0, at);
    imageName = id.slice(at + 1);
    prefs.sheet = sheetName;
    prefs.image = imageName;
    keepPrefs();
    render();
  },
  filters: () => [filterToggles([{ id: 'all', words: L('All', 'Alle') }, ...sheetNames().map((s) => ({ id: s, words: sheetWords(s) }))], () => filter, (id) => {
    filter = id;
    prefs.filter = id;
    keepPrefs();
    list.redraw();
  })],
});
shelf.body.append(list);

// ---- the canvas ----

type P = [number, number];
function lineCells(a: P, b: P): P[] {
  const out: P[] = [];
  let [x, y] = a;
  const dx = Math.abs(b[0] - x), dy = -Math.abs(b[1] - y), sx = x < b[0] ? 1 : -1, sy = y < b[1] ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x, y]);
    if (x === b[0] && y === b[1]) return out;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}
const rectCells = (a: P, b: P): P[] => [lineCells(a, [b[0], a[1]]), lineCells([b[0], a[1]], b), lineCells(b, [a[0], b[1]]), lineCells([a[0], b[1]], a)].flat();

/** Screen pixels per image pixel: as large as fits, or the zoom chosen. */
const cellSize = (img: Img) => zoom || Math.max(4, Math.min(32, Math.floor(560 / Math.max(img.w * img.frames, img.h * 1.5))));

function canvasOf(img: Img): HTMLElement {
  const stride = img.w * img.frames;
  const cell = cellSize(img);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;display:inline-block;line-height:0';
  const { canvas, ctx } = pixelCanvas(stride, img.h, cell);
  canvas.style.background = `repeating-conic-gradient(${C.track} 0 25%, ${C.paper} 0 50%) 0 0 / ${cell * 2}px ${cell * 2}px`;
  const under = underlayOf(sheetName, img);
  const grid = document.createElement('canvas');
  grid.width = stride * cell;
  grid.height = img.h * cell;
  grid.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
  const g = grid.getContext('2d')!;
  g.fillStyle = '#0000001a';
  if (cell >= 8) for (let x = 1; x < stride; x++) g.fillRect(x * cell, 0, 1, grid.height);
  if (cell >= 8) for (let y = 1; y < img.h; y++) g.fillRect(0, y * cell, grid.width, 1);
  g.fillStyle = C.ink;
  for (let f = 1; f < img.frames; f++) g.fillRect(f * img.w * cell - 1, 0, 2, grid.height);
  for (const [name, p] of Object.entries(img.points)) {
    g.strokeStyle = name === 'foot' ? '#d9412b' : '#2f3b6e';
    g.lineWidth = 2;
    for (let f = 0; f < img.frames; f++) g.strokeRect((f * img.w + p.x) * cell + 1, p.y * cell + 1, cell - 2, cell - 2);
  }
  const redraw = () => {
    ctx.clearRect(0, 0, stride, img.h);
    if (under) { ctx.globalAlpha = under.alpha ?? 0.3; for (let f = 0; f < img.frames; f++) under(ctx, f * img.w, f); ctx.globalAlpha = 1; }
    for (let y = 0; y < img.h; y++) for (let x = 0; x < stride; x++) {
      const i = img.px[y * stride + x];
      if (i) { ctx.fillStyle = hexOfColor(img.palette, img.colors[i] ?? { hex: '#ff00ff' }); ctx.fillRect(x, y, 1, 1); }
    }
  };
  redraw();
  const at = (e: PointerEvent): P => { const r = canvas.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * stride), Math.floor((e.clientY - r.top) / r.height * img.h)]; };
  const inside = ([x, y]: P) => x >= 0 && y >= 0 && x < stride && y < img.h;
  let target: Img | null = null;
  const set = (t: Img, [x, y]: P, v: number) => { if (inside([x, y])) t.px[y * stride + x] = v; };
  let from: P | null = null, last: P = [0, 0], base: Uint8Array | null = null;
  const value = () => (tool === 'erase' ? 0 : ink);
  canvas.addEventListener('pointerdown', (e) => {
    const p = at(e);
    if (!inside(p)) return;
    if (tool === 'pick') { const v = img.px[p[1] * stride + p[0]]; if (v) ink = v; tool = 'draw'; return render(); }
    // The chosen colour is one of the shown image's; painting an engine image makes the game's copy, in the sheet's colours.
    const want = img.colors[ink];
    target = own() ?? null;
    if (!target) return;
    if (target !== img && want) ink = slotOf(edit(), want);
    if (tool === 'point') { target.points[pointName] = { x: p[0] % img.w, y: p[1] }; return changed(); }
    if (tool === 'fill') {
      const t = target, was = t.px[p[1] * stride + p[0]], v = value();
      const f0 = Math.floor(p[0] / img.w) * img.w;
      if (was !== v) {
        const todo: P[] = [p];
        while (todo.length) {
          const [x, y] = todo.pop()!;
          if (x < f0 || x >= f0 + img.w || y < 0 || y >= img.h || t.px[y * stride + x] !== was) continue;
          t.px[y * stride + x] = v;
          todo.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }
      }
      return changed();
    }
    canvas.setPointerCapture(e.pointerId);
    from = last = p;
    base = target.px.slice();
    set(target, p, value());
    img = target;
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!from || !target || !base) return;
    const p = at(e);
    if (tool === 'draw' || tool === 'erase') { for (const q of lineCells(last, p)) set(target, q, value()); last = p; }
    else { target.px.set(base); for (const q of (tool === 'rect' ? rectCells : lineCells)(from, p)) set(target, q, value()); }
    redraw();
  });
  canvas.addEventListener('pointerup', () => { if (from) { from = null; changed(); setSaved(null); } });
  canvas.style.touchAction = 'none';
  wrap.append(canvas, grid);
  return wrap;
}

// ---- the animation preview ----

let playing = true;
let timer = 0;
function preview(img: Img): HTMLElement {
  const scale = Math.max(2, Math.min(8, Math.floor(96 / Math.max(img.w, img.h))));
  const holder = document.createElement('div');
  holder.style.lineHeight = '0';
  let f = 0;
  const show = () => holder.replaceChildren(thumb(img, scale, f));
  show();
  clearInterval(timer);
  if (img.frames > 1 && playing) timer = window.setInterval(() => { f = (f + 1) % img.frames; show(); }, 1000 / Math.max(1, img.fps || 4));
  const row = document.createElement('div');
  row.className = 'urow';
  row.append(holder, pixelButton(playing ? L('Pause', 'Anhalten') : L('Play', 'Abspielen'), { icon: playing ? 'pause' : 'play', flat: true }, () => { playing = !playing; render(); }));
  return row;
}

// ---- the inspector ----

function rename(to: string) {
  to = to.trim().toLowerCase();
  const img = current();
  if (!img || to === img.name) return;
  if (!NAME.test(to) || shownOf(sheetName)[to]) return void (toast(L('Names are lower case letters, digits, “-” and “.”, and unique in their sheet', 'Namen sind Kleinbuchstaben, Ziffern, „-“ und „.“, eindeutig im Blatt')), render());
  const mine = own()!;
  delete edit().images[img.name];
  mine.name = to;
  edit().images[to] = mine;
  imageName = to;
  changed();
}
/** Changes an image's frame size or frame count, keeping each frame's pixels where they were (top left). */
function reshape(w: number, h: number, frames: number) {
  const img = own();
  if (!img || (w === img.w && h === img.h && frames === img.frames)) return;
  const px = new Uint8Array(w * frames * h);
  for (let f = 0; f < frames; f++) {
    const src = Math.min(f, img.frames - 1);
    for (let y = 0; y < Math.min(h, img.h); y++) for (let x = 0; x < Math.min(w, img.w); x++) px[y * w * frames + f * w + x] = img.px[y * img.w * img.frames + src * img.w + x];
  }
  Object.assign(img, { w, h, frames, px });
  changed();
}
const usedSlots = (e: Edit) => new Set(Object.values(e.images).flatMap((i) => [...new Set(i.px)]));

function colorsSection(img: Img): HTMLElement {
  const e = edit();
  const opts: Option[] = img.colors.map((c, i) => ({ id: String(i), color: hexOfColor(img.palette, c), words: c.name ?? c.hex })).slice(1);
  const rows: Node[] = [choice(L('Colours', 'Farben'), [{ id: '0', icon: 'eraser', words: L('Empty', 'Leer') }, ...opts], () => String(tool === 'erase' ? 0 : ink), (id) => {
    if (id === '0') tool = 'erase';
    else { ink = +id; if (tool === 'erase' || tool === 'pick' || tool === 'point') tool = 'draw'; }
    render();
  }, 'colors', 120)];
  const mine = img.from === 'game';
  const chosen = mine ? e.colors[ink] : undefined;
  if (chosen) {
    rows.push(field({ words: L('Name', 'Name') }, colorField(L('Name of this colour', 'Name dieser Farbe'),
      [{ id: '', words: L('Free colour', 'Freie Farbe'), icon: 'eraser' }, ...paletteNames(e.palette).map((n) => ({ id: n, words: n, color: colorOfName(e.palette, n) ?? undefined }))],
      () => chosen.name ?? '', (n) => {
        if (n) { chosen.name = n; chosen.hex = colorOfName(e.palette, n) ?? chosen.hex; } else delete chosen.name;
        changed();
      })));
    if (!chosen.name) rows.push(field({ words: 'Hex' }, colorPicker(L('Free colour', 'Freie Farbe'), () => chosen.hex, (hex) => { chosen.hex = hex; area.querySelector('canvas') && renderCanvas(); }, { done: () => changed() })));
    else rows.push(field({ words: L('Named', 'Benannt') }, words(chosen.name)));
  }
  rows.push(field({ words: L('Add', 'Neu') }, colorField(L('Add a palette colour', 'Palettenfarbe hinzufügen'),
    paletteNames(e.palette).map((n) => ({ id: n, words: n, color: colorOfName(e.palette, n) ?? undefined })), () => null, (n) => {
      own();
      const i = slotOf(e, { hex: colorOfName(e.palette, n) ?? '#ff00ff', name: n });
      if (i) ink = i;
      changed();
    })));
  if (e.palette === 'game' && sheetName !== 'wear') rows.push(field({ words: L('Free', 'Frei') }, colorPicker(L('Add a free colour', 'Freie Farbe hinzufügen'), () => '#888888', () => {}, {
    done: (hex) => { own(); const i = slotOf(e, { hex }); if (i) ink = i; changed(); },
  })));
  const unused = e.colors.map((_, i) => i).filter((i) => i && !usedSlots(e).has(i));
  if (unused.length) rows.push(pixelButton(L(`Remove ${unused.length} unused`, `${unused.length} ungenutzte entfernen`), { icon: 'trash', words: L('Unused', 'Ungenutzte') }, () => {
    const keep = e.colors.map((_, i) => i).filter((i) => !unused.includes(i));
    const remap = new Map(keep.map((i, n) => [i, n]));
    for (const im of Object.values(e.images)) im.px = im.px.map((v) => remap.get(v) ?? 0);
    e.colors.splice(0, e.colors.length, ...keep.map((i) => e.colors[i]));
    ink = Math.min(ink, e.colors.length - 1) || 1;
    changed();
  }));
  if (!mine) rows.push(words(L('Painting makes the game’s own copy of this engine image.', 'Malen legt eine eigene Kopie dieses Engine-Bildes im Spiel an.')));
  return section({ words: L('Colours', 'Farben') }, rows);
}

function pointsSection(img: Img): HTMLElement {
  const names = [...new Set(['foot', 'fx', ...Object.keys(img.points)])];
  const rows: Node[] = names.map((n) => {
    const p = img.points[n];
    const row = document.createElement('span');
    row.className = 'urow';
    row.append(
      pixelButton(L(`Set ${n} on the canvas`, `${n} auf der Fläche setzen`), { words: n, pressed: tool === 'point' && pointName === n }, () => { tool = 'point'; pointName = n; render(); }),
      words(p ? `${p.x}, ${p.y}` : '—'),
      ...(p ? [pixelButton(L('Remove', 'Entfernen'), { icon: 'close', flat: true }, () => { delete own()!.points[n]; changed(); })] : []),
    );
    return row;
  });
  rows.push(textField(L('New point', 'Neuer Punkt'), '', () => {}, { placeholder: L('name', 'Name'), done: (v) => {
    v = v.trim().toLowerCase();
    if (v && /^[a-z0-9-]+$/.test(v)) { tool = 'point'; pointName = v; render(); }
  }, width: 60 }));
  return section({ words: L('Points', 'Punkte') }, rows);
}

function dataSection(img: Img): HTMLElement {
  const rows: Node[] = Object.entries(img.data).map(([k, v]) => {
    const editable = typeof v === 'string' || typeof v === 'number';
    return editable
      ? textField(k, String(v), () => {}, { done: (s) => { own()!.data[k] = typeof v === 'number' && s.trim() !== '' && !isNaN(+s) ? +s : s; changed(); }, width: 80 })
      : field({ words: k }, words(JSON.stringify(v)));
  });
  if (!rows.length) rows.push(words(L('No data', 'Keine Daten')));
  return section({ words: L('Data', 'Daten') }, rows, false);
}

function renderInspector(img: Img | undefined) {
  if (!img) return inspector.body.replaceChildren(words(L('No image', 'Kein Bild')));
  const fixed = !!GRID[sheetName];
  inspector.body.replaceChildren(
    section({ words: L('Image', 'Bild') }, [
      textField(L('Name', 'Name'), img.name, () => {}, { done: rename, width: 80 }),
      field({ words: L('Sheet', 'Blatt') }, words(`${sheetWords(sheetName)}${img.from === 'engine' ? L(' (engine)', ' (Engine)') : ''}`)),
      ...(fixed ? [] : [fields(
        numberField({ words: 'W' }, img.w, (v) => reshape(v, img.h, img.frames), { min: 1, max: 256, width: 26 }),
        numberField({ words: 'H' }, img.h, (v) => reshape(img.w, v, img.frames), { min: 1, max: 256, width: 26 }),
      )]),
      fields(
        numberField({ words: L('Frames', 'Bilder') }, img.frames, (v) => reshape(img.w, img.h, v), { min: 1, max: 32, width: 44 }),
        numberField({ words: 'FPS' }, img.fps, (v) => { const m = own()!; m.fps = v; changed(); }, { min: 0, max: 30, width: 34 }),
      ),
    ]),
    colorsSection(img),
    pointsSection(img),
    dataSection(img),
  );
}

let renderCanvas = () => {};
function render(): void {
  if (!current()) imageName = Object.keys(shownOf(sheetName)).sort()[0] ?? '';
  list.redraw();
  const img = current();
  renderInspector(img);
  if (!img) return void area.replaceChildren(words(L('This sheet has no images yet', 'Dieses Blatt hat noch keine Bilder')));
  const tools = document.createElement('div');
  tools.className = 'urow';
  tools.append(...([
    ['draw', 'pencil', L('Draw', 'Malen')], ['erase', 'eraser', L('Erase', 'Radieren')], ['line', 'line', L('Line', 'Linie')],
    ['rect', 'rect', L('Rectangle', 'Rechteck')], ['fill', 'bucket', L('Fill', 'Füllen')], ['pick', 'pipette', L('Pick a colour', 'Farbe aufnehmen')],
  ] as const).map(([id, icon, words]) => pixelButton(words, { icon, flat: true, pressed: tool === id }, () => { tool = id; render(); })),
  pixelButton(L('Zoom in', 'Vergrößern'), { icon: 'zoomin', flat: true }, () => { zoom = Math.min(48, cellSize(img) + 4); prefs.zoom = zoom; keepPrefs(); render(); }),
  pixelButton(L('Zoom out', 'Verkleinern'), { icon: 'zoomout', flat: true }, () => { zoom = Math.max(2, cellSize(img) - 4); prefs.zoom = zoom; keepPrefs(); render(); }));
  const slot = document.createElement('div');
  renderCanvas = () => slot.replaceChildren(canvasOf(current()!));
  renderCanvas();
  area.replaceChildren(box(slot), box(tools), box(preview(img)));
}
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, textarea')) return;
  const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); (e.shiftKey ? undo.redo : undo.undo)(); return; }
  const keys: Record<string, Tool> = { b: 'draw', e: 'erase', l: 'line', r: 'rect', g: 'fill', i: 'pick' };
  if (keys[k] && !e.metaKey && !e.ctrlKey) { tool = keys[k]; render(); }
});
render();
