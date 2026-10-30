import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  translateGoogle,
  parseGoogleResponse,
  googleLanguage,
} from '../src/translation/google-keyless.ts';
import {
  TranslationFailure,
  type TranslationJob,
} from '../src/translation/contracts.ts';
import { GoogleCoordinator } from '../src/background/google.ts';
import { TrustedStorage } from '../src/background/storage.ts';
import { DEFAULT_SETTINGS } from '../src/messaging/protocol.ts';
import { createController } from '../src/background/controller.ts';
import {
  fakeAreas,
  request,
  contentSender,
  uiSender,
  EXTENSION_ID,
} from './helpers.ts';

const response = (text = 'Merhaba.') =>
  new Response(JSON.stringify([[[text, 'Hello.']], null, 'en']), {
    headers: { 'content-type': 'application/json' },
  });
const job = (
  items = [{ id: 'cue-1', revision: 1, text: 'Hello.' }],
): TranslationJob => ({ jobId: crypto.randomUUID(), generation: 2, items });
const code = (expected: string) => (error: unknown) =>
  error instanceof TranslationFailure && error.code === expected;

test('keyless request uses fixed HTTPS endpoint, no credentials, and preserves Turkish/Unicode input', async () => {
  const result = await translateGoogle(
    'İstanbul çığ 😊\nHello.',
    'auto',
    'tr',
    new AbortController().signal,
    async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://translate.googleapis.com');
      assert.equal(url.pathname, '/translate_a/single');
      assert.equal(url.searchParams.get('q'), 'İstanbul çığ 😊\nHello.');
      assert.equal(url.searchParams.get('sl'), 'auto');
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.referrerPolicy, 'no-referrer');
      assert.equal(init?.headers, undefined);
      assert.equal(url.searchParams.has('key'), false);
      return response('İstanbul çığ 😊');
    },
  );
  assert.equal(result, 'İstanbul çığ 😊');
  assert.equal(googleLanguage('en-US'), 'en');
  assert.equal(googleLanguage('pt-BR'), 'pt');
  assert.equal(googleLanguage('zh-Hant'), 'zh-TW');
  assert.throws(() => googleLanguage('auto'), code('LANGUAGE'));
  assert.throws(() => googleLanguage('xx'), code('LANGUAGE'));
});

test('response parser bounds output and renders markup-like text only as data', () => {
  assert.equal(
    parseGoogleResponse([
      [
        ['<b>Merhaba</b>', 'Hello'],
        [' dünya', ' world'],
      ],
    ]),
    '<b>Merhaba</b> dünya',
  );
  for (const data of [
    null,
    {},
    [],
    [[]],
    [[[null, 'source']]],
    [[['ok', null]]],
    [[['x'.repeat(4001), 'source']]],
  ])
    assert.throws(() => parseGoogleResponse(data), code('RESPONSE'));
});

test('provider validates status, JSON, response size, timeout and cancellation without retries', async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0;
    await assert.rejects(
      translateGoogle(
        'Hello',
        'en',
        'tr',
        new AbortController().signal,
        async () => {
          calls++;
          return new Response('', { status });
        },
      ),
      code(status === 429 ? 'THROTTLED' : 'BLOCKED'),
    );
    assert.equal(calls, 1);
  }
  for (const bad of [
    new Response('<html>challenge</html>'),
    new Response('not json', {
      headers: { 'content-type': 'application/json' },
    }),
    new Response('x'.repeat(33000), {
      headers: { 'content-type': 'application/json' },
    }),
  ])
    await assert.rejects(
      translateGoogle(
        'Hello',
        'en',
        'tr',
        new AbortController().signal,
        async () => bad,
      ),
      code('RESPONSE'),
    );
  const stalled: typeof fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new Error('redact-me')),
        { once: true },
      );
    });
  const keepAlive = setTimeout(() => {}, 100);
  await assert.rejects(
    translateGoogle(
      'Hello',
      'en',
      'tr',
      new AbortController().signal,
      stalled,
      10,
    ),
    code('TIMEOUT'),
  );
  clearTimeout(keepAlive);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    translateGoogle('Hello', 'en', 'tr', abort.signal, stalled),
    code('CANCELLED'),
  );
});

