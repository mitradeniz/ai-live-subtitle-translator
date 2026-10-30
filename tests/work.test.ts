import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkCache, cacheIdentity } from '../src/background/work-cache.ts';
import { WorkQueue } from '../src/background/work-queue.ts';
import { RetryGate } from '../src/background/retry-gate.ts';
import { TrustedStorage } from '../src/background/storage.ts';
import { retryAfter } from '../src/translation/retry.ts';
import {
  TranslationFailure,
  type TranslationJob,
} from '../src/translation/contracts.ts';
import { TimedWindow, cueWindow } from '../src/playback/timed-window.ts';
import type { CaptionResult, Cue } from '../src/playback/cues.ts';
import { createController } from '../src/background/controller.ts';
import {
  EXTENSION_ID,
  fakeAreas,
  contentSender,
  uiSender,
  request,
} from './helpers.ts';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const job = (text = 'Hello'): TranslationJob => ({
  jobId: crypto.randomUUID(),
  generation: 1,
  items: [{ id: 'one', revision: 1, text }],
});
const result = (j: TranslationJob): CaptionResult => ({
  generation: j.generation,
  items: j.items.map((i) => ({ ...i, text: `TR ${i.text}` })),
});
const config = {
  provider: 'ai',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'one',
  source: 'en',
  target: 'tr',
  prompt: 'v1',
  glossary: 'none',
  options: { format: 'text' },
};
function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
const failure = (code: string) => (e: unknown) =>
  e instanceof TranslationFailure && e.code === code;
const cue = (id: number): Cue => ({
  id: String(id),
  trackId: 'track',
  revision: 1,
  start: id,
  end: id + 1,
  text: `Cue ${id}`,
});

test('cache identity isolates endpoint, provider, model, languages, context, prompt/glossary and whitespace', async () => {
  const batch = job();
  const key = await cacheIdentity(config, batch);
  for (const field of [
    'provider',
    'endpoint',
    'model',
    'source',
    'target',
    'prompt',
    'glossary',
  ])
    assert.notEqual(
      await cacheIdentity({ ...config, [field]: 'changed' }, batch),
      key,
    );
  assert.notEqual(await cacheIdentity(config, job('Hello ')), key);
  assert.notEqual(
    await cacheIdentity(config, {
      ...batch,
      items: [...batch.items, { id: 'two', revision: 1, text: 'Context' }],
    }),
    key,
  );
  assert.equal(
    await cacheIdentity(config, {
      ...batch,
      jobId: crypto.randomUUID(),
      generation: 8,
      items: batch.items.map((i) => ({ ...i, id: 'new', revision: 9 })),
    }),
    key,
  );
});
test('cache is session-default, bounded, expiring, remaps IDs and clears both stores', async () => {
  const areas = fakeAreas();
  let now = 100;
  const cache = new WorkCache(new TrustedStorage(areas), () => now);
  const batch = job();
  const key = await cacheIdentity(config, batch);
  await cache.put(key, result(batch), () => {});
  assert.equal(areas.local.data['translation-cache.v1'], undefined);
  const changed = {
    ...batch,
    generation: 9,
    items: [{ ...batch.items[0]!, id: 'new', revision: 10 }],
  };
  assert.deepEqual(await cache.get(key, changed), result(changed));
  now += 1_800_001;
  assert.equal(await cache.get(key, batch), null);
  await cache.configure(true);
  for (let i = 0; i < 140; i++)
    await cache.put(
      await cacheIdentity(config, job(String(i))),
      result(job('x'.repeat(1000))),
      () => {},
    );
  const local = areas.local.data[
    'translation-cache.v1'
  ] as unknown as unknown[];
  assert.ok(
    local.length <= 128 &&
      new TextEncoder().encode(JSON.stringify(local)).byteLength <= 262_144,
  );
  now += 86_400_001;
  assert.equal(
    await cache.get(await cacheIdentity(config, job('139')), batch),
    null,
  );
  await cache.configure(false);
  assert.equal(areas.local.data['translation-cache.v1'], undefined);
  await cache.clear();
  assert.equal(areas.session.data['translation-cache.v1'], undefined);
});
test('malformed persistent cache and policy recover safely; private sender cannot use cache controls', async () => {
  const areas = fakeAreas();
  areas.local.data['translation-cache.v1'] = [
    { key: 'bad', texts: ['secret'], expires: Infinity },
  ];
  areas.local.data['cache-policy.v1'] = { persistent: true };
  const c = createController(EXTENSION_ID, areas);
  assert.deepEqual(await c.dispatch(request('cache.status'), uiSender()), {
    ok: true,
    data: { kind: 'cache-status', persistent: false },
  });
  for (const type of ['cache.status', 'cache.clear', 'data.clear']) {
    assert.deepEqual(await c.dispatch(request(type), contentSender()), {
      ok: false,
      error: 'FORBIDDEN',
    });
    assert.deepEqual(
      await c.dispatch(request(type), {
        ...uiSender(),
        tab: { id: 7, incognito: true },
      }),
      { ok: false, error: 'FORBIDDEN' },
    );
  }
});

