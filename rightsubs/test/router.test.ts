import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Router } from '../src/http/router.ts';

const noop = () => {};

test('matches Stremio resource paths and keeps params encoded', () => {
  const router = new Router().get('/subtitles/:type/:id.json', noop).get('/subtitles/:type/:id/:extra.json', noop);

  assert.deepEqual(router.match('GET', '/subtitles/movie/tt0062622.json')?.params, { type: 'movie', id: 'tt0062622' });
  assert.deepEqual(router.match('GET', '/subtitles/series/tt0903747%3A1%3A2/videoHash=ab&filename=a%20b.mkv.json')?.params, {
    type: 'series',
    id: 'tt0903747%3A1%3A2',
    extra: 'videoHash=ab&filename=a%20b.mkv',
  });
});

test('treats HEAD as GET and rejects other methods or paths', () => {
  const router = new Router().get('/manifest.json', noop);
  assert.ok(router.match('HEAD', '/manifest.json'));
  assert.equal(router.match('POST', '/manifest.json'), undefined);
  assert.equal(router.match('GET', '/manifestXjson'), undefined);
});
