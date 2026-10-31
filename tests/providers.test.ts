import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  translateCloud,
  parseCloudResponse,
  cloudLanguage,
  CLOUD_ORIGIN,
  CLOUD_ENDPOINT,
} from '../src/translation/google-cloud.ts';
import { translateAI } from '../src/translation/openai.ts';
import {
  AIProfileSchema,
  AI_PROFILES,
  DEFAULT_AI_PROFILE,
  DEEPSEEK_ENDPOINT,
  GEMINI_ENDPOINT,
} from '../src/translation/ai-profile.ts';
import {
  TranslationFailure,
  type TranslationJob,
} from '../src/translation/contracts.ts';
import { createController } from '../src/background/controller.ts';
import { CredentialStore } from '../src/background/credentials.ts';
import { TrustedStorage } from '../src/background/storage.ts';
import { DEFAULT_SETTINGS } from '../src/messaging/protocol.ts';
import {
  fakeAreas,
  request,
  uiSender,
  contentSender,
  EXTENSION_ID,
  SENTINEL,
} from './helpers.ts';

const job = (): TranslationJob => ({
  jobId: crypto.randomUUID(),
  generation: 9,
  items: [
    { id: 'a', revision: 4, text: 'Hello 😊' },
    { id: 'b', revision: 8, text: 'World <b>text</b>' },
  ],
});
const json = (raw: unknown, status = 200) =>
  new Response(JSON.stringify(raw), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const cloudResponse = () =>
  json({
    data: {
      translations: [
        { translatedText: 'Merhaba çığ 😊' },
        { translatedText: '<b>dünya</b> &lt;literal&gt;' },
      ],
    },
  });
const code = (expected: string) => (error: unknown) =>
  error instanceof TranslationFailure && error.code === expected;
const signal = () => new AbortController().signal;
const cloudKey = { schemaVersion: 1, origin: CLOUD_ORIGIN, key: SENTINEL };

test('Cloud v2 uses a fixed URL, API key header, plain text and ordered bounded batch mapping', async () => {
  const batch = job();
  const result = await translateCloud(
    SENTINEL,
    batch,
    'auto',
    'tr-TR',
    signal(),
    async (url, init) => {
      assert.equal(url, CLOUD_ENDPOINT);
      assert.ok(!String(url).includes(SENTINEL));
      assert.equal(new Headers(init?.headers).get('x-goog-api-key'), SENTINEL);
      assert.equal(new Headers(init?.headers).get('authorization'), null);
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.credentials, 'omit');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        q: batch.items.map((item) => item.text),
        target: 'tr',
        format: 'text',
        model: 'nmt',
      });
      assert.ok(!String(init?.body).includes(SENTINEL));
      return cloudResponse();
    },
  );
  assert.deepEqual(result, {
    generation: 9,
    items: [
      { id: 'a', revision: 4, text: 'Merhaba çığ 😊' },
      { id: 'b', revision: 8, text: '<b>dünya</b> &lt;literal&gt;' },
    ],
  });
  assert.equal(cloudLanguage('PT-br'), 'pt');
  assert.equal(cloudLanguage('zh-Hant'), 'zh-TW');
  assert.equal(cloudLanguage('zh-Hans'), 'zh-CN');
  assert.equal(cloudLanguage('iw'), 'he');
  assert.equal(cloudLanguage('in'), 'id');
  for (const lang of ['xx', 'auto', 'https://evil.test'])
    assert.throws(() => cloudLanguage(lang), code('LANGUAGE'));
});

test('Cloud rejects alignment, empty/oversized output, invalid language and oversized input without retry', async () => {
  for (const translations of [
    [],
    [{ translatedText: 'one only' }],
    [{ translatedText: 'x'.repeat(4001) }, { translatedText: 'ok' }],
    [{ translatedText: ' ' }, { translatedText: 'ok' }],
    [{ translatedText: 1 }, { translatedText: 'ok' }],
  ])
    assert.throws(
      () => parseCloudResponse({ data: { translations } }, job()),
      code('RESPONSE'),
    );
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return cloudResponse();
  };
  await assert.rejects(
    translateCloud(SENTINEL, job(), 'auto', 'xx', signal(), fetcher),
    code('LANGUAGE'),
  );
  await assert.rejects(
    translateCloud(
      SENTINEL,
      { ...job(), items: Array(5).fill(job().items[0]) },
      'auto',
      'tr',
      signal(),
      fetcher,
    ),
    code('LIMIT'),
  );
  assert.equal(calls, 0);
});

