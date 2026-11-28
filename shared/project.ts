// Saving an editor's work into the project (the dev server writes the file; see engine/dev/content-plugin.ts).

/** Whether saving into the project can work here: only the local dev server has the endpoint. */
export const canSaveToProject = (): boolean => import.meta.env.DEV;

/** Saves `data` as `<name>.json` in the game's content folder. Resolves to whether the dev server wrote it. */
export async function saveToProject(name: string, data: unknown): Promise<boolean> {
  if (!canSaveToProject()) return false;
  try {
    const response = await fetch(`/__save/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Saves a sheet as `images/<name>.png` (8-bit indexed, the body as is) and its atlas `images/<name>.json`. */
export async function saveSheetToProject(name: string, png: Uint8Array, atlas: unknown): Promise<boolean> {
  if (!canSaveToProject()) return false;
  try {
    const response = await fetch(`/__save/images/${name}.png`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png as BodyInit });
    return response.ok && (await saveToProject(`images/${name}.json`, atlas));
  } catch {
    return false;
  }
}

/** Removes `<name>.json` from the game's content folder (one saved under a name it no longer has). Resolves to whether it is gone. */
export async function removeFromProject(name: string): Promise<boolean> {
  if (!canSaveToProject()) return false;
  try {
    const response = await fetch(`/__save/${name}`, { method: 'DELETE' });
    return response.ok;
  } catch {
    return false;
  }
}
