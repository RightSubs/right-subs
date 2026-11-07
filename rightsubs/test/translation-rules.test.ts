import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agreedShiftIsReal, startsAgreeEnough } from '../src/subtitles/service.ts';

// Numbers measured on Generation Z S01E01 (box, 2026-11-03): the German subtitle that fits
// (+6.0 s) and the English one made for another cut.
const german = { offsetMs: 6000, scale: 1, starts: 0.55, startsBaseline: 0.3 };

test('a correction both halves agree on is applied even when #judge called it already synced', () => {
  assert.equal(agreedShiftIsReal(german), true);
  // Gained 0.2487 in lines starting together: a hair under the normal bar, which is what failed on the box.
  assert.equal(agreedShiftIsReal({ ...german, starts: 0.5487 }), true);
});

test('a tiny correction, or one that gains almost nothing, is left alone', () => {
  assert.equal(agreedShiftIsReal({ ...german, offsetMs: 200 }), false);
  assert.equal(agreedShiftIsReal({ ...german, starts: 0.35 }), false);
});

test('a frame-rate correction counts even with no offset; noise-level rescale does not', () => {
  assert.equal(agreedShiftIsReal({ ...german, offsetMs: 0, scale: 1.001 }), true);
  assert.equal(agreedShiftIsReal({ ...german, offsetMs: 0, scale: 1.0002 }), false);
});

test('lines starting together at chance level are not agreement', () => {
  assert.equal(startsAgreeEnough(0.37), false, 'the English subtitle that fits nowhere');
  assert.equal(startsAgreeEnough(0.53), true, 'the German one that fits, in the worst window layout');
});
