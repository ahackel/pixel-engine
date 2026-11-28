import type { Plugin } from 'vite';
import { sheetSource } from './sheet-module.ts';

/**
 * `import icons from './images/icons.png?sheet'`: the sheet decoded at build time into a module (engine/core/images.ts
 * RawSheet), so drawing from it needs nothing fetched or decoded while the game runs. Its atlas beside it is watched too.
 */
export function sheets(): Plugin {
  return {
    name: 'pixel-sheets',
    enforce: 'pre',
    load(id) {
      const [file, query] = id.split('?');
      if (query !== 'sheet' || !file.endsWith('.png')) return;
      this.addWatchFile(file);
      this.addWatchFile(file.replace(/\.png$/, '.json'));
      return sheetSource(file);
    },
  };
}
