// Converts the old picture formats into image sheets, once (docs/image-spec.md, Converting what exists). Each step reads
// the old files, writes the sheets and removes what it read; the engine keeps no reader of the old formats.
// Run from the game's root: node --import ./scripts/pixel-alias.mjs engine/scripts/to-sheets.mjs <step> [files]
// (steps: icons, wear, faces). `wear` is also how a new answer of the model is imported: give its file.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { imgFromRows, readSheet } from '../engine/core/images.ts';
import { sheetSource } from '../dev/sheet-module.ts';
import { PAINT_LETTERS } from '../ui/theme.ts';
import { writeSheetFiles } from './sheet-files.mjs';

const engine = path.resolve(import.meta.dirname, '..');
const game = path.resolve(engine, '..');
const content = path.join(game, 'src', 'content');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** The images of a sheet already written, by name (none when there is no sheet yet). */
async function existing(dir, name) {
  const png = path.join(dir, `${name}.png`);
  if (!existsSync(png)) return {};
  const raw = await import('data:text/javascript,' + encodeURIComponent(sheetSource(png)));
  return readSheet(raw.default, 'engine').images;
}

/** Rows cut or padded to w by h, as the item compiler reads them. */
const fit = (rows, w, h) => Array.from({ length: h }, (_, y) => (rows[y] ?? '').padEnd(w, '.').slice(0, w));

/** The face roles: the letters of a face stamp and their names in the game palette. */
export const FACE_ROLES = { I: 'face.ink', C: 'face.eye', T: 'face.white', M: 'face.mouth', '%': 'face.skin-', e: 'face.brow' };

const STEPS = {
  /** The 9 by 9 icons: ui/icons.json and the game's src/content/icons.json. */
  icons() {
    for (const [file, dir] of [[path.join(engine, 'ui', 'icons.json'), path.join(engine, 'ui', 'images')], [path.join(content, 'icons.json'), path.join(content, 'images')]]) {
      if (!existsSync(file)) continue;
      const lib = read(file);
      const images = Object.entries(lib).map(([name, rows]) => imgFromRows(name, 'editor', [rows], PAINT_LETTERS));
      writeSheetFiles(dir, 'icons', 'editor', images, { grid: 9 });
      rmSync(file);
      console.log(`${path.relative(game, file)} -> ${path.relative(game, dir)}/icons.png (${images.length} icons)`);
    }
  },
  /**
   * Wardrobe items in the `sprite` format (the model's answers, `engine/character/data/sprite-<set>.json`, or the files
   * given) into the engine's `wear` sheet: one image per item, `sprite-<set>-<n>`, its front and back views as frames, its
   * legend as named colours (a capital letter the colour, a small one its shade), its other fields as data. Each answer is
   * removed once imported: the sheet is the only copy.
   */
  async wear(...files) {
    const data = path.join(engine, 'engine', 'character', 'data');
    const dir = path.join(engine, 'engine', 'character', 'images');
    const list = files.length ? files : readdirSync(data).filter((f) => /^sprite-.*\.json$/.test(f)).sort().map((f) => path.join(data, f));
    const images = await existing(dir, 'wear');
    for (const file of list) {
      const set = path.basename(file).match(/^sprite-(.*)\.json$/)?.[1];
      if (!set) throw new Error(`${file}: not a sprite-<set>.json answer`);
      read(file).forEach(({ front, back, legend, ...rest }, n) => {
        const names = {};
        for (const [ch, key] of Object.entries(legend)) { names[ch.toUpperCase()] = key; names[ch.toLowerCase()] = `${key}-`; }
        const img = imgFromRows(`sprite-${set}-${n}`, 'game', [fit(front, 32, 48), fit(back, 32, 48)], names);
        img.data = rest;
        images[img.name] = img;
      });
      rmSync(file);
      console.log(`${path.relative(game, file)} -> wear`);
    }
    writeSheetFiles(dir, 'wear', 'game', Object.values(images));
  },
  /** The eyes, mouths and brows (`face-shapes.json`, the engine's and a game's) into the `faces` sheets, in the face roles. */
  async faces() {
    const { EYE_STATES, MOODS, BROW_STATES, FACE_REGIONS } = await import('../engine/character/base.ts');
    for (const [file, dir] of [[path.join(engine, 'engine', 'character', 'face-shapes.json'), path.join(engine, 'engine', 'character', 'images')], [path.join(content, 'face-shapes.json'), path.join(content, 'images')]]) {
      if (!existsSync(file)) continue;
      const shapes = read(file);
      const images = [];
      const add = (name, frames, [, , w, h]) => images.push(imgFromRows(name, 'game', frames.map((rows) => fit(rows ?? [], w, h)), FACE_ROLES));
      for (const [view, byShape] of Object.entries(shapes.eyes)) for (const [shape, states] of Object.entries(byShape)) add(`eyes-${view}-${shape}`, EYE_STATES.map((s) => states[s]), FACE_REGIONS.eyes[view]);
      for (const [view, moods] of Object.entries(shapes.mouths)) add(`mouths-${view}`, MOODS.map((m) => moods[m]), FACE_REGIONS.mouths[view]);
      for (const [view, byStyle] of Object.entries(shapes.brows)) for (const [style, states] of Object.entries(byStyle)) add(`brows-${view}-${style}`, BROW_STATES.map((s) => states[s]), FACE_REGIONS.brows[view]);
      writeSheetFiles(dir, 'faces', 'game', images);
      rmSync(file);
      console.log(`${path.relative(game, file)} -> ${path.relative(game, dir)}/faces.png (${images.length} images)`);
    }
  },
  /** Writes sheets again as they are (the PNG's stored colours become the palette's current ones): give their PNGs. */
  async repack(...pngs) {
    for (const png of pngs) {
      const name = path.basename(png, '.png');
      const images = await existing(path.dirname(path.resolve(png)), name);
      const palette = Object.values(images)[0]?.palette ?? 'game';
      writeSheetFiles(path.dirname(path.resolve(png)), name, palette, Object.values(images), name === 'icons' ? { grid: 9 } : {});
      console.log(`${png}: ${Object.keys(images).length} images written again`);
    }
  },
};

const [step, ...args] = process.argv.slice(2);
if (!STEPS[step]) throw new Error(`no step ${step}: ${Object.keys(STEPS).join(', ')}`);
await STEPS[step](...args);