test('paid errors distinguish key/access, quota/balance, language and configuration without echoing secrets', async () => {
  for (const [status, raw, expected] of [
    [
      400,
      {
        error: {
          details: [{ reason: 'API_KEY_INVALID' }],
          message: `https://example.test/?key=${SENTINEL}`,
        },
      },
      'AUTH',
    ],
    [401, { error: { message: SENTINEL } }, 'AUTH'],
    [403, {}, 'AUTH'],
    [403, { error: { errors: [{ reason: 'dailyLimitExceeded' }] } }, 'QUOTA'],
    [402, {}, 'QUOTA'],
    [429, {}, 'THROTTLED'],
    [400, { error: { message: 'Unsupported target language' } }, 'LANGUAGE'],
    [400, {}, 'PROVIDER_REQUEST'],
    [422, {}, 'PROVIDER_REQUEST'],
    [500, {}, 'NETWORK'],
  ] as const) {
    let count = 0;
    await assert.rejects(
      translateCloud(SENTINEL, job(), 'en', 'tr', signal(), async () => {
        count++;
        return json(raw, status);
      }),
      (error: unknown) =>
        code(expected)(error) &&
        error instanceof Error &&
        !error.message.includes(SENTINEL),
    );
    assert.equal(count, 1);
  }
  await assert.rejects(
    translateCloud(
      SENTINEL,
      job(),
      'en',
      'tr',
      signal(),
      async () => new Response('', { status: 302 }),
    ),
    code('NETWORK'),
  );
});

for (const definition of AI_PROFILES.filter(
  (item) => item.endpoint !== DEFAULT_AI_PROFILE.endpoint,
)) {
  test(`${definition.name} sends its documented contract and validates returned cue revisions`, async () => {
    const profile = AIProfileSchema.parse({
      schemaVersion: 1,
      endpoint: definition.endpoint,
      model: definition.defaultModel,
    });
    const batch = job();
    const result = await translateAI(
      profile,
      SENTINEL,
      batch,
      'en',
      'tr',
      signal(),
      async (url, init) => {
        assert.equal(url, definition.endpoint);
        assert.equal(
          new Headers(init?.headers).get('authorization'),
          `Bearer ${SENTINEL}`,
        );
        assert.equal(init?.redirect, 'error');
        assert.equal(init?.credentials, 'omit');
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, definition.defaultModel);
        assert.equal(body.messages[0].role, 'system');
        assert.equal(body.max_tokens, 2048);
        assert.equal(body.max_completion_tokens, undefined);
        assert.equal(body.store, undefined);
        assert.equal(body.tools, undefined);
        assert.deepEqual(
          JSON.parse(body.messages[1].content).items,
          batch.items,
        );
        assert.ok(!String(init?.body).includes(SENTINEL));
        if (definition.endpoint === DEEPSEEK_ENDPOINT) {
          assert.deepEqual(body.thinking, { type: 'disabled' });
          assert.deepEqual(body.response_format, { type: 'json_object' });
          assert.match(body.messages[0].content, /JSON/);
        } else {
          assert.equal(body.reasoning_effort, 'low');
          assert.equal(body.response_format.type, 'json_schema');
        }
        return json({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  items: batch.items.map((item) => ({
                    ...item,
                    text: 'Merhaba 😊',
                  })),
                }),
              },
            },
          ],
        });
      },
    );
    assert.equal(result.generation, 9);
    assert.equal(result.items[1]?.revision, 8);
    await assert.rejects(
      translateAI(profile, SENTINEL, batch, 'en', 'tr', signal(), async () =>
        json({
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: '    ' },
            },
          ],
        }),
      ),
      code('RESPONSE'),
    );
  });
}

test('AI origin changes delete the prior credential; models cannot be mixed between profiles', async () => {
  const areas = fakeAreas();
  const c = createController(EXTENSION_ID, areas);
  const keys = new CredentialStore(new TrustedStorage(areas));
  await keys.set('ai', { ...cloudKey, origin: 'https://api.openai.com' }, true);
  await c.dispatch(
    request('ai.configure', {
      profile: {
        schemaVersion: 1,
        endpoint: DEEPSEEK_ENDPOINT,
        model: 'deepseek-flash',
      },
    }),
    uiSender(),
  );
  assert.equal((await keys.status('ai')).configured, false);
  await keys.set('ai', { ...cloudKey, origin: 'https://api.deepseek.com' });
  await c.dispatch(
    request('ai.configure', {
      profile: {
        schemaVersion: 1,
        endpoint: GEMINI_ENDPOINT,
        model: 'gemini-3.8-flash',
      },
    }),
    uiSender(),
  );
  assert.equal((await keys.status('ai')).configured, false);
  assert.equal(
    AIProfileSchema.safeParse({
      schemaVersion: 1,
      endpoint: GEMINI_ENDPOINT,
      model: 'deepseek-flash',
    }).success,
    false,
  );
  assert.equal(
    AIProfileSchema.safeParse({
      schemaVersion: 1,
      endpoint: 'https://api.deepseek.com.evil.test/chat/completions',
      model: 'deepseek-flash',
    }).success,
    false,
  );
});

