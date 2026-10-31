import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceWebVtt, nativeSourceWebVtt } from '../src/playback/download.ts';

test('source downloads preserve cue timing and Unicode while escaping markup and cue delimiters', () => {
  const text = sourceWebVtt([
    {
      startTime: 1.25,
      endTime: 63.005,
      text: '<b>İyi günler</b> & مرحبا\n\n00:00 --> forged',
    },
  ]);
  assert.equal(
    text,
    'WEBVTT\n\n1\n00:00:01.250 --> 00:01:03.005\n&lt;b&gt;İyi günler&lt;/b&gt; &amp; مرحبا\n00:00 --&gt; forged\n\n',
  );
  for (const input of [
    [],
    [{ startTime: 0, endTime: Infinity, text: 'x' }],
    [{ startTime: 0, endTime: 900_000, text: 'x' }],
    [{ startTime: 0, endTime: 0.0001, text: 'x' }],
    Array(5001).fill({ startTime: 0, endTime: 1, text: 'x' }),
    Array(1000).fill({ startTime: 0, endTime: 1, text: 'a'.repeat(1000) }),
  ])
    assert.equal(sourceWebVtt(input), null);
});

test('source download never enables tracks and rejects an ambiguous hidden-track selection', () => {
  let writes = 0;
  const track = (mode: string, text: string) => ({
    kind: 'subtitles',
    get mode() {
      return mode;
    },
    set mode(value: string) {
      mode = value;
      writes++;
    },
    cues: [{ startTime: 0, endTime: 1, text }],
  });
  const first = track('hidden', 'first');
  const second = track('disabled', 'second');
  const video = { textTracks: [first, second] } as unknown as HTMLVideoElement;
  assert.match(nativeSourceWebVtt(video)!, /first/);
  assert.equal(writes, 0);
  second.mode = 'hidden';
  assert.equal(nativeSourceWebVtt(video), null);
  second.mode = 'showing';
  assert.match(nativeSourceWebVtt(video)!, /second/);
  assert.equal(writes, 2, 'Export does not mutate the chosen track');
});
