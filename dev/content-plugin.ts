import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { pngHeader, isPng } from '../shared/png.ts';

/** Server-side checks for files whose shape matters, by file name. Others only have to be JSON. */
export const VALIDATORS: Record<string, (data: any) => boolean> = {};

/** Only plain relative `a/b-c.json` names: no `..`, no absolute paths, no dot files. */
const NAME = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*\.json$/i;
/** Sheets: `images/<name>.png` (8-bit indexed) and its atlas `images/<name>.json`. */
const SHEET = /^images\/[a-z0-9][a-z0-9-]*\.(png|json)$/;

/** Whether an atlas fits the PNG beside it (when there is one): its format and size. */
function atlasFits(atlas: any, png: string): boolean {
  const meta = atlas?.meta;
  if (!meta || meta.format !== 'I8' || !atlas.frames || !Array.isArray(meta.frameTags) || !meta.size) return false;
  if (!existsSync(png)) return true;
  const head = pngHeader(new Uint8Array(readFileSync(png)));
  return head.w === meta.size.w && head.h === meta.size.h;
}

/**
 * Lets the editors save into the project while developing: `POST /__save/<name>.json` writes the JSON body to
 * `<dir>/<name>.json`, and `DELETE /__save/<name>.json` removes that file (a scene saved under a name it no longer
 * has). A game passes its content folder (`src/content`), so everything an editor saves is a file in the game's repo
 * to commit. Image sheets are `images/<name>.png` (an 8-bit indexed PNG body, checked) and their atlas
 * `images/<name>.json` (checked against the PNG's size). Dev server only: the published build has no such endpoint and `import.meta.env.DEV` is
 * false there. The editor already shows what it saved, so its own saves do not reload the page; an edit by hand still does.
 */
export function contentSave(options: { dir: string }): Plugin {
  const written = new Map<string, string>();
  /** Files the editors removed: their going does not reload the page either. */
  const removed = new Set<string>();
  let root = process.cwd();
  return {
    name: 'content-save',
    configResolved: (config) => void (root = config.root),
    // Vite 6 and later: called for files made, changed and removed. A folder read with import.meta.glob would otherwise
    // reload the page when the editor adds a file to it or removes one; last, so it comes after Vite's own glob update.
    hotUpdate: {
      order: 'post',
      handler({ type, file, read, modules, timestamp }) {
        // No update is sent to the page, but the modules are invalidated, so the next visit reads the file afresh (a new
        // file joins its folder's glob).
        const quiet = () => {
          for (const m of modules) this.environment.moduleGraph.invalidateModule(m, new Set(), timestamp, true);
          return [];
        };
        if (type === 'delete') return removed.has(file) ? quiet() : undefined;
        const text = written.get(file);
        if (text === undefined) return;
        return Promise.resolve(read()).then((now) => (now === text ? quiet() : undefined));
      },
    },
    // Older Vite: called for changed files only.
    handleHotUpdate({ file, read }) {
      if (removed.has(file) && !existsSync(file)) return [];
      const text = written.get(file);
      if (text === undefined) return;
      return Promise.resolve(read()).then((now) => (now === text ? [] : undefined));
    },
    configureServer(server) {
      const base = path.resolve(root, options.dir);
      server.middlewares.use('/__save', (req, res) => {
        if (req.method !== 'POST' && req.method !== 'DELETE') return void ((res.statusCode = 405), res.end());
        const name = decodeURIComponent((req.url ?? '').split('?')[0].slice(1));
        const file = path.resolve(base, name);
        if ((!NAME.test(name) && !SHEET.test(name)) || !file.startsWith(base + path.sep)) return void ((res.statusCode = 400), res.end('bad name'));
        if (req.method === 'DELETE') {
          try {
            written.delete(file);
            removed.add(file);
            if (existsSync(file)) unlinkSync(file);
            res.end('ok');
          } catch (error) {
            res.statusCode = 500;
            res.end(String(error));
          }
          return;
        }
        removed.delete(file);
        const parts: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
          parts.push(chunk);
          if ((size += chunk.length) > 5_000_000) req.destroy();
        });
        req.on('end', () => {
          try {
            if (name.endsWith('.png')) {
              const bytes = new Uint8Array(Buffer.concat(parts));
              const head = isPng(bytes) ? pngHeader(bytes) : null;
              if (!head || head.type !== 3 || head.depth !== 8) throw new Error('not an 8-bit indexed PNG');
              mkdirSync(path.dirname(file), { recursive: true });
              written.set(file, Buffer.from(bytes).toString());
              writeFileSync(file, bytes);
              return void res.end('ok');
            }
            const body = Buffer.concat(parts).toString('utf8');
            const data = JSON.parse(body);
            if (SHEET.test(name) && !atlasFits(data, file.replace(/\.json$/, '.png'))) throw new Error('not an atlas of the sheet beside it');
            const valid = VALIDATORS[path.basename(name)];
            if (valid && !valid(data)) throw new Error(`not a ${path.basename(name)}`);
            const text = JSON.stringify(data, null, 1) + '\n';
            mkdirSync(path.dirname(file), { recursive: true });
            written.set(file, text);
            writeFileSync(file, text);
            res.end('ok');
          } catch (error) {
            res.statusCode = 400;
            res.end(String(error));
          }
        });
      });
    },
  };
}
