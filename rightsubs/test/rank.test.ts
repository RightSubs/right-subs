import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findLanguage, type Language } from '../src/languages/languages.ts';
import { isExact, parseRelease, score } from '../src/subtitles/rank.ts';

const en = findLanguage('en') as Language;
const candidate = (releaseName: string, hashMatch = false) => ({ providerId: 'api', ref: '1', language: en, releaseName, hashMatch });
const LICDOM = 'Operazione Valchiria - Varkyrie (2008) UpScaled 2160p H265 10 bit ita AC3 5.1 eng AAC 5.1 sub ita eng Licdom.mkv';

test('same release: identical names, any separators and case', () => {
  assert.ok(isExact(candidate('Matlock.2024.S02E12.1080p.x265-ELiTE'), 'Matlock.2024.S02E12.1080p.x265-ELiTE.mkv'));
  assert.ok(isExact(candidate('matlock 2024 s02e12 1080p x265 elite.srt'), 'Matlock.2024.S02E12.1080p.x265-ELiTE.mkv'));
});

test('same release: specific release name inside a longer file name', () => {
  assert.ok(isExact(candidate('Varkyrie.2008.UpScaled.2160p.H265.Licdom.mkv'), LICDOM));
});

test('not the same release', () => {
  assert.ok(!isExact(candidate('Valkyrie.2008.BluRay'), LICDOM), 'too generic');
  assert.ok(!isExact(candidate('Operação.Valquíria.2008.1080p.BluRay.5.1.x264.DUAL-BLUDV'), LICDOM));
  assert.ok(!isExact(candidate('Matlock.2024.S02E12.1080p.WEB.h264-ETHEL'), 'Matlock.2024.S02E12.1080p.x265-ELiTE.mkv'));
  assert.ok(!isExact(candidate('Anything'), undefined));
});

test('not the same release: another cut of the movie', () => {
  // Box, 2026-11-01: the theatrical subtitle has every word of the DC file name but "DC".
  const dc = 'Enter.the.Void.2009.DC.1080p.BluRay.H264.AAC-RARBG.mp4';
  assert.ok(!isExact(candidate('Enter.The.Void.2009.1080p.BluRay.H264.AAC-RARBG'), dc));
  assert.ok(isExact(candidate('Enter.the.Void.2009.DC.1080p.BluRay.H264.AAC-RARBG'), dc));
  assert.ok(!isExact(candidate('Movie.2010.DC.1080p.BluRay.x264-GRP'), 'Movie.2010.1080p.BluRay.x264-GRP.mkv'));
  assert.ok(isExact(candidate('Other.Name', true), dc), 'a hash match still wins');
});

test('reads the cut from release names', () => {
  assert.equal(parseRelease('Enter.the.Void.2009.DC.1080p.BluRay.x265-RBG').edition, 'dc');
  assert.equal(parseRelease("Enter the Void 2010 Director's Cut 1080p BluRay x264-OFT").edition, 'dc');
  assert.equal(parseRelease('Enter the Void 2010 Directors Cut 1080p BluRay x264-OFT').edition, 'dc');
  assert.equal(parseRelease('Enter the Void (2010) Extended (1080p BluRay x265 r00t)').edition, 'extended');
  assert.equal(parseRelease('Movie.2004.UNRATED.EXTENDED.720p.BluRay').edition, 'extended+unrated');
  assert.equal(parseRelease('Enter.The.Void.LIMITED.2009.1080p.BluRay.x264.anoXmous').edition, '');
  assert.equal(parseRelease('Dcup.2020.1080p.WEB').edition, '', 'only whole words');
});

test('a hash match is always the same file', () => {
  assert.ok(isExact(candidate('Other.Name', true), LICDOM));
});

test('reads source, resolution and group from release names', () => {
  assert.deepEqual(
    { ...parseRelease('Matlock.2024.S02E12.1080p.WEB.h264-ETHEL.mkv'), tokens: undefined },
    { tokens: undefined, source: 'web', resolution: '1080p', group: 'ethel', edition: '' },
  );
  const amzn = parseRelease("Matlock.(2024).S02E12.The.Cavalry.Isn't.Coming.1080p.10bit.AMZN.WEB-DL.DDP5.1.HEVC-Vyndros");
  assert.equal(amzn.source, 'web');
  assert.equal(amzn.group, 'vyndros');
  assert.equal(parseRelease('Valkyrie (2008) [1080p BluRay x265 10bit MULTILANG MULTISUB] - GEGE.mkv').group, 'gege');
  assert.equal(parseRelease('Valkyrie.2008.BDRip.720p').source, 'bluray');
  assert.equal(parseRelease('Valkyrie 2008').group, undefined);
});

test('prefers same group, then same source', () => {
  const file = 'Movie.2020.1080p.BluRay.x264-SPARKS.mkv';
  const ctx = { filename: file };
  const sameGroup = score(candidate('Movie.2020.720p.BluRay.x264-SPARKS'), ctx);
  const sameSource = score(candidate('Movie.2020.1080p.BluRay.x264-OTHER'), ctx);
  const otherSource = score(candidate('Movie.2020.1080p.WEB-DL.x264-OTHER'), ctx);
  assert.ok(sameGroup > sameSource, `${sameGroup} > ${sameSource}`);
  assert.ok(sameSource > otherSource, `${sameSource} > ${otherSource}`);
});

test('prefers the video frame rate and non-SDH subtitles', () => {
  const ctx = { filename: 'Movie.2020.mkv', videoFps: 23.976 };
  assert.ok(score({ ...candidate('A'), fps: 23.98 }, ctx) > score({ ...candidate('A'), fps: 25 }, ctx));
  assert.ok(score(candidate('A'), ctx) > score({ ...candidate('A'), hearingImpaired: true }, ctx));
});
