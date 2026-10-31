import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseTimedCaptions,
  readTimedCaptions,
  selectedTimedUrl,
  TIMED_MAX_BYTES,
} from '../src/youtube/timed.ts';
import { TimedResponseSchema } from '../src/youtube/source.ts';
import { TimedWindow } from '../src/playback/timed-window.ts';
import type { CaptionResult, CaptionUnit } from '../src/playback/cues.ts';

const identity = {
  videoId: 'synthetic',
  language: 'en',
  sourceId: 'a.en',
  kind: 'asr',
};
const metadata = (
  baseUrl = 'https://www.youtube.com/api/timedtext?v=synthetic&lang=en&kind=asr',
) => ({
  videoDetails: { videoId: 'synthetic' },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        { vssId: 'a.en', languageCode: 'en', kind: 'asr', baseUrl },
      ],
    },
  },
});
const fixture = {
  events: [
    {
      tStartMs: 1000,
      dDurationMs: 2500,
      segs: [{ utf8: 'Complete ' }, { utf8: 'sentence.', tOffsetMs: 700 }],
    },
    {
      tStartMs: 4000,
      dDurationMs: 2000,
      segs: [{ utf8: 'Türkçe <img src=x>.' }],
    },
  ],
};
test('timed URL stays on the current original YouTube track; no arbitrary or translated destinations', () => {
  assert.equal(
    selectedTimedUrl(metadata(), identity)?.searchParams.get('fmt'),
    'json3',
  );
  for (const url of [
    'https://evil.test/api/timedtext?v=synthetic&lang=en&kind=asr',
    'http://www.youtube.com/api/timedtext?v=synthetic&lang=en&kind=asr',
    'https://user:key@www.youtube.com/api/timedtext?v=synthetic&lang=en&kind=asr',
    'https://www.youtube.com/other?v=synthetic&lang=en&kind=asr',
    'https://www.youtube.com/api/timedtext?v=other&lang=en&kind=asr',
    'https://www.youtube.com/api/timedtext?v=synthetic&lang=tr&kind=asr',
    'https://www.youtube.com/api/timedtext?v=synthetic&lang=en&kind=asr&tlang=tr',
    'https://www.youtube.com/api/timedtext?v=synthetic&lang=en&kind=asr&v=other',
  ])
    assert.equal(selectedTimedUrl(metadata(url), identity), null);
  assert.equal(
    selectedTimedUrl(metadata(), { ...identity, sourceId: '.en' }),
    null,
  );
  assert.equal(
    selectedTimedUrl(
      { ...metadata(), videoDetails: { videoId: 'old' } },
      identity,
    ),
    null,
  );
});
test('JSON3 joins complete timed text segments without word offsets, preserving original intervals and literal markup', () => {
  const cues = parseTimedCaptions(fixture)!;
  assert.equal(cues[0]!.text, 'Complete sentence.');
  assert.equal(cues[0]!.start, 1);
  assert.equal(cues[0]!.end, 3.5);
  assert.equal(cues[1]!.text, 'Türkçe <img src=x>.');
  for (const patch of [
    { tStartMs: -1 },
    { dDurationMs: 0 },
    { dDurationMs: undefined },
    { aAppend: 1 },
    { segs: [{ utf8: '<img>'.repeat(1000) }] },
    { tStartMs: Infinity },
    { segs: [{ utf8: 7 }] },
  ])
    assert.equal(
      parseTimedCaptions({ events: [{ ...fixture.events[0], ...patch }] }),
      null,
    );
  assert.equal(
    parseTimedCaptions({ events: Array(10001).fill(fixture.events[0]) }),
    null,
  );
});
test('timed download rejects malformed/oversized bodies and the bridge rejects forged cue shapes', async () => {
  assert.equal(
    (await readTimedCaptions(new Response(JSON.stringify(fixture))))?.length,
    2,
  );
  for (const response of [
    new Response(''),
    new Response('{}'),
    new Response('x'.repeat(TIMED_MAX_BYTES + 1)),
    new Response('{}', { status: 429 }),
  ])
    assert.equal(await readTimedCaptions(response), null);
  const good = {
    nonce: '00000000-0000-4000-8000-000000000001',
    key: 'track',
    cues: parseTimedCaptions(fixture),
  };
  assert.equal(TimedResponseSchema.safeParse(good).success, true);
  for (const patch of [
    { endpoint: 'https://evil.test' },
    { nonce: 'bad' },
    { cues: [{ ...good.cues![0], end: 0 }] },
    { cues: [good.cues![0], good.cues![0]] },
    { cues: [{ ...good.cues![0], html: '<script>' }] },
  ])
    assert.equal(
      TimedResponseSchema.safeParse({ ...good, ...patch }).success,
      false,
    );
});
test('preparation before playback translates complete upcoming cues, does not abort when they become current, and stays bounded while paused', async () => {
  const cues = parseTimedCaptions(fixture)!;
  const calls: {
    items: readonly CaptionUnit[];
    signal: AbortSignal;
    generation: number;
    finish: (result: CaptionResult) => void;
  }[] = [];
  const window = new TimedWindow(
    (items, generation, signal) =>
      new Promise((finish) =>
        calls.push({ items, generation, signal, finish }),
      ),
    () => {},
    () => {},
  );
  window.update(cues, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.items[0]!.text, 'Complete sentence.');
  assert.equal(window.texts([cues[0]!]), null);
  window.update(cues, 1.2);
  assert.equal(
    calls[0]!.signal.aborted,
    false,
    'An arriving current cue must not cancel its own prefetch',
  );
  calls[0]!.finish({
    generation: calls[0]!.generation,
    items: calls[0]!.items.map((c) => ({ ...c, text: `TR ${c.text}` })),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(window.texts([cues[0]!]), ['TR Complete sentence.']);
  for (let i = 0; i < 100; i++) window.update(cues, 1.2);
  assert.equal(calls.length, 1, 'Paused preparation must not repeatedly bill');
  window.reset();
});

test('a newly active overlapping cue does not cancel a prefetch containing another current cue', async () => {
  const cues = parseTimedCaptions({
    events: [1, 2, 3, 4, 4].map((second, i) => ({
      tStartMs: second * 1000,
      dDurationMs: 1000,
      segs: [{ utf8: `Caption ${i}` }],
    })),
  })!;
  const calls: {
    items: readonly CaptionUnit[];
    signal: AbortSignal;
    generation: number;
    finish: (result: CaptionResult) => void;
  }[] = [];
  const window = new TimedWindow(
    (items, generation, signal) =>
      new Promise((finish) =>
        calls.push({ items, generation, signal, finish }),
      ),
    () => {},
    () => {},
  );
  window.update(cues, 0);
  assert.equal(calls[0]!.items.length, 4);
  window.update(cues, 4.2);
  assert.equal(calls[0]!.signal.aborted, false);
  calls[0]!.finish({
    generation: calls[0]!.generation,
    items: calls[0]!.items.map((c) => ({ ...c, text: `TR ${c.text}` })),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.items[0]!.id, cues[4]!.id);
  assert.deepEqual(window.texts([cues[3]!]), ['TR Caption 3']);
  window.reset();
});
