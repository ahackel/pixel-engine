// Checks every image sheet (docs/image-spec.md): the PNG is 8-bit indexed with index 0 see-through and matches its
// atlas; every image is one strip of frames of one size, inside the sheet and overlapping no other; every named colour
// is one its palette knows, and the wardrobe's sheet has no free colours; reading and writing a sheet gives the same.
// Run from the engine or a game: node --import ./engine/scripts/hooks.mjs engine/scripts/images-check.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { decodePng, encodePng } from '../shared/png.ts';
import { knownName, pack, readSheet, setEditorColors, setGameColors } from '../engine/core/images.ts';
import { EDITOR_COLORS } from '../ui/theme.ts';

const engine = path.resolve(import.meta.dirname, '..');
const game = existsSync(path.join(engine, '..', 'src', 'content')) ? path.join(engine, '..', 'src', 'content') : null;
setEditorColors(EDITOR_COLORS);
if (game && existsSync(path.join(game, 'palette.json'))) setGameColors(JSON.parse(readFileSync(path.join(game, 'palette.json'), 'utf8')));

const DIRS = [path.join(engine, 'ui', 'images'), path.join(engine, 'engine', 'character', 'images'), ...(game ? [path.join(game, 'images')] : [])];
/** Sheets that may only use named colours, because players swap them. */
const NAMED_ONLY = new Set(['wear']);

const inflate = (b) => new Uint8Array(inflateSync(b));
let bad = 0, count = 0, images = 0;
const fail = (where, msg) => (bad++, console.log(`${where}: ${msg}`));
for (const dir of DIRS) {
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.png')).sort()) {
    const where = path.relative(path.join(engine, '..'), path.join(dir, file));
    const name = file.slice(0, -4);
    count++;
    let png, atlas;
    try { png = decodePng(new Uint8Array(readFileSync(path.join(dir, file))), inflate); } catch (e) { fail(where, e.message); continue; }
    try { atlas = JSON.parse(readFileSync(path.join(dir, name + '.json'), 'utf8')); } catch (e) { fail(where, `atlas: ${e.message}`); continue; }
    const { meta, frames } = atlas;
    if (meta?.format !== 'I8') fail(where, 'atlas format is not I8');
    if (meta?.size?.w !== png.w || meta?.size?.h !== png.h) fail(where, `atlas size ${meta?.size?.w}x${meta?.size?.h} is not the PNG's ${png.w}x${png.h}`);
    if (meta?.palette !== 'game' && meta?.palette !== 'editor') { fail(where, `unknown palette ${meta?.palette}`); continue; }
    const covered = new Map();
    let total = 0;
    for (const tag of meta.frameTags) {
      images++;
      const n = tag.to - tag.from + 1;
      total += n;
      const rects = Array.from({ length: n }, (_, f) => frames[`${tag.name} ${f}`]?.frame);
      if (rects.some((r) => !r)) { fail(where, `${tag.name}: frames missing`); continue; }
      if (rects.some((r) => r.w !== rects[0].w || r.h !== rects[0].h)) fail(where, `${tag.name}: frames of different sizes`);
      for (const r of rects) {
        if (r.x < 0 || r.y < 0 || r.x + r.w > png.w || r.y + r.h > png.h) fail(where, `${tag.name}: a frame lies outside the sheet`);
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
          const k = y * png.w + x;
          if (covered.has(k) && covered.get(k) !== tag.name) { fail(where, `${tag.name} overlaps ${covered.get(k)}`); y = Infinity; break; }
          covered.set(k, tag.name);
        }
      }
    }
    if (total !== Object.keys(frames).length) fail(where, `${Object.keys(frames).length} frames, but the tags hold ${total}`);
    if (new Set(meta.frameTags.map((t) => t.name)).size !== meta.frameTags.length) fail(where, 'two images of one name');
    for (const [i, n] of Object.entries(meta.names ?? {})) if (!knownName(meta.palette, n)) fail(where, `colour ${i} is named ${n}, which the ${meta.palette} palette does not know`);
    const used = new Set(png.pixels);
    if (NAMED_ONLY.has(name)) for (const i of used) if (i && !meta.names?.[i]) fail(where, `colour ${i} (${png.colors[i]}) is free, but ${name} only allows named colours`);
    // Read, write, read: the same images.
    const raw = { name, w: png.w, h: png.h, colors: png.colors, pixels: Buffer.from(png.pixels).toString('base64'), atlas };
    const sheet = readSheet(raw);
    const again = pack(name, meta.palette, Object.values(sheet.images), name === 'icons' ? { grid: 9 } : {});
    const back = decodePng(encodePng(again, (b) => new Uint8Array(deflateSync(b))), inflate);
    const sheet2 = readSheet({ ...raw, w: back.w, h: back.h, colors: back.colors, pixels: Buffer.from(back.pixels).toString('base64'), atlas: again.atlas });
    for (const [n, img] of Object.entries(sheet.images)) {
      const b = sheet2.images[n];
      const same = b && b.w === img.w && b.h === img.h && b.frames === img.frames &&
        img.px.every((v, k) => (v ? img.colors[v].name ?? img.colors[v].hex : '') === (b.px[k] ? b.colors[b.px[k]].name ?? b.colors[b.px[k]].hex : ''));
      if (!same) fail(where, `${n} does not read back as written`);
    }
  }
}
console.log(bad ? `${bad} problems in ${count} sheets` : `Images ok: ${count} sheets, ${images} images`);
if (bad) process.exit(1);
