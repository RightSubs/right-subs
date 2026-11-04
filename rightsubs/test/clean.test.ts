import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanCueText, cleanCues, cleanSrt } from '../src/subtitles/clean.ts';

test('removes music notes and the replacement character', () => {
  assert.equal(cleanCueText('♪ La la la ♪'), 'La la la');
  assert.equal(cleanCueText('♫♬ Hello\uFFFD'), 'Hello');
  assert.equal(cleanCueText('♪'), '');
});

test('removes music notes that arrived as mojibake, but not accented text', () => {
  assert.equal(cleanCueText('â™ª Sinto o cheiro do sal no ar\nao longo da costa da Califórnia â™ª'), 'Sinto o cheiro do sal no ar\nao longo da costa da Califórnia');
  assert.equal(cleanCueText('â™«'), '');
  assert.equal(cleanCueText('Essa não é uma câmera de verdade.'), 'Essa não é uma câmera de verdade.');
});

test('removes # used as a music mark, but not #1 or hashtags', () => {
  assert.equal(cleanCueText('# Let it be #'), 'Let it be');
  assert.equal(cleanCueText('<i># Let it be</i>'), '<i>Let it be</i>');
  assert.equal(cleanCueText("We're #1"), "We're #1");
  assert.equal(cleanCueText('#blessed'), '#blessed');
});

test('removes leftover ASS codes', () => {
  assert.equal(cleanCueText('{\\an8}Hello'), 'Hello');
  assert.equal(cleanCueText('One\\NTwo\\hthree'), 'One\nTwo three');
});

test('drops a line made only of a music mark, keeps the others', () => {
  assert.equal(cleanCueText('♪\nHello'), 'Hello');
});

test('drops cues left empty and leaves a clean subtitle byte for byte', () => {
  assert.deepEqual(cleanCues([{ startMs: 0, endMs: 1000, text: '♪' }, { startMs: 2000, endMs: 3000, text: 'Hi' }]).map((c) => c.text), ['Hi']);
  const clean = Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n\r\n', 'utf8');
  assert.equal(cleanSrt(clean), clean);
  const dirty = Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\n♪ Hello ♪\r\n\r\n', 'utf8');
  assert.match(cleanSrt(dirty).toString('utf8'), /\r\nHello\r\n/);
});
