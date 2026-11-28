import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { decodePng, encodePng } from '../shared/png.ts';
import { colorOfName, imgFromRows, pack, picture, rawOf, readSheet, swapped, cells } from '../engine/core/images.ts';
import { PALETTE } from '../engine/core/palette.ts';

const inflate = (b: Uint8Array) => new Uint8Array(inflateSync(b));
const deflate = (b: Uint8Array) => new Uint8Array(deflateSync(b));

test('an indexed PNG reads back as written', () => {
  const img = { w: 3, h: 2, pixels: new Uint8Array([0, 1, 2, 2, 1, 0]), colors: ['#000000', '#ff0000', '#00ff7f'] };
  const back = decodePng(encodePng(img, deflate), inflate);
  assert.deepEqual(back, img);
});

test('a packed sheet reads back with its frames, points, names and data', () => {
  const torch = imgFromRows('torch', 'game', [['.a.', 'bab'], ['a..', 'bab']], { a: 'flame', b: 'wood-' });
  torch.fps = 8;
  torch.points = { foot: { x: 1, y: 1 }, fx: { x: 1, y: 0 } };
  torch.data = { hold: 'pole' };
  const stone = imgFromRows('stone', 'game', [['cc', 'cd']], { c: '#c9c5bd', d: 'stone' });
  const packed = pack('items', 'game', [torch, stone]);
  const png = decodePng(encodePng(packed, deflate), inflate);
  const sheet = readSheet({ ...rawOf('items', packed), colors: png.colors });
  const t = sheet.images.torch;
  assert.equal(t.frames, 2);
  assert.equal(t.fps, 8);
  assert.deepEqual(t.points, torch.points);
  assert.deepEqual(t.data, { hold: 'pole' });
  assert.equal(picture(t, 1).get(0, 0), PALETTE.flame.base);
  assert.equal(picture(t, 0).get(0, 1), PALETTE.wood.shade);
  assert.equal(picture(t, 0).get(0, 0), null);
  assert.equal(picture(sheet.images.stone).get(0, 0), '#c9c5bd');
  assert.deepEqual(cells(t, 0)[1][0], { key: 'wood', shade: true });
  assert.equal(packed.atlas.frames['torch 1'].duration, 125);
});

test('names resolve through the palette and swap with their tones', () => {
  assert.equal(colorOfName('game', 'red+'), PALETTE.red.light);
  assert.equal(swapped('red-', { red: 'blue' }), 'blue-');
  const shirt = imgFromRows('shirt', 'game', [['r']], { r: 'red-' });
  assert.equal(picture(shirt, 0, { red: 'blue' }).get(0, 0), PALETTE.blue.shade);
});