test('queue prioritizes current cues, deduplicates IDs, caps each tab and cancels abandoned work', async () => {
  const queue = new WorkQueue(new TrustedStorage(fakeAreas()));
  const first = defer<CaptionResult>();
  const started = defer<void>();
  const order: string[] = [];
  const make = (tabId: number, j: TranslationJob) => ({
    provider: 'google',
    config,
    paid: false,
    tabId,
    sessionId: `s${tabId}`,
    job: j,
    valid: () => {},
    perform: async () => {
      order.push(j.items[0]!.text);
      return result(j);
    },
  });
  const a = job('a');
  const firstWork = {
    ...make(1, a),
    perform: () => {
      started.resolve();
      return first.promise;
    },
  };
  const p1 = queue.run(firstWork);
  await started.promise;
  assert.equal(queue.run(firstWork), p1);
  const future = { ...job('future'), priority: 'prefetch' as const };
  const p2 = queue.run(make(1, future));
  await assert.rejects(queue.run(make(1, job('overflow'))), failure('LIMIT'));
  const p3 = queue.run(make(2, job('current')));
  first.resolve(result(a));
  await Promise.all([p1, p2, p3]);
  assert.deepEqual(order, ['current', 'future']);
  const blocked = defer<CaptionResult>();
  const entered = defer<void>();
  const j = job('hold');
  const p4 = queue.run({
    ...make(3, j),
    perform: () => {
      entered.resolve();
      return blocked.promise;
    },
  });
  await entered.promise;
  const p5 = queue.run(make(3, job('never')));
  const rejected = assert.rejects(p5, failure('CANCELLED'));
  await queue.dropTab(3);
  blocked.resolve(result(j));
  await rejected;
  await assert.rejects(p4, failure('CANCELLED'));
});
test('worker reconstruction reuses completed cache and never replays uncertain paid work', async () => {
  const areas = fakeAreas();
  let now = 100;
  const storage = new TrustedStorage(areas);
  const queue = new WorkQueue(storage, () => now);
  const batch = job();
  let count = 0;
  const work = {
    provider: 'ai',
    config,
    paid: true,
    tabId: 7,
    sessionId: 's',
    job: batch,
    valid: () => {},
    perform: async () => {
      count++;
      return result(batch);
    },
  };
  await queue.run(work);
  await new WorkQueue(new TrustedStorage(areas), () => now).run(work);
  assert.equal(count, 1);
  const uncertain = {
    ...work,
    job: job('uncertain'),
    perform: async () => {
      count++;
      throw new TranslationFailure('NETWORK');
    },
  };
  await assert.rejects(
    new WorkQueue(storage, () => now).run(uncertain),
    failure('NETWORK'),
  );
  const reconstructed = new WorkQueue(new TrustedStorage(areas), () => now);
  await assert.rejects(
    reconstructed.run({
      ...uncertain,
      job: { ...uncertain.job, jobId: crypto.randomUUID() },
    }),
    failure('INTERRUPTED'),
  );
  await reconstructed.cache.clear();
  await assert.rejects(
    new WorkQueue(storage, () => now).run(uncertain),
    failure('INTERRUPTED'),
  );
  assert.equal(count, 2);
  now += 1_800_001;
  await assert.rejects(
    new WorkQueue(storage, () => now).run(uncertain),
    failure('NETWORK'),
  );
  assert.equal(count, 3);
});
test('checkpoint is written before dispatch; a crashed keyless job has at most one resumed dispatch', async () => {
  const areas = fakeAreas();
  const storage = new TrustedStorage(areas);
  const entered = defer<void>();
  const held = defer<CaptionResult>();
  const batch = job();
  const work = {
    provider: 'google',
    config,
    paid: false,
    tabId: 7,
    sessionId: 's',
    job: batch,
    valid: () => {},
    perform: () => {
      entered.resolve();
      return held.promise;
    },
  };
  const p = new WorkQueue(storage).run(work);
  await entered.promise;
  assert.equal(
    (areas.session.data['translation-jobs.v1'] as unknown[]).length,
    1,
  );
  const enteredAgain = defer<void>();
  const heldAgain = defer<CaptionResult>();
  const second = new WorkQueue(new TrustedStorage(areas)).run({
    ...work,
    perform: () => {
      enteredAgain.resolve();
      return heldAgain.promise;
    },
  });
  await enteredAgain.promise;
  await assert.rejects(
    new WorkQueue(new TrustedStorage(areas)).run(work),
    failure('INTERRUPTED'),
  );
  heldAgain.resolve(result(batch));
  held.resolve(result(batch));
  await Promise.all([p, second]);
});

