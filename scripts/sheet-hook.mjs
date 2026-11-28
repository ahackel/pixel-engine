// The loader hook behind hooks.mjs: a `.png?sheet` URL loads as the sheet's module.
import { fileURLToPath } from 'node:url';
import { sheetSource } from '../dev/sheet-module.ts';

export async function load(url, context, next) {
  const [file, query] = url.split('?');
  if (query === 'sheet' && file.endsWith('.png') && file.startsWith('file:')) {
    return { format: 'module', source: sheetSource(fileURLToPath(file)), shortCircuit: true };
  }
  return next(url, context);
}
