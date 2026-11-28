// The look every pixel interface shares: colours, the icon palette and how many screen pixels one interface pixel takes.

/** How many screen pixels one interface pixel takes: big enough to tap on an iPad, which the games are made for. */
export const S = 4;

/** `paper` is a button's own colour; `panel` the slightly darker ground panels, popups and the header lay them on, so buttons stand out. */
export const C = {
  ink: '#2b1d12', paper: '#f6ecd2', panel: '#e9dcb9', empty: '#f6ecd28c', shadow: '#00000040', track: '#e2d3ae', hunger: '#e0862e', energy: '#4f9ad6', low: '#d9412b',
  lit: '#e8862a', night: '#2f3b6e', moon: '#f3eccf', white: '#ffffff',
};

/** The editor palette: the named colours of the editor and UI assets (the `icons` sheets, docs/image-spec.md). */
export const EDITOR_COLORS: Record<string, string> = {
  ink: C.ink, red: '#d9412b', navy: '#2f3b6e', ice: '#cfe6f2', brown: '#8a5a2b', yellow: '#f6c94a', orange: '#e8862a', blue: '#4f9ad6',
  cream: '#f6e6a6', sand: '#d8c27a', white: '#ffffff', silver: '#c9c9c9', grey: '#6b6b6b', mint: '#a9d98a', green: '#3f7a3a', maroon: '#8a2a1e',
};

/** The letter each editor colour has in icon rows (`ICONS`, `drawRows`). */
export const PAINT_LETTERS: Record<string, string> = {
  x: 'ink', r: 'red', b: 'navy', g: 'ice', h: 'brown', y: 'yellow', o: 'orange', w: 'blue', m: 'cream', s: 'sand', t: 'white', l: 'silver', d: 'grey', e: 'mint', f: 'green', n: 'maroon',
};

/** What each character of an icon's rows paints; '.' is nothing. */
export const PAINT: Record<string, string> = Object.fromEntries(Object.entries(PAINT_LETTERS).map(([ch, name]) => [ch, EDITOR_COLORS[name]]));