function harness(fetcher: typeof fetch = async () => response()) {
  const areas = fakeAreas();
  let allowed = true;
  let now = 100_000;
  const ports = {
    permitted: async () => allowed,
    fetch: fetcher,
    now: () => now,
  };
  const make = () => new GoogleCoordinator(new TrustedStorage(areas), ports);
  return {
    areas,
    make,
    google: make(),
    allow: (value: boolean) => {
      allowed = value;
    },
    advance: () => {
      now += 1100;
    },
  };
}

test('default off, original-only and denied permission produce no request', async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    return response();
  });
  await assert.rejects(
    h.google.translate(1, 's', job(), DEFAULT_SETTINGS, () => {}),
    code('OFF'),
  );
  await h.google.setEnabled(true);
  await assert.rejects(
    h.google.translate(
      1,
      's',
      job(),
      { ...DEFAULT_SETTINGS, displayMode: 'original' },
      () => {},
    ),
    code('OFF'),
  );
  h.allow(false);
  await assert.rejects(
    h.google.translate(1, 's', job(), DEFAULT_SETTINGS, () => {}),
    code('OFF'),
  );
  assert.equal(calls, 0);
});

test('multiple cues use individual requests and preserve IDs/revisions/generation', async () => {
  const h = harness(async (input) => {
    h.advance();
    return response(
      new URL(String(input)).searchParams.get('q') === 'One' ? 'Bir' : 'İki',
    );
  });
  await h.google.setEnabled(true);
  const result = await h.google.translate(
    1,
    's',
    job([
      { id: 'one', revision: 3, text: 'One' },
      { id: 'two', revision: 9, text: 'Two' },
    ]),
    DEFAULT_SETTINGS,
    () => {},
  );
  assert.deepEqual(result, {
    generation: 2,
    items: [
      { id: 'one', revision: 3, text: 'Bir' },
      { id: 'two', revision: 9, text: 'İki' },
    ],
  });
});

test('request budgets survive reconstruction; authentication denial latches for browser session', async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    return response();
  });
  await h.google.setEnabled(true);
  for (let i = 0; i < 20; i++) {
    await h.google.translate(1, 's', job(), DEFAULT_SETTINGS, () => {});
    h.advance();
  }
  await assert.rejects(
    h.make().translate(1, 's', job(), DEFAULT_SETTINGS, () => {}),
    code('LIMIT'),
  );
  assert.equal(calls, 20);
  const blocked = harness(async () => new Response('', { status: 403 }));
  await blocked.google.setEnabled(true);
  await assert.rejects(
    blocked.google.translate(1, 's', job(), DEFAULT_SETTINGS, () => {}),
    code('BLOCKED'),
  );
  blocked.advance();
  await assert.rejects(
    blocked.make().translate(1, 's', job(), DEFAULT_SETTINGS, () => {}),
    code('BLOCKED'),
  );
  assert.equal(
    blocked.areas.session.data['google-keyless.quota.v1'] !== undefined,
    true,
  );
});

