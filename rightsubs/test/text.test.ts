import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeSubtitle, looksLikeSrt, toSrt } from '../src/subtitles/text.ts';

const CUE = '1\r\n00:00:01,000 --> 00:00:02,500\r\nAção, é você?\r\n';

test('keeps UTF-8 and drops the BOM', () => {
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(CUE, 'utf8')]);
  assert.equal(decodeSubtitle(bom), CUE.replace(/\r\n/g, '\n'));
});

test('fixes accents of old Windows-1252 subtitles', () => {
  // "Ação, é você?" in windows-1252, plus a curly quote (0x93/0x94) only windows-1252 has
  const cp1252 = Buffer.from([
    ...Buffer.from('1\r\n00:00:01,000 --> 00:00:02,500\r\nA', 'latin1'),
    0xe7, 0xe3, ...Buffer.from('o, ', 'latin1'), 0xe9, ...Buffer.from(' voc', 'latin1'), 0xea, 0x3f, 0x20, 0x93, 0x78, 0x94,
  ]);
  assert.equal(decodeSubtitle(cp1252), '1\n00:00:01,000 --> 00:00:02,500\nAção, é você? “x”');
});

test('decodes UTF-16 with BOM', () => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(CUE, 'utf16le')]);
  assert.match(decodeSubtitle(utf16), /Ação, é você\?/);
});

test('recognizes SRT timings', () => {
  assert.ok(looksLikeSrt(CUE));
  assert.ok(looksLikeSrt('1\n0:00:01.000 --> 0:00:02.000\nx'));
  assert.ok(!looksLikeSrt('[Script Info]\nTitle: ass file'));
  assert.ok(!looksLikeSrt('<html>error</html>'));
});

test('normalizes line breaks, millisecond separator and the trailing blank line', () => {
  assert.equal(toSrt('1\n00:00:01.000 --> 00:00:02.500\nOi\n\n\n'), '1\r\n00:00:01,000 --> 00:00:02,500\r\nOi\r\n\r\n');
});
