// Turns a sheet's two files (`<name>.png`, `<name>.json`) into the module a `?sheet` import gives (engine/core/images.ts
// RawSheet). Shared by the Vite plugin (sheet-plugin.ts) and the Node hook (scripts/hooks.mjs). Node only.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { decodePng } from '../shared/png.ts';

/** The JS source of a sheet module, from the PNG's path. */
export function sheetSource(png: string): string {
  const img = decodePng(new Uint8Array(readFileSync(png)), (b) => new Uint8Array(inflateSync(b)));
  const json = png.replace(/\.png$/, '.json');
  const atlas = existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')) : null;
  if (!atlas) throw new Error(`${png}: no atlas ${path.basename(json)} beside it`);
  const raw = { name: path.basename(png, '.png'), w: img.w, h: img.h, colors: img.colors, pixels: Buffer.from(img.pixels).toString('base64'), atlas };
  return `export default ${JSON.stringify(raw)};\n`;
}
