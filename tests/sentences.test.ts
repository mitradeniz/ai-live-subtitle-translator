import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SentenceIndex } from '../src/playback/sentences.ts';
import type { Cue } from '../src/playback/cues.ts';
const cue = (i: number, text: string, start = i, end = i + 1): Cue => ({
  id: String(i),
  trackId: 'track',
  revision: 1,
  start,
  end,
  text,
});
test('sentence preparation joins future fragments until punctuation and preserves source timing', () => {
  const index = new SentenceIndex();
  const cues = [
    cue(0, 'The next'),
    cue(1, 'complete sentence.'),
    cue(2, 'Another.'),
    cue(3, '最後です。'),
  ];
  const result = index.snapshot(cues);
  assert.deepEqual(
    result.map((c) => c.text),
    ['The next complete sentence.', 'Another.', '最後です。'],
  );
  assert.equal(result[0]!.start, 0);
  assert.equal(result[0]!.end, 2);
  assert.equal(index.snapshot(cues), result);
  const updated = index.snapshot([
    cues[0]!,
    { ...cues[1]!, text: 'revised sentence.', revision: 2 },
    ...cues.slice(2),
  ]);
  assert.equal(updated[0]!.revision, 2);
  assert.equal(updated[1], result[1]);
});
test('manual overlaps, gaps, unrelated tracks and long unpunctuated text are not merged without bounds', () => {
  const index = new SentenceIndex();
  assert.equal(
    index.snapshot([cue(0, 'One', 0, 2), cue(1, 'Other', 1, 3)]).length,
    2,
  );
  assert.equal(
    index.snapshot([cue(0, 'One'), cue(1, 'Other', 4, 5)]).length,
    2,
  );
  const many = Array.from({ length: 100 }, (_, i) => cue(i, 'x'.repeat(120)));
  const result = index.snapshot(many);
  assert.ok(result.length > 1);
  assert.ok(result.every((c) => c.text.length <= 800 && c.end - c.start <= 12));
});
test('rolling timed ASR phrases merge until punctuation, then stop painting at the next sentence start', () => {
  const result = new SentenceIndex().snapshot(
    [
      cue(0, 'A whole', 0, 4),
      cue(1, 'sentence.', 1, 5),
      cue(2, 'Next sentence.', 3, 6),
    ],
    true,
  );
  assert.deepEqual(
    result.map((c) => [c.text, c.start, c.end]),
    [
      ['A whole sentence.', 0, 3],
      ['Next sentence.', 3, 6],
    ],
  );
});
