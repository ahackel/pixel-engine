// 8-bit indexed PNGs, the one image format of the engine's sheets (docs/image-spec.md): read and write, no dependency
// and no DOM. Compression is passed in, so the same code runs in Node (node:zlib) and the browser (CompressionStream).

/** An indexed image: one byte per pixel, an index into `colors` (`#rrggbb`); index 0 is transparent. */
export interface Indexed { w: number; h: number; pixels: Uint8Array; colors: string[] }

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (bytes: Uint8Array, start: number, end: number): number => {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** Whether bytes start like a PNG. */
export const isPng = (b: Uint8Array): boolean => b.length > 8 && SIGNATURE.every((v, i) => b[i] === v);

/** The chunks of a PNG, by type, in order. */
function chunks(bytes: Uint8Array): { type: string; data: Uint8Array }[] {
  if (!isPng(bytes)) throw new Error('not a PNG');
  const out: { type: string; data: Uint8Array }[] = [];
  for (let o = 8; o + 8 <= bytes.length; ) {
    const len = u32(bytes, o);
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    out.push({ type, data: bytes.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

/** A PNG's header: size, bit depth and colour type. */
export function pngHeader(bytes: Uint8Array): { w: number; h: number; depth: number; type: number } {
  const ihdr = chunks(bytes).find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('PNG has no IHDR');
  return { w: u32(ihdr.data, 0), h: u32(ihdr.data, 4), depth: ihdr.data[8], type: ihdr.data[9] };
}

const hex2 = (v: number) => v.toString(16).padStart(2, '0');

/** Reads an 8-bit indexed PNG. `inflate` undoes zlib compression. Colours past the palette's end read as index 0. */
export function decodePng(bytes: Uint8Array, inflate: (data: Uint8Array) => Uint8Array): Indexed {
  const all = chunks(bytes);
  const { w, h, depth, type } = pngHeader(bytes);
  if (type !== 3 || depth !== 8) throw new Error(`PNG is not 8-bit indexed (type ${type}, depth ${depth})`);
  if (all.find((c) => c.type === 'IHDR')!.data[12]) throw new Error('interlaced PNGs are not read');
  const plte = all.find((c) => c.type === 'PLTE')?.data ?? new Uint8Array(0);
  const colors: string[] = [];
  for (let i = 0; i + 2 < plte.length; i += 3) colors.push('#' + hex2(plte[i]) + hex2(plte[i + 1]) + hex2(plte[i + 2]));
  const parts = all.filter((c) => c.type === 'IDAT').map((c) => c.data);
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((o, p) => (joined.set(p, o), o + p.length), 0);
  const raw = inflate(joined);
  const pixels = new Uint8Array(w * h);
  let prev = new Uint8Array(w);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)];
    const line = raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1));
    const out = new Uint8Array(w);
    for (let x = 0; x < w; x++) {
      const a = x ? out[x - 1] : 0, b = prev[x], c = x ? prev[x - 1] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = v & 0xff;
    }
    pixels.set(out, y * w);
    prev = out;
  }
  for (let i = 0; i < pixels.length; i++) if (pixels[i] >= colors.length) pixels[i] = 0;
  return { w, h, pixels, colors };
}

/** The image's scanlines, each with filter 0 (none), ready for zlib. */
export function scanlines(img: Indexed): Uint8Array {
  const raw = new Uint8Array((img.w + 1) * img.h);
  for (let y = 0; y < img.h; y++) raw.set(img.pixels.subarray(y * img.w, (y + 1) * img.w), y * (img.w + 1) + 1);
  return raw;
}

/** A PNG from an image and its zlib-compressed scanlines: IHDR, PLTE, tRNS (index 0 transparent), IDAT, IEND. */
export function assemblePng(img: Indexed, compressed: Uint8Array): Uint8Array {
  if (img.colors.length > 256) throw new Error('more than 256 colours');
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, img.w);
  dv.setUint32(4, img.h);
  ihdr.set([8, 3, 0, 0, 0], 8);
  const plte = new Uint8Array(Math.max(1, img.colors.length) * 3);
  img.colors.forEach((c, i) => plte.set([1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16) || 0), i * 3));
  const parts: [string, Uint8Array][] = [['IHDR', ihdr], ['PLTE', plte], ['tRNS', new Uint8Array([0])], ['IDAT', compressed], ['IEND', new Uint8Array(0)]];
  const out = new Uint8Array(8 + parts.reduce((n, [, d]) => n + 12 + d.length, 0));
  out.set(SIGNATURE);
  let o = 8;
  for (const [type, data] of parts) {
    new DataView(out.buffer).setUint32(o, data.length);
    for (let i = 0; i < 4; i++) out[o + 4 + i] = type.charCodeAt(i);
    out.set(data, o + 8);
    new DataView(out.buffer).setUint32(o + 8 + data.length, crc32(out, o + 4, o + 8 + data.length));
    o += 12 + data.length;
  }
  return out;
}

/** Writes an indexed PNG, compressing with `deflate` (zlib format). */
export const encodePng = (img: Indexed, deflate: (data: Uint8Array) => Uint8Array): Uint8Array => assemblePng(img, deflate(scanlines(img)));

/** Writes an indexed PNG in the browser, compressing with CompressionStream. */
export async function encodePngInBrowser(img: Indexed): Promise<Uint8Array> {
  const stream = new Blob([scanlines(img) as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return assemblePng(img, new Uint8Array(await new Response(stream).arrayBuffer()));
}
