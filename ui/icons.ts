// The shared icon library: the 9 by 9 pictures of the `icons` sheet (ui/images/icons.png, in the editor palette), drawn
// and edited in the image editor (tools/images). A game's own `icons` sheet (src/content/images/) adds to it and
// overrides by name. `ICONS` gives them as rows of letters (PAINT_LETTERS in theme.ts), which `drawRows` paints.
import engineIcons from './images/icons.png?sheet';
import { names, setEditorColors, sheet } from '../engine/core/images.ts';
import { EDITOR_COLORS, PAINT_LETTERS } from './theme.ts';

setEditorColors(EDITOR_COLORS);
const LETTER = Object.fromEntries(Object.entries(PAINT_LETTERS).map(([ch, name]) => [name, ch]));

/** The icons sheet: the engine's, the game's laid over. */
export const iconSheet = () => sheet('icons', engineIcons);

/** Every icon by name as letter rows: the engine's, then the game's laid over. */
export const ICONS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.values(iconSheet().images).map((img) => [img.name, names(img).map((row) => row.map((n) => (n && LETTER[n]) || '.').join(''))]),
);
/** An icon's name. */
export type Icon = string;

/** An icon's rows; the question-mark box for a name that is not there. */
export const iconRows = (name: string): readonly string[] => ICONS[name] ?? ICONS.missing;