test('revocation or cancellation during an in-flight response rejects late results', async () => {
  for (const action of ['permission', 'disable', 'tab', 'cancel'] as const) {
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let finish!: (value: Response) => void;
    const h = harness(async () => {
      ready();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await h.google.setEnabled(true);
    const batch = job();
    const pending = h.google.translate(
      1,
      's',
      batch,
      DEFAULT_SETTINGS,
      () => {},
    );
    await started;
    await assert.rejects(
      h.google.translate(2, 'other', job(), DEFAULT_SETTINGS, () => {}),
      code('BUSY'),
    );
    if (action === 'permission') h.allow(false);
    if (action === 'disable') await h.google.setEnabled(false);
    if (action === 'tab') h.google.cancelTab(1);
    if (action === 'cancel') h.google.cancel('s', batch.jobId);
    const rejected = assert.rejects(
      pending,
      code(action === 'permission' ? 'PERMISSION' : 'CANCELLED'),
    );
    finish(response());
    await rejected;
  }
});

test('cancellation before registration, malformed consent and corrupt budget fail closed', async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    return response();
  });
  await h.google.setEnabled(true);
  const batch = job();
  h.google.cancel('s', batch.jobId);
  await assert.rejects(
    h.google.translate(1, 's', batch, DEFAULT_SETTINGS, () => {}),
    code('CANCELLED'),
  );
  h.areas.local.data['google-keyless.v1'] = {
    schemaVersion: 1,
    enabled: true,
    unexpected: true,
  };
  assert.equal(await h.google.enabled(), false);
  await h.google.setEnabled(true);
  h.areas.session.data['google-keyless.quota.v1'] = { total: 0 };
  await assert.rejects(
    h.google.translate(1, 's', job(), DEFAULT_SETTINGS, () => {}),
    code('LIMIT'),
  );
  assert.equal(calls, 0);
});

test('translation messages require bound content sessions; consent changes remain options-only', async () => {
  let calls = 0;
  const c = createController(EXTENSION_ID, fakeAreas(), undefined, {
    permitted: async () => true,
    fetch: async () => {
      calls++;
      return response();
    },
  });
  for (const type of ['google.enable', 'google.disable', 'google.status']) {
    assert.deepEqual(await c.dispatch(request(type), contentSender()), {
      ok: false,
      error: 'FORBIDDEN',
    });
    assert.deepEqual(await c.dispatch(request(type), uiSender('popup')), {
      ok: false,
      error: 'FORBIDDEN',
    });
  }
  await c.dispatch(request('google.enable'), uiSender());
  const content = contentSender();
  const sessionId = c.sessions.grant(content);
  const message = request('content.translate', { sessionId, job: job() });
  assert.deepEqual(
    await c.dispatch({ ...message, endpoint: 'https://evil.test' }, content),
    { ok: false, error: 'INVALID_MESSAGE' },
  );
  assert.deepEqual(
    await c.dispatch(message, { ...content, documentId: 'other' }),
    { ok: false, error: 'INVALID_SESSION' },
  );
  assert.deepEqual(await c.dispatch(message, uiSender()), {
    ok: false,
    error: 'FORBIDDEN',
  });
  const result = await c.dispatch(message, content);
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  c.sessions.revokeTab(content.tab.id);
  assert.deepEqual(await c.dispatch(message, content), {
    ok: false,
    error: 'INVALID_SESSION',
  });
});

test('session total cap and minimum interval cannot be reset by toggling consent', async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    return response();
  });
  await h.google.setEnabled(true);
  await h.google.translate(1, 's', job(), DEFAULT_SETTINGS, () => {});
  await h.google.setEnabled(false);
  await h.google.setEnabled(true);
  await assert.rejects(
    h.google.translate(1, 's', job(), DEFAULT_SETTINGS, () => {}),
    code('LIMIT'),
  );
  const quota = h.areas.session.data['google-keyless.quota.v1'] as Record<
    string,
    unknown
  >;
  h.areas.session.data['google-keyless.quota.v1'] = { ...quota, total: 200 };
  h.advance();
  await assert.rejects(
    h.make().translate(1, 's', job(), DEFAULT_SETTINGS, () => {}),
    code('LIMIT'),
  );
  assert.equal(calls, 1);
});

test('an older pending enable cannot override a newer disable', async () => {
  let allow!: (value: boolean) => void;
  const areas = fakeAreas();
  const google = new GoogleCoordinator(new TrustedStorage(areas), {
    permitted: () =>
      new Promise((resolve) => {
        allow = resolve;
      }),
  });
  const enabling = google.setEnabled(true);
  await google.setEnabled(false);
  allow(true);
  assert.equal(await enabling, false);
  assert.deepEqual(areas.local.data['google-keyless.v1'], {
    schemaVersion: 1,
    enabled: false,
  });
});
