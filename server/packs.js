// Face packs the user drops into the packs folder. Read-only: the page asks for the list, then for one file by the exact
// name the list gave. A requested name is only ever compared with the listing, never joined to a path first.
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

export const MAX_PACK_BYTES = 2 * 1024 * 1024;   // same cap as the page applies to a picked file
export const MAX_PACK_FILES = 20;

/** {files: ['a.json', ...], skipped: [{file, reason}]}. A missing or unreadable folder is just an empty list. */
export function listPacks(dir) {
  const out = { files: [], skipped: [] };
  let root, names;
  try { root = realpathSync(dir); names = readdirSync(root); } catch { return out; }
  for (const name of names.filter((n) => /\.json$/i.test(n) && !n.startsWith('.')).sort()) {
    let st;
    try {
      st = lstatSync(join(root, name));
      if (st.isSymbolicLink()) {                          // a link may point at a pack, but not out of the folder
        const real = realpathSync(join(root, name));
        if (!real.startsWith(root + sep)) { out.skipped.push({ file: name, reason: 'a link that leaves the packs folder is not allowed' }); continue; }
        st = statSync(real);
      }
    } catch { out.skipped.push({ file: name, reason: 'could not be read' }); continue; }
    if (!st.isFile()) continue;
    if (st.size > MAX_PACK_BYTES) { out.skipped.push({ file: name, reason: 'too large (over 2 MB)' }); continue; }
    if (out.files.length >= MAX_PACK_FILES) { out.skipped.push({ file: name, reason: `only the first ${MAX_PACK_FILES} files are used` }); continue; }
    out.files.push(name);
  }
  return out;
}

/** The text of one listed pack, or null if that name is not in the listing right now. */
export function readPack(dir, name) {
  if (typeof name !== 'string' || !listPacks(dir).files.includes(name)) return null;
  try {
    const root = realpathSync(dir), text = readFileSync(realpathSync(join(root, name)));
    return text.length <= MAX_PACK_BYTES ? text : null;
  } catch { return null; }
}
