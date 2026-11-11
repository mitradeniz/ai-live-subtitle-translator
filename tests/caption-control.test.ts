import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CaptionControl,
  captionMessage,
  type CaptionResult,
} from '../src/page/caption-control.ts';
import { RequestError } from '../src/messaging/client.ts';

const settle = () => new Promise((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('quick clicks are applied in order and end on the last click', async () => {
  const sent: boolean[] = [];
  const pending: ReturnType<typeof deferred<CaptionResult>>[] = [];
  const control = new CaptionControl({
    request: (enabled) => {
      sent.push(enabled);
      const next = deferred<CaptionResult>();
      pending.push(next);
      return next.promise;
    },
  });
  let paints = 0;
  control.subscribe(() => paints++);
  const first = control.toggle();
  assert.equal(control.on, true, 'A click shows at once');
  void control.toggle();
  void control.toggle();
  assert.equal(control.on, true);
  assert.deepEqual(sent, [true], 'One request at a time');
  // A status read while a change is pending does not move the switch, nor
  // does one that started before a click and answers after it.
  const before = control.version;
  control.observe('disabled');
  assert.equal(control.on, true);
  pending[0]!.resolve({ state: 'enabled' });
  const outcome = await first;
  assert.deepEqual(sent, [true], 'The last click matched the first result');
  assert.equal(control.on, true);
  assert.equal(control.busy, false);
  assert.equal(captionMessage(outcome, 'menu'), '');
  control.observe('disabled', before);
  assert.equal(control.on, true, 'A stale status read is ignored');
  control.observe('enabled', control.version);
  assert.equal(control.on, true);
  assert.ok(paints >= 4);
  // Off and straight back on while the first request is still running.
  const off = control.toggle();
  void control.toggle();
  assert.equal(control.on, true);
  pending[1]!.resolve({ state: 'disabled' });
  await settle();
  // The person ended on "on" again, so it starts once more.
  assert.deepEqual(sent, [true, false, true]);
  pending[2]!.resolve({ state: 'enabled' });
  await off;
  assert.equal(control.on, true);
});

test('the one-start-per-second limit is waited out, and a lasting refusal is reported', async () => {
  const waits: number[] = [];
  let busy = 2;
  const control = new CaptionControl({
    request: async () => {
      if (busy-- > 0) throw new RequestError('BUSY');
      return { state: 'enabled' };
    },
    wait: async (ms) => {
      waits.push(ms);
    },
  });
  const outcome = await control.set(true);
  assert.deepEqual(waits, [1100, 1100]);
  assert.equal(outcome.result?.state, 'enabled');
  assert.equal(control.on, true);
  const stuck = new CaptionControl({
    request: async () => {
      throw new RequestError('BUSY');
    },
    wait: async () => {},
  });
  const failed = await stuck.set(true);
  assert.equal(stuck.on, false, 'The switch returns to the real state');
  assert.equal(
    captionMessage(failed, 'menu'),
    'The extension is busy. Try again in a moment.',
  );
  const gone = new CaptionControl({
    request: async () => {
      throw new RequestError('CONTEXT');
    },
  });
  assert.equal(
    captionMessage(await gone.set(true), 'edge'),
    'The extension was updated. Refresh this page to use it again.',
  );
});

test('turning on from original-only picks a translated display once; other reasons are named', async () => {
  let display = 'original';
  let changes = 0;
  const control = new CaptionControl({
    request: async (enabled) =>
      !enabled
        ? { state: 'disabled' }
        : display === 'original'
          ? { state: 'needs-restart', reason: 'original-only' }
          : { state: 'enabled' },
    translateDisplay: async () => {
      changes++;
      display = 'bilingual';
    },
  });
  const outcome = await control.set(true);
  assert.equal(changes, 1);
  assert.equal(control.on, true);
  assert.equal(
    captionMessage(outcome, 'menu'),
    'Display changed to Original and translation. Change it in Subtitle style.',
  );
  const blocked = new CaptionControl({
    request: async () => ({ state: 'needs-restart', reason: 'no-provider' }),
    translateDisplay: async () => assert.fail('Only original-only changes it'),
  });
  const result = await blocked.set(true);
  assert.equal(blocked.on, false);
  assert.equal(
    captionMessage(result, 'menu'),
    'Choose a translation provider above to translate subtitles.',
  );
  assert.equal(
    captionMessage(
      {
        enable: true,
        result: { state: 'needs-restart', reason: 'provider-setup' },
      },
      'edge',
    ),
    'Google translation is not set up yet. Turn it on in Settings.',
  );
  let attempts = 0;
  const stubborn = new CaptionControl({
    request: async () => {
      attempts++;
      return { state: 'needs-restart', reason: 'original-only' };
    },
    translateDisplay: async () => {},
  });
  await stubborn.set(true);
  assert.equal(attempts, 2, 'It changes the display at most once per click');
  assert.equal(stubborn.on, false);
});
