// Lets plain Node load what Vite's plugins give the engine: `?sheet` imports of image sheets (dev/sheet-plugin.ts).
// Every Node entry that reaches a sheet runs with it: `node --import ./scripts/hooks.mjs ...` (tests, checks, scripts).
import { register } from 'node:module';

register('./sheet-hook.mjs', import.meta.url);
