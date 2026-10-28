// Face packs added by the user are kept in this browser (localStorage). Every pack is validated on the
// way in, so a bad or hostile file can only be rejected, never run.
import { STARTER_PACK, validatePack } from './facepack.js';

const KEY = 'face-characters.packs.v1';
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_PACKS = 20;

export const builtIn = () => validatePack(STARTER_PACK);

export function loadPacks(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage.getItem(KEY));
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const p of raw.slice(0, MAX_PACKS)) { try { out.push(validatePack(p)); } catch { /* skip a bad one */ } }
    return out;
  } catch { return []; }
}

export function savePacks(packs, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(packs.slice(0, MAX_PACKS))); return true; } catch { return false; }
}

/** Parse and validate pack text. Throws a short message on a bad pack. */
export function parsePack(text) {
  if (typeof text !== 'string' || text.length > MAX_FILE_BYTES) throw new Error('That file is too large');
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('That file is not valid JSON'); }
  return validatePack(obj);
}

/** Add or replace (same id) and return the new list. The built-in pack id is reserved. */
export function addPack(packs, pack, folderPacks = []) {
  if (pack.id === builtIn().id) throw new Error('That pack id is reserved; change "id" in the file');
  if (folderPacks.some((p) => p.id === pack.id)) throw new Error('A pack in the packs folder already uses that id; change "id" in the file');
  const rest = packs.filter((p) => p.id !== pack.id);
  if (rest.length >= MAX_PACKS) throw new Error('Too many packs; remove one first');
  return [...rest, pack];
}

export const removePack = (packs, id) => packs.filter((p) => p.id !== id);

/** Flat list of {key, pack, face} over the built-in pack followed by the user's. */
export function allFaces(packs) {
  const list = [];
  for (const p of [builtIn(), ...packs]) for (const f of p.faces) list.push({ key: `${p.id}/${f.id}`, pack: p, face: f });
  return list;
}

/** Find a face by key; also accepts a bare face id (old saved settings). Falls back to the first face. */
export function findFace(list, key) {
  return list.find((e) => e.key === key) || list.find((e) => e.face.id === key) || list[0];
}

/** Packs to show after the built-in one: the stored ones, minus any whose id a folder pack (or the built-in) uses, then the folder's. */
export function mergePacks(stored, folderPacks) {
  const taken = new Set([builtIn().id, ...folderPacks.map((p) => p.id)]);
  return [...stored.filter((p) => !taken.has(p.id)), ...folderPacks];
}

/**
 * Ask the server for the packs folder. Every file is validated; a bad one is skipped and listed in `problems`
 * ({file, reason}). A server without the folder API (or none at all) simply gives nothing.
 */
export async function loadFolderPacks(fetchFn = globalThis.fetch) {
  const packs = [], problems = [];
  let list;
  try {
    const r = await fetchFn('/api/packs');
    if (!r.ok) return { packs, problems };
    list = await r.json();
  } catch { return { packs, problems }; }
  for (const s of Array.isArray(list && list.skipped) ? list.skipped : []) problems.push({ file: String(s.file), reason: String(s.reason) });
  const ids = new Map();
  for (const file of (Array.isArray(list && list.files) ? list.files : []).filter((f) => typeof f === 'string').slice(0, MAX_PACKS)) {
    try {
      const r = await fetchFn('/api/packs/' + encodeURIComponent(file));
      if (!r.ok) throw new Error('could not be read');
      const pack = parsePack(await r.text());
      if (pack.id === builtIn().id) throw new Error('its "id" is reserved for the built-in faces; change "id" in the file');
      if (ids.has(pack.id)) throw new Error(`its "id" is already used by ${ids.get(pack.id)}`);
      ids.set(pack.id, file); packs.push(pack);
    } catch (e) { problems.push({ file, reason: e.message || 'is not a valid face pack' }); }
  }
  return { packs, problems };
}

/** One line per problem, for the notice on the Faces tab. */
export const describeProblems = (problems) => problems.map((p) => `${p.file}: ${p.reason}`);