test('Cloud operations are options-only; a fresh install selects no paid provider and makes no test calls', async () => {
  let calls = 0;
  const c = createController(
    EXTENSION_ID,
    fakeAreas(),
    undefined,
    undefined,
    undefined,
    {
      permitted: async () => true,
      fetch: async () => {
        calls++;
        return cloudResponse();
      },
    },
  );
  assert.deepEqual(await c.dispatch(request('provider.status'), uiSender()), {
    ok: true,
    data: { kind: 'provider-status', selected: 'none' },
  });
  for (const sender of [contentSender(), uiSender('popup')])
    for (const type of [
      'cloud.status',
      'cloud.enable',
      'cloud.disable',
      'cloud.test',
      'provider.status',
    ])
      assert.deepEqual(await c.dispatch(request(type), sender), {
        ok: false,
        error: 'FORBIDDEN',
      });
  await c.dispatch(
    request('credentials.set', {
      credentialId: 'google-cloud',
      credential: cloudKey,
    }),
    uiSender(),
  );
  await c.dispatch(request('cloud.enable'), uiSender());
  assert.equal(calls, 0);
  assert.ok(
    !JSON.stringify(
      await c.dispatch(request('settings.export'), uiSender()),
    ).includes(SENTINEL),
  );
});

for (const mutation of [
  'cloud.disable',
  'ai.enable',
  'google.enable',
  'settings.update',
  'credentials.delete',
] as const) {
  test(`${mutation} during a Cloud request invalidates pending results and old sessions`, async () => {
    let ready!: () => void;
    let finish!: (response: Response) => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let cloudCalls = 0;
    let otherCalls = 0;
    const others = {
      permitted: async () => true,
      fetch: async () => {
        otherCalls++;
        throw new Error();
      },
    };
    const c = createController(
      EXTENSION_ID,
      fakeAreas(),
      undefined,
      others,
      others,
      {
        permitted: async () => true,
        fetch: async () => {
          cloudCalls++;
          ready();
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      },
    );
    await c.dispatch(
      request('credentials.set', {
        credentialId: 'google-cloud',
        credential: cloudKey,
      }),
      uiSender(),
    );
    await c.dispatch(request('cloud.enable'), uiSender());
    const sessionId = c.sessions.grant(contentSender());
    const pending = c.dispatch(
      request('content.translate', { sessionId, job: job() }),
      contentSender(),
    );
    await started;
    const { schemaVersion: _, ...preferences } = DEFAULT_SETTINGS;
    void _;
    const extra =
      mutation === 'settings.update'
        ? { preferences: { ...preferences, targetLanguage: 'de' } }
        : mutation === 'credentials.delete'
          ? { credentialId: 'google-cloud' }
          : {};
    await c.dispatch(request(mutation, extra), uiSender());
    finish(cloudResponse());
    assert.deepEqual(await pending, {
      ok: true,
      data: { kind: 'translation', result: { ok: false, error: 'CANCELLED' } },
    });
    assert.deepEqual(
      await c.dispatch(
        request('content.translate', { sessionId, job: job() }),
        contentSender(),
      ),
      { ok: false, error: 'INVALID_SESSION' },
    );
    assert.equal(cloudCalls, 1);
    assert.equal(otherCalls, 0);
  });
}

test('Cloud permission loss rejects late results; quota stop persists across worker restart without fallback', async () => {
  let permitted = true;
  let count = 0;
  let ready!: () => void;
  let finish!: (value: Response) => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const areas = fakeAreas();
  const ports = {
    permitted: async () => permitted,
    fetch: async () => {
      count++;
      ready();
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  };
  let c = createController(
    EXTENSION_ID,
    areas,
    undefined,
    undefined,
    undefined,
    ports,
  );
  await c.dispatch(
    request('credentials.set', {
      credentialId: 'google-cloud',
      credential: cloudKey,
    }),
    uiSender(),
  );
  await c.dispatch(request('cloud.enable'), uiSender());
  const sessionId = c.sessions.grant(contentSender());
  const pending = c.dispatch(
    request('content.translate', { sessionId, job: job() }),
    contentSender(),
  );
  await started;
  permitted = false;
  finish(cloudResponse());
  assert.deepEqual(await pending, {
    ok: true,
    data: { kind: 'translation', result: { ok: false, error: 'PERMISSION' } },
  });
  permitted = true;
  const quotaPorts = {
    permitted: async () => true,
    now: () => Date.now() + 2000,
    fetch: async () => {
      count++;
      return json({ error: { status: 'RESOURCE_EXHAUSTED' } }, 429);
    },
  };
  c = createController(
    EXTENSION_ID,
    areas,
    undefined,
    undefined,
    undefined,
    quotaPorts,
  );
  assert.deepEqual(await c.dispatch(request('cloud.test'), uiSender()), {
    ok: true,
    data: { kind: 'cloud-test', success: false, error: 'QUOTA' },
  });
  c = createController(
    EXTENSION_ID,
    areas,
    undefined,
    undefined,
    undefined,
    quotaPorts,
  );
  assert.deepEqual(await c.dispatch(request('cloud.test'), uiSender()), {
    ok: true,
    data: { kind: 'cloud-test', success: false, error: 'QUOTA' },
  });
  assert.equal(count, 2);
});
