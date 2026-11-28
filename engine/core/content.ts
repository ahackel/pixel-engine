// What the editors make, kept as the project's files (docs/image-spec.md, Tools save to the project): JSON in the game's
// `src/content/`, read on every visit with import.meta.glob, so a change made outside the editor (a git revert, a pull)
// always shows. An editor changes it in memory (`writeContent`) and writes it with "Save to project" (`saveContent`);
// nothing is kept on the device. The game reads the same files.
//
// Painted pixels in a file (every `Art` of engine/core/stamp.ts in it) are saved as an image sheet of the same name
// (`images/<name>.png`): the JSON keeps `{ "image": "<name>" }` in each one's place, and reading puts the art back.
import type { Art } from './stamp.ts';
import { gameRawSheet, pack, readSheet, NAME, type Img } from './images.ts';
import { encodePngInBrowser } from '../../shared/png.ts';
import { saveSheetToProject, saveToProject } from '../../shared/project.ts';

/** The project's content files as they were when the page loaded, by file name (`props.json`). Empty under plain Node. */
const files: Record<string, unknown> = {};
try {
  for (const [path, value] of Object.entries(import.meta.glob('/src/content/*.json', { eager: true, import: 'default' }))) files[path.slice(path.lastIndexOf('/') + 1)] = value;
} catch { /* plain Node has no import.meta.glob */ }

/** What an editor changed this visit, by file name; saved or not. */
const live = new Map<string, unknown>();
// Leaving a page with unsaved changes asks first: they are in memory only.
if (typeof window !== 'undefined') window.addEventListener('beforeunload', (e) => { if ([...live.keys()].some(contentChanged)) e.preventDefault(); });
/** The JSON of each file as the project holds it now: as loaded, then as last saved. */
const saved = new Map<string, string>();

const isArt = (v: any): v is Art => !!v && typeof v === 'object' && typeof v.w === 'number' && typeof v.h === 'number' && typeof v.ox === 'number' &&
  typeof v.oy === 'number' && !!v.legend && typeof v.legend === 'object' && Array.isArray(v.views);
const isRef = (v: any): v is { image: string } => !!v && typeof v === 'object' && typeof v.image === 'string' && Object.keys(v).length === 1;

/** A file's value with every `{ image }` put back as the art of its sheet's image (a missing image: left out). */
function withArt(value: unknown, sheetName: string): unknown {
  const raw = gameRawSheet(sheetName);
  const images = raw ? readSheet(raw, 'game').images : {};
  const walk = (v: any): any => {
    if (isRef(v)) return images[v.image] ? artOfImg(images[v.image]) : undefined;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]).filter(([, x]) => x !== undefined));
    return v;
  };
  return walk(value);
}

/** A file's value with every art taken out as an image, named by where it is (an array's element by its `id`). */
function withoutArt(value: unknown): { json: unknown; images: Img[] } {
  const images: Img[] = [];
  const used = new Set<string>();
  const nameOf = (path: string[]) => {
    const base = path.join('.').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^[^a-z0-9]+/, '') || 'art';
    let name = base, n = 1;
    while (used.has(name) || !NAME.test(name)) name = `${base}-${++n}`;
    used.add(name);
    return name;
  };
  const walk = (v: any, path: string[]): any => {
    if (isArt(v)) {
      const img = imgOfArt(nameOf(path), v);
      images.push(img);
      return { image: img.name };
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, [...path, typeof x?.id === 'string' ? x.id : String(i)]));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, [...path, k])]));
    return v;
  };
  return { json: walk(value, []), images };
}

