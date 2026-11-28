// Small browser helpers shared by the editors: ids, preferences kept in the browser, saving text as a file, reading a picked file.

export const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * A value kept in this browser as JSON, else the fallback (also when the browser has no storage here). Only for a user's
 * preferences (a tool's zoom, tab, what was picked) and a player's saved game: what editors make is project content
 * (engine/core/content.ts), never kept on the device.
 */
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Keeps a preference in this browser. False when the browser refuses storage. */
export function writeLocal(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Lets the browser save some text as a file. */
export function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Asks for a file and gives its text. */
export function pickFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) file.text().then(resolve, reject);
    });
    input.click();
  });
}
