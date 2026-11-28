// Writing sheets from Node scripts (to-sheets.mjs, the import of the model's wardrobe items): the PNG and its atlas,
// written as the dev server's save endpoint writes them.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { encodePng } from '../shared/png.ts';
import { pack } from '../engine/core/images.ts';

/** Packs images and writes `<dir>/<name>.png` and `<dir>/<name>.json`. */
export function writeSheetFiles(dir, name, palette, images, layout = {}) {
  const packed = pack(name, palette, images, layout);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.png`), encodePng(packed, (b) => new Uint8Array(deflateSync(b, { level: 9 }))));
  writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(packed.atlas, null, 1) + '\n');
  return packed;
}
