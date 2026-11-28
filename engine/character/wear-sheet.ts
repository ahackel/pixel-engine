// The wardrobe items drawn in the `sprite` format, kept as the engine's `wear` sheet (images/wear.png; docs/image-spec.md):
// an image `sprite-<set>-<n>` per item, its front and back views as frames, its colours named, its other fields as data.
// No glob, so scripts can read it under plain Node (with scripts/hooks.mjs).
import wearSheet from './images/wear.png?sheet';
import { names, sheet, splitName, type Img } from '../core/images.ts';

/** The wardrobe items in the `sprite` format: the `wear` sheet (images/wear.png), an image `sprite-<set>-<n>` per item. */
export const WEAR = sheet('wear', wearSheet);
/**
 * A `wear` image as the sprite format's input (items.ts `compileSprite`): its front and back frames as letter rows, a
 * capital letter per colour and the small one for its shade, and its data (name, slot and the rest).
 */
export function spriteInput(img: Img): Record<string, unknown> {
  const keys: string[] = [];
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const letter = (n: string | null) => {
    if (!n) return '.';
    const { key, tone } = splitName(n);
    if (!keys.includes(key)) keys.push(key);
    const ch = LETTERS[keys.indexOf(key)];
    return tone === 'shade' ? ch.toLowerCase() : ch;
  };
  const rows = (f: number) => names(img, f).map((row) => row.map(letter).join(''));
  const front = rows(0), back = rows(1);
  return { ...img.data, legend: Object.fromEntries(keys.map((k, i) => [LETTERS[i], k])), front, back };
}