test('Retry-After supports seconds/date, persistent cooldown and bounded paid vs keyless retries', async () => {
  assert.equal(retryAfter('5', 0), 5000);
  assert.equal(retryAfter('Thu, 01 Jan 1970 00:01:00 GMT', 0), 60_000);
  assert.equal(retryAfter('invalid', 0), 30_000);
  const areas = fakeAreas();
  const storage = new TrustedStorage(areas);
  let now = 0;
  let calls = 0;
  const gate = new RetryGate(
    storage,
    'retry',
    () => now,
    () => 0,
  );
  await assert.rejects(
    gate.run(
      async () => {
        calls++;
        throw new TranslationFailure('THROTTLED', 60_000);
      },
      true,
      new AbortController().signal,
      () => {},
    ),
    failure('THROTTLED'),
  );
  now = 59_999;
  await assert.rejects(
    new RetryGate(new TrustedStorage(areas), 'retry', () => now).run(
      async () => {
        calls++;
        return 1;
      },
      true,
      new AbortController().signal,
      () => {},
    ),
    failure('COOLDOWN'),
  );
  now = 60_000;
  assert.equal(
    await gate.run(
      async () => {
        calls++;
        return 1;
      },
      true,
      new AbortController().signal,
      () => {},
    ),
    1,
  );
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    new RetryGate(storage, 'paid').run(
      async () => {
        calls++;
        throw new TranslationFailure('NETWORK');
      },
      true,
      new AbortController().signal,
      () => {},
    ),
    failure('NETWORK'),
  );
  assert.equal(calls, 1);
  calls = 0;
  const realGate = new RetryGate(storage, 'free', Date.now, () => 0);
  assert.equal(
    await realGate.run(
      async () => {
        if (++calls < 3) throw new TranslationFailure('NETWORK');
        return 'ok';
      },
      false,
      new AbortController().signal,
      () => {},
    ),
    'ok',
  );
  assert.equal(calls, 3);
});
test('timed window has 20-second/12-cue bounds, current priority, batch cap and stale seek rejection', async () => {
  const cues = Array.from({ length: 200 }, (_, i) => cue(i));
  assert.equal(cueWindow(cues, 0.5, false).length, 12);
  assert.equal(cueWindow(cues, 0.5, true).length, 1);
  assert.ok(
    cueWindow(
      cues.filter((_, i) => i % 5 === 0),
      0.5,
      false,
    ).every((c) => c.start <= 20.5),
  );
  const calls: {
    cues: readonly { id: string; revision: number; text: string }[];
    generation: number;
    signal: AbortSignal;
    resolve: (value: CaptionResult) => void;
  }[] = [];
  const window = new TimedWindow(
    (items, generation, signal) =>
      new Promise((resolve) =>
        calls.push({ cues: items, generation, signal, resolve }),
      ),
    () => {},
    () => {},
  );
  window.update(cues, 0.5, false);
  assert.equal(calls[0]!.cues[0]!.id, '0');
  calls[0]!.resolve({
    generation: calls[0]!.generation,
    items: [{ id: '0', revision: 1, text: 'TR' }],
  });
  await tick();
  assert.ok(calls[1]!.cues.length <= 4);
  assert.deepEqual(window.texts([cues[0]!]), ['TR']);
  window.reset();
  window.update(cues, 100.5, true);
  assert.equal(calls[1]!.signal.aborted, true);
  calls[1]!.resolve({
    generation: calls[1]!.generation,
    items: calls[1]!.cues.map((i) => ({ ...i, text: 'stale' })),
  });
  await tick();
  assert.equal(window.texts([cues[100]!]), null);
  const last = calls.at(-1)!;
  last.resolve({
    generation: last.generation,
    items: [{ id: '100', revision: 1, text: 'fresh' }],
  });
  await tick();
  assert.deepEqual(window.texts([cues[100]!]), ['fresh']);
  window.reset();
});

