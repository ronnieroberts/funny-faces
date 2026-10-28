// Pure state logic for the Faces tab: which face is selected, which sections are folded open, and the arrow keys of the
// face chips. No DOM here, so it can be tested on its own. app.js reads and writes the stored value.
export const UI_KEY = 'face-characters.ui.v1';
export const SECTIONS = ['look', 'pos', 'stage', 'talk'];
/** What a first-time visitor sees: the chips and "Look of this face" open, everything else folded. */
export const FIRST_TIME_OPEN = { look: true, pos: false, stage: false, talk: false };

export const clampSel = (sel, count) => {
  const n = Math.max(1, Math.floor(count) || 1);
  return Number.isInteger(sel) ? Math.min(n - 1, Math.max(0, sel)) : 0;
};

/** Read whatever was stored (anything, even garbage) into {open:{look,pos,stage,talk}, sel}. Missing sections get the first-time default. */
export function parseUi(raw, count = 8) {
  const r = raw && typeof raw === 'object' ? raw : {}, o = r.open && typeof r.open === 'object' ? r.open : {};
  const open = {};
  for (const k of SECTIONS) open[k] = o[k] === true || o[k] === 1 ? true : o[k] === false || o[k] === 0 ? false : FIRST_TIME_OPEN[k];
  return { open, sel: clampSel(r.sel, count) };
}

export function setOpen(ui, key, isOpen) {
  if (!SECTIONS.includes(key)) return ui;
  return { ...ui, open: { ...ui.open, [key]: !!isOpen } };
}
export const setSel = (ui, sel, count) => ({ ...ui, sel: clampSel(sel, count) });

/** The chip that an arrow key moves to (wrapping), or null for any other key. */
export function nextChip(current, count, key) {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (current + count - 1) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

export const canAdd = (count, max) => count < max;
export const canRemove = (count) => count > 1;
/** "Who talks" only means something with two or more faces. */
export const showTalk = (count) => count > 1;
/** After removing face i from a list that had `before` faces, the face to select. */
export const selAfterRemove = (i, before) => Math.max(0, Math.min(i, before - 2));
export const hasNotice = (text) => typeof text === 'string' && text.trim().length > 0;

export const chipLabel = (i, name) => `${i + 1} ${name}`;
export const faceLabel = (i, name) => `Face ${i + 1}, ${name}`;
