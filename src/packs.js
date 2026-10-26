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
export function addPack(packs, pack) {
  if (pack.id === builtIn().id) throw new Error('That pack id is reserved; change "id" in the file');
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