test('clear-data removes keys, preferences, caches and sessions without resetting spent provider budgets', async () => {
  const areas = fakeAreas();
  const c = createController(EXTENSION_ID, areas);
  await c.dispatch(
    request('credentials.set', {
      credentialId: 'ai',
      credential: {
        schemaVersion: 1,
        origin: 'https://api.openai.com',
        key: 'SENTINEL',
      },
      rememberOnDevice: true,
    }),
    uiSender(),
  );
  await c.dispatch(
    request('cache.configure', { persistent: true }),
    uiSender(),
  );
  const id = c.sessions.grant(contentSender());
  await c.sessions.flush();
  areas.session.data['ai.quota.v1'] = { count: 4 };
  assert.equal((await c.dispatch(request('data.clear'), uiSender())).ok, true);
  assert.deepEqual(
    await c.dispatch(
      request('content.settings', { sessionId: id }),
      contentSender(),
    ),
    { ok: false, error: 'INVALID_SESSION' },
  );
  assert.equal(areas.local.data['credential.v1.ai'], undefined);
  assert.equal(areas.session.data['translation-cache.v1'], undefined);
  assert.deepEqual(areas.session.data['ai.quota.v1'], { count: 4 });
});

test('invalid/out-of-order results never poison cache; final cue ordering follows the request', async () => {
  const queue = new WorkQueue(new TrustedStorage(fakeAreas()));
  const j = {
    ...job(),
    items: [
      { id: 'a', revision: 1, text: 'a' },
      { id: 'b', revision: 2, text: 'b' },
    ],
  };
  const work = {
    provider: 'ai',
    config,
    paid: true,
    tabId: 1,
    sessionId: 's',
    job: j,
    valid: () => {},
    perform: async () => ({
      generation: 1,
      items: [
        { id: 'a', revision: 0, text: 'stale' },
        { id: 'b', revision: 2, text: 'b' },
      ],
    }),
  };
  await assert.rejects(queue.run(work), failure('RESPONSE'));
  assert.equal(await queue.cache.get(await cacheIdentity(config, j), j), null);
  const out = await queue.run({
    ...work,
    perform: async () => ({
      generation: 1,
      items: [...result(j).items].reverse(),
    }),
  });
  assert.deepEqual(out, result(j));
});

