import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isYouTubeWatch,
  ObservedRevision,
  YouTubeSourceSchema,
  sourceKey,
} from '../src/youtube/source.ts';
import { PlaybackGeneration } from '../src/playback/cues.ts';
import { createController } from '../src/background/controller.ts';
import {
  fakeAreas,
  EXTENSION_ID,
  request,
  uiSender,
  contentSender,
} from './helpers.ts';

test('YouTube activation accepts only the exact HTTPS watch origin and a bounded video ID', () => {
  assert.equal(
    isYouTubeWatch('https://www.youtube.com/watch?v=synthetic_123'),
    true,
  );
  for (const url of [
    'https://www.youtube.com.evil.test/watch?v=123',
    'http://www.youtube.com/watch?v=123',
    'https://m.youtube.com/watch?v=123',
    'https://www.youtube.com/shorts/123',
    'https://www.youtube.com/watch',
    'not-url',
  ])
    assert.equal(isYouTubeWatch(url), false);
});

const source = {
  nonce: '00000000-0000-4000-8000-000000000001',
  videoId: 'synthetic',
  language: 'en',
  sourceId: '.en',
  kind: 'manual',
  translated: false,
  known: true,
};
test('source metadata rejects unknown fields, invalid types and oversized identity; track changes get a distinct key', () => {
  const parsed = YouTubeSourceSchema.parse(source);
  for (const patch of [
    { endpoint: 'https://evil.test' },
    { language: 'x'.repeat(1000) },
    { known: 'yes' },
    { kind: 'arbitrary' },
    { nonce: '' },
  ])
    assert.equal(
      YouTubeSourceSchema.safeParse({ ...source, ...patch }).success,
      false,
    );
  assert.notEqual(
    sourceKey(parsed),
    sourceKey({ ...parsed, kind: 'asr', sourceId: 'a.en' }),
  );
  assert.notEqual(
    sourceKey(parsed),
    sourceKey({ ...parsed, translated: true }),
  );
});
test('observed captions have revisions but never invented timing; repeats are stable and invalid/empty text clears state', () => {
  const revision = new ObservedRevision();
  const first = revision.update('Hello')!;
  assert.equal(first.timing, 'observed');
  assert.equal('start' in first, false);
  assert.equal('end' in first, false);
  assert.equal(revision.update('Hello'), first);
  const next = revision.update('Hello again')!;
  assert.equal(next.id, first.id);
  assert.equal(next.revision, 2);
  assert.equal(revision.update('x'.repeat(4097)), null);
  assert.notEqual(revision.update('<img onerror=alert(1)>')!.id, first.id);
  revision.clear();
  assert.equal(revision.update(''), null);
});
test('observed late results cannot survive a source/language change or seek', () => {
  const clock = new PlaybackGeneration();
  const revision = new ObservedRevision();
  const first = revision.update('First')!;
  const generation = clock.value;
  clock.next();
  revision.clear();
  const current = revision.update('Current')!;
  assert.equal(
    clock.accepts(
      {
        generation,
        items: [{ id: first.id, revision: first.revision, text: 'Old' }],
      },
      [current],
    ),
    false,
  );
});
test('YouTube source confirmation is a trusted popup choice, never a content identity field', async () => {
  const confirmed: boolean[] = [];
  const controller = createController(
    EXTENSION_ID,
    fakeAreas(),
    async (_operation, choice) => {
      confirmed.push(choice);
      return 'enabled';
    },
  );
  await controller.dispatch(request('playback.enable'), uiSender('popup'));
  await controller.dispatch(
    request('playback.enable', { youtubeSourceConfirmed: true }),
    uiSender('popup'),
  );
  assert.deepEqual(confirmed, [false, true]);
  assert.deepEqual(
    await controller.dispatch(
      request('playback.enable', { youtubeSourceConfirmed: true }),
      contentSender(),
    ),
    { ok: false, error: 'FORBIDDEN' },
  );
});
