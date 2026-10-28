import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUi, setOpen, setSel, clampSel, nextChip, canAdd, canRemove, showTalk, selAfterRemove, hasNotice, faceLabel, chipLabel, FIRST_TIME_OPEN, UI_KEY } from '../src/ui.js';

test('nothing stored: chips and Look open, the rest folded, first face selected', () => {
  for (const raw of [null, undefined, 'x', 5, [], {}]) {
    const u = parseUi(raw);
    assert.deepEqual(u.open, FIRST_TIME_OPEN);
    assert.equal(u.sel, 0);
  }
  assert.deepEqual(FIRST_TIME_OPEN, { look: true, pos: false, stage: false, talk: false });
});

test('stored fold state is kept per section; missing sections use the first-time default', () => {
  const u = parseUi({ open: { look: false, stage: 1 }, sel: 2 }, 4);
  assert.deepEqual(u.open, { look: false, pos: false, stage: true, talk: false });
  assert.equal(u.sel, 2);
  assert.equal(parseUi({ open: { look: 'yes', pos: null } }).open.look, true);   // junk falls back to the default
});

test('selection is clamped to the faces that exist', () => {
  assert.equal(parseUi({ sel: 7 }, 3).sel, 2);
  assert.equal(parseUi({ sel: -4 }, 3).sel, 0);
  assert.equal(parseUi({ sel: 1.5 }, 3).sel, 0);
  assert.equal(parseUi({ sel: '2' }, 3).sel, 0);
  assert.equal(clampSel(5, 0), 0);
  assert.equal(setSel(parseUi(null), 9, 4).sel, 3);
});

test('setOpen returns a new object, ignores unknown sections and survives a JSON round trip', () => {
  const a = parseUi(null), b = setOpen(a, 'talk', true);
  assert.equal(a.open.talk, false);
  assert.equal(b.open.talk, true);
  assert.equal(setOpen(a, 'bogus', true), a);
  assert.deepEqual(parseUi(JSON.parse(JSON.stringify(b)), 8), b);
  assert.equal(UI_KEY, 'face-characters.ui.v1');
});

test('chip arrows wrap and Home/End jump; other keys are left alone', () => {
  assert.equal(nextChip(0, 3, 'ArrowRight'), 1);
  assert.equal(nextChip(2, 3, 'ArrowRight'), 0);
  assert.equal(nextChip(0, 3, 'ArrowLeft'), 2);
  assert.equal(nextChip(1, 3, 'ArrowDown'), 2);
  assert.equal(nextChip(1, 3, 'ArrowUp'), 0);
  assert.equal(nextChip(1, 3, 'Home'), 0);
  assert.equal(nextChip(1, 3, 'End'), 2);
  assert.equal(nextChip(0, 1, 'ArrowRight'), 0);
  for (const k of ['e', 'E', 'Tab', 'Enter', ' ', 'Escape']) assert.equal(nextChip(1, 3, k), null);
});

test('add, remove and Who talks follow the number of faces', () => {
  assert.equal(canAdd(7, 8), true);
  assert.equal(canAdd(8, 8), false);
  assert.equal(canRemove(1), false);
  assert.equal(canRemove(2), true);
  assert.equal(showTalk(1), false);
  assert.equal(showTalk(2), true);
  assert.equal(selAfterRemove(2, 3), 1);
  assert.equal(selAfterRemove(0, 3), 0);
  assert.equal(selAfterRemove(1, 4), 1);
});

test('labels and the packs notice badge', () => {
  assert.equal(chipLabel(0, 'Classic'), '1 Classic');
  assert.equal(faceLabel(1, 'Cat'), 'Face 2, Cat');
  assert.equal(hasNotice(''), false);
  assert.equal(hasNotice('  \n'), false);
  assert.equal(hasNotice('Some files were skipped'), true);
  assert.equal(hasNotice(null), false);
});