test('cache hits still require the selected host grant; deleted credentials cannot read cached paid results', async () => {
  let permitted = true;
  let calls = 0;
  const areas = fakeAreas();
  const c = createController(
    EXTENSION_ID,
    areas,
    undefined,
    undefined,
    undefined,
    {
      permitted: async () => permitted,
      fetch: async () => {
        calls++;
        return new Response(
          '{"data":{"translations":[{"translatedText":"Merhaba"}]}}',
          { headers: { 'content-type': 'application/json' } },
        );
      },
    },
  );
  await c.dispatch(
    request('credentials.set', {
      credentialId: 'google-cloud',
      credential: {
        schemaVersion: 1,
        origin: 'https://translation.googleapis.com',
        key: 'SENTINEL',
      },
    }),
    uiSender(),
  );
  await c.dispatch(request('cloud.enable'), uiSender());
  const sessionId = c.sessions.grant(contentSender());
  const command = request('content.translate', { sessionId, job: job() });
  assert.equal((await c.dispatch(command, contentSender())).ok, true);
  assert.equal(calls, 1);
  permitted = false;
  assert.deepEqual(await c.dispatch(command, contentSender()), {
    ok: true,
    data: { kind: 'translation', result: { ok: false, error: 'PERMISSION' } },
  });
  permitted = true;
  await c.dispatch(
    request('credentials.delete', { credentialId: 'google-cloud' }),
    uiSender(),
  );
  const fresh = c.sessions.grant(contentSender());
  assert.deepEqual(
    await c.dispatch(
      request('content.translate', { sessionId: fresh, job: job() }),
      contentSender(),
    ),
    {
      ok: true,
      data: { kind: 'translation', result: { ok: false, error: 'AI_KEY' } },
    },
  );
  assert.equal(calls, 1);
});

test('one provider dispatch stays active while the global queue rejects the seventeenth job', async () => {
  const queue = new WorkQueue(new TrustedStorage(fakeAreas()));
  const entered = defer<void>();
  const held = defer<CaptionResult>();
  const first = job('first');
  let dispatches = 0;
  const make = (tabId: number, batch: TranslationJob) => ({
    provider: 'google',
    config,
    paid: false,
    tabId,
    sessionId: `tab-${tabId}`,
    job: batch,
    valid: () => {},
    perform: async () => {
      dispatches++;
      entered.resolve();
      return held.promise;
    },
  });
  const pending = [queue.run(make(1, first))];
  await entered.promise;
  for (let tab = 2; tab <= 16; tab++)
    pending.push(queue.run(make(tab, job(String(tab)))));
  await assert.rejects(queue.run(make(17, job('overflow'))), failure('LIMIT'));
  assert.equal(dispatches, 1);
  const settled = Promise.allSettled(pending);
  queue.cancel();
  held.resolve(result(first));
  const outcomes = await settled;
  assert.equal(outcomes.filter((o) => o.status === 'rejected').length, 16);
  assert.equal(dispatches, 1);
});

test('queue relevance deadline rejects waiting work and aborts an active provider operation', async () => {
  const queue = new WorkQueue(new TrustedStorage(fakeAreas()), Date.now, 30);
  const held = defer<CaptionResult>();
  const entered = defer<void>();
  let cancelled = 0;
  const j = job();
  const base = {
    provider: 'google',
    config,
    paid: false,
    tabId: 1,
    sessionId: 's',
    job: j,
    valid: () => {},
    cancel: () => {
      cancelled++;
    },
    perform: () => {
      entered.resolve();
      return held.promise;
    },
  };
  const first = queue.run(base);
  const rejectedFirst = assert.rejects(first, failure('CANCELLED'));
  await entered.promise;
  const second = queue.run({
    ...base,
    tabId: 2,
    sessionId: 't',
    job: job('waiting'),
  });
  await assert.rejects(second, failure('CANCELLED'));
  await rejectedFirst;
  assert.equal(cancelled, 2);
  held.resolve(result(j));
  await tick();
});