/** Art as an image: its views as frames, its pivot as the `foot` point, its legend's codes as palette names. */
export function imgOfArt(name: string, art: Art): Img {
  const colors = [{ hex: '#000000' }] as Img['colors'];
  const slot = new Map<string, number>();
  const px = new Uint8Array(art.w * art.views.length * art.h);
  art.views.forEach((rows, f) => rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const code = art.legend[ch];
    if (!code || x >= art.w || y >= art.h) return;
    let i = slot.get(code);
    if (i === undefined) slot.set(code, (i = colors.push({ hex: '#000000', name: code }) - 1));
    px[y * art.w * art.views.length + f * art.w + x] = i;
  })));
  return { name, w: art.w, h: art.h, frames: art.views.length, fps: 0, points: { foot: { x: art.ox, y: art.oy } }, data: {}, px, colors, palette: 'game', from: 'game' };
}
/** An image as art: its frames as views, its `foot` as the pivot. Free colours are left out (art is palette cells only). */
export function artOfImg(img: Img): Art {
  const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=?@^~';
  const legend: Record<string, string> = {};
  const charOf = img.colors.map((c, i) => {
    if (!i || !c.name) return '.';
    const ch = CHARS[Object.keys(legend).length] ?? '.';
    legend[ch] = c.name;
    return ch;
  });
  const stride = img.w * img.frames;
  const views = Array.from({ length: img.frames }, (_, f) => Array.from({ length: img.h }, (_, y) =>
    Array.from({ length: img.w }, (_, x) => charOf[img.px[y * stride + f * img.w + x]] ?? '.').join('')));
  const foot = img.points.foot ?? { x: Math.floor(img.w / 2), y: img.h - 1 };
  return { w: img.w, h: img.h, ox: foot.x, oy: foot.y, legend, views };
}

/** Which sheet holds a file's pixels: the file's own name (`props.json`, the `props` sheet). */
const sheetOf = (file: string) => file.replace(/\.json$/, '');

/** A content file's value: as changed this visit, else as the project holds it (its art put back), else `fallback`. A copy. */
export function readContent<T>(file: string, fallback: T): T {
  if (live.has(file)) return structuredClone(live.get(file)) as T;
  if (!(file in files)) return fallback;
  const value = withArt(files[file], sheetOf(file));
  if (!saved.has(file)) saved.set(file, JSON.stringify(value));
  return structuredClone(value) as T;
}

/** Changes a content file in memory (saved to the project with `saveContent`). Always true: memory does not refuse. */
export function writeContent(file: string, value: unknown): boolean {
  if (!saved.has(file)) saved.set(file, JSON.stringify(file in files ? withArt(files[file], sheetOf(file)) : null));
  live.set(file, structuredClone(value));
  return true;
}

/** Whether a content file was changed and not saved. */
export const contentChanged = (file: string): boolean => live.has(file) && JSON.stringify(live.get(file)) !== saved.get(file);

/**
 * Writes changed content files into the project: the JSON, and its art as the file's sheet. Resolves to whether all were
 * written (the dev server only); false when one could not be, or nothing had changed.
 */
export async function saveContent(names: string[]): Promise<boolean> {
  let wrote = false;
  for (const file of names) {
    if (!contentChanged(file)) continue;
    const value = live.get(file);
    const { json, images } = withoutArt(value);
    if (images.length) {
      const packed = pack(sheetOf(file), 'game', images);
      if (!(await saveSheetToProject(sheetOf(file), await encodePngInBrowser(packed), packed.atlas))) return false;
    }
    if (!(await saveToProject(file, json))) return false;
    saved.set(file, JSON.stringify(value));
    wrote = true;
  }
  return wrote;
}

/** Tracking for a header's save button: whether these files have unsaved changes, and a way to save them. */
export const contentTracker = (names: string[]) => ({ unsaved: () => names.some(contentChanged), saveNow: () => saveContent(names) });

/** The named things a tool keeps in a content file: a list of `{ id, name, [field] }`, each value checked by `clean`. */
export function contentList<K extends string, T>(file: string, field: K, clean: (raw: unknown) => T): ({ id: string; name: string } & Record<K, T>)[] {
  const list = readContent<unknown>(file, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string')
    .map((s) => ({ id: s.id, name: s.name.slice(0, 40), [field]: clean(s[field]) }) as { id: string; name: string } & Record<K, T>);
}
