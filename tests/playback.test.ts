import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeCues,
  CueIndex,
  normalizeCue,
  PlaybackGeneration,
  type CaptionResult,
} from '../src/playback/cues.ts';
import { NativeTrackAdapter } from '../src/playback/native-track.ts';
import { mockTranslate } from '../src/testing/mock-translator.ts';
import { createController } from '../src/background/controller.ts';
import {
  EXTENSION_ID,
  fakeAreas,
  request,
  uiSender,
  contentSender,
} from './helpers.ts';

test('cue normalization rejects unsafe times, empty/oversized text and malformed input', () => {
  for (const value of [
    null,
    {},
    { startTime: NaN, endTime: 1, text: 'x' },
    { startTime: -1, endTime: 2, text: 'x' },
    { startTime: 1, endTime: Infinity, text: 'x' },
    { startTime: 1, endTime: 1, text: 'x' },
    { startTime: 2, endTime: 1, text: 'x' },
    { startTime: 1, endTime: 2, text: ' ' },
    { startTime: 1, endTime: 2, text: 'x'.repeat(4097) },
  ])
    assert.equal(normalizeCue(value), null);
  const text = '<img src=x onerror=alert(1)> & <b>literal</b>\r\nمرحبا';
  assert.deepEqual(normalizeCue({ startTime: 0, endTime: 4, text }), {
    start: 0,
    end: 4,
    text: text.replace('\r\n', '\n'),
  });
});

test('native cue identity and revisions survive edits without collisions from duplicate cue IDs', () => {
  const index = new CueIndex('track');
  const raw = { id: '', startTime: 0, endTime: 4, text: 'First' };
  const first = index.read(raw)!;
  assert.equal(index.read(raw), first);
  assert.notEqual(index.read({ ...raw })!.id, first.id);
  raw.text = 'Revised';
  const next = index.read(raw)!;
  assert.equal(next.id, first.id);
  assert.equal(next.revision, 2);
  raw.endTime = 5;
  assert.equal(index.read(raw)!.revision, 3);
});

test('cue timing is start-inclusive/end-exclusive, supports overlaps, gaps and arbitrary seeks', () => {
  const index = new CueIndex('t');
  const cues = [
    [0, 4, 'first'],
    [3, 5, 'overlap'],
    [7, 10, 'last'],
  ].map(([startTime, endTime, text]) =>
    index.read({ startTime, endTime, text })!,
  );
  for (const [time, texts] of [
    [0, ['first']],
    [3.5, ['first', 'overlap']],
    [4, ['overlap']],
    [5, []],
    [8, ['last']],
    [1, ['first']],
    [10, []],
  ] as const)
    assert.deepEqual(
      activeCues(cues, time).map((cue) => cue.text),
      texts,
    );
  assert.deepEqual(activeCues(cues, NaN), []);
  assert.equal(activeCues(Array(10).fill(cues[0]), 1).length, 4);
});

test('late async results cannot cross a seek, track replacement, disable or revision', async () => {
  const clock = new PlaybackGeneration();
  const index = new CueIndex('a');
  const raw = { startTime: 0, endTime: 5, text: 'First' };
  const cue = index.read(raw)!;
  let finish!: (result: CaptionResult) => void;
  const pending = new Promise<CaptionResult>((resolve) => {
    finish = resolve;
  });
  const oldGeneration = clock.value;
  const oldSignal = clock.signal;
  clock.next();
  finish({
    generation: oldGeneration,
    items: [{ id: cue.id, revision: cue.revision, text: 'Late' }],
  });
  assert.equal(oldSignal.aborted, true);
  assert.equal(clock.accepts(await pending, [cue]), false);
  raw.text = 'Revised';
  assert.equal(
    clock.accepts(
      {
        generation: clock.value,
        items: [{ id: cue.id, revision: 1, text: 'Old revision' }],
      },
      [index.read(raw)!],
    ),
    false,
  );
  assert.equal(
    clock.accepts({ generation: clock.value, items: [] }, [cue]),
    false,
  );
});

