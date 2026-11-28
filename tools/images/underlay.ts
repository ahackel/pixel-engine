// What the image editor draws faintly under an image while it is painted (an onion skin): for wardrobe items the bare
// body standing, front and back; for faces the head of the view, where the stamp sits on it. `under(ctx, x, frame)` draws
// it for one frame with its left edge at x.
import type { Img } from '../../engine/core/images.ts';
import { BODY_WINDOW, drawCharacter } from '../../engine/core/puppet.ts';
import { STAND } from '../../engine/core/poses.ts';
import { baseLook, FACE_REGIONS, headRows, type FaceView } from '../../engine/character/base.ts';
import { PALETTE } from '../../engine/core/palette.ts';

/** Draws the onion skin of a frame; `alpha`, how strongly (the head's skin is near the editor's checker, so it shows stronger). */
export type Underlay = ((ctx: CanvasRenderingContext2D, x: number, frame: number) => void) & { alpha?: number };

/** The onion skin of an image of a sheet, or null for none. */
export function underlayOf(sheet: string, img: Img): Underlay | null {
  if (sheet === 'wear' && img.w === BODY_WINDOW.w && img.h === BODY_WINDOW.h) {
    // The model's grids: front then back, over the standing body.
    const look = baseLook();
    const bodies = [drawCharacter(look, STAND, 0), drawCharacter(look, STAND, 3)];
    return (ctx, x0, frame) => {
      const body = bodies[frame];
      if (!body) return;
      for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
        const c = body.get(x + BODY_WINDOW.x, y + BODY_WINDOW.y);
        if (c) { ctx.fillStyle = c; ctx.fillRect(x0 + x, y, 1, 1); }
      }
    };
  }
  const m = sheet === 'faces' ? img.name.match(/^(eyes|mouths|brows)-(diagonal|front|side)\b/) : null;
  if (m) {
    const [x0, y0] = FACE_REGIONS[m[1] as 'eyes'][m[2] as FaceView];
    const head = headRows(m[2] as FaceView);
    const skin = PALETTE.skinB;
    const under: Underlay = (ctx, left) => {
      for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
        const ch = head[y0 + y]?.[x0 + x];
        if (ch && ch !== '.') { ctx.fillStyle = ch === '%' ? skin.shade : skin.base; ctx.fillRect(left + x, y, 1, 1); }
      }
    };
    under.alpha = 0.8;
    return under;
  }
  return null;
}