test('deterministic mock repeats text, propagates revision/generation, and supports cancellation', async () => {
  const cue = new CueIndex('t').read({
    startTime: 0,
    endTime: 3,
    text: 'Hello',
  })!;
  const abort = new AbortController();
  const result = await mockTranslate([cue], 7, abort.signal);
  assert.deepEqual(result, {
    generation: 7,
    items: [{ id: cue.id, revision: 1, text: '[MOCK] Hello' }],
  });
  const cancelled = mockTranslate([cue], 8, abort.signal);
  abort.abort();
  await assert.rejects(cancelled, /Cancelled/);
});

test('native adapter preserves and restores modes, switches tracks, revises and bounds cues', () => {
  const first = {
    kind: 'subtitles',
    mode: 'showing',
    cues: [{ startTime: 0, endTime: 4, text: 'First' }],
  };
  const second = {
    kind: 'captions',
    mode: 'disabled',
    cues: [{ startTime: 0, endTime: 4, text: 'Second' }],
  };
  const metadata = { kind: 'metadata', mode: 'hidden', cues: [] };
  const video = { textTracks: [first, second, metadata] };
  const adapter = new NativeTrackAdapter(video as unknown as HTMLVideoElement);
  const initial = adapter.snapshot();
  assert.equal(initial[0]?.text, 'First');
  assert.equal(first.mode, 'hidden');
  assert.equal(adapter.snapshot(), initial);
  second.mode = 'showing';
  assert.equal(adapter.snapshot()[0]?.text, 'Second');
  assert.equal(adapter.snapshot()[0]?.text, 'Second'); // no flip back to previous track
  video.textTracks.splice(1, 1);
  assert.equal(adapter.snapshot()[0]?.text, 'First');
  first.cues[0]!.text = 'Edited';
  assert.equal(adapter.snapshot()[0]?.revision, 2);
  first.cues = Array.from({ length: 6000 }, () => ({
    startTime: 0,
    endTime: 1,
    text: 'Bounded',
  }));
  assert.equal(adapter.snapshot().length, 5000);
  adapter.dispose();
  adapter.dispose();
  assert.equal(first.mode, 'showing');
  assert.equal(second.mode, 'showing');
  assert.equal(metadata.mode, 'hidden');
  assert.deepEqual(adapter.snapshot(), []);
});

test('only popup may request playback; content cannot choose a tab or grant itself activation', async () => {
  let calls = 0;
  const controller = createController(EXTENSION_ID, fakeAreas(), async () => {
    calls++;
    return 'enabled';
  });
  for (const sender of [contentSender(), uiSender()]) {
    for (const type of [
      'playback.enable',
      'playback.disable',
      'playback.status',
    ])
      assert.deepEqual(await controller.dispatch(request(type), sender), {
        ok: false,
        error: 'FORBIDDEN',
      });
  }
  assert.deepEqual(
    await controller.dispatch(
      request('playback.enable', { tabId: 42 }),
      uiSender('popup'),
    ),
    { ok: false, error: 'INVALID_MESSAGE' },
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    await controller.dispatch(request('playback.enable'), uiSender('popup')),
    { ok: true, data: { kind: 'playback', state: 'enabled' } },
  );
  assert.equal(calls, 1);
});

test('native snapshots do not repeatedly write an unchanged mode into a player', () => {
  let mode: TextTrackMode = 'showing';
  let writes = 0;
  const track = {
    kind: 'subtitles',
    cues: [{ startTime: 0, endTime: 3, text: 'Synthetic lesson.' }],
    get mode() {
      return mode;
    },
    set mode(value: TextTrackMode) {
      writes++;
      mode = value;
    },
  };
  const adapter = new NativeTrackAdapter({
    textTracks: [track],
  } as unknown as HTMLVideoElement);
  for (let i = 0; i < 100; i++) adapter.snapshot();
  assert.equal(
    writes,
    1,
    'Only the transition to hidden should notify the player',
  );
  adapter.dispose();
  assert.equal(mode, 'showing');
  assert.equal(writes, 2);
});
