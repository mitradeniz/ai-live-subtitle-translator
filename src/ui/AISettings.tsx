import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { sendRequest } from '../messaging/client';
import {
  AI_PROFILES,
  AIProfileSchema,
  aiDefinition,
  DEFAULT_AI_PROFILE,
  type AIProfile,
} from '../translation/ai-profile';
import { TRANSLATION_MESSAGES } from '../translation/contracts';

export function AISettings() {
  const [profile, setProfile] = useState<AIProfile>(DEFAULT_AI_PROFILE);
  const [dirty, setDirty] = useState(false);
  const definition = aiDefinition(profile);
  const origin = new URL(profile.endpoint).origin;
  const host = `${origin}/*`;
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(false);
  const [retention, setRetention] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [permitted, setPermitted] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void sendRequest({ type: 'ai.status' })
        .then((data) => {
          if (!active || data.kind !== 'ai-status') return;
          setEnabled(data.enabled);
          setPermitted(data.permitted);
          setRetention(data.status.retention);
        })
        .catch(() => {
          if (active)
            setMessage(
              'AI settings unavailable. Save the supported profile to recover.',
            );
        });
    };
    void sendRequest({ type: 'ai.status' })
      .then((data) => {
        if (active && data.kind === 'ai-status') setProfile(data.profile);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setBusy(false);
      });
    refresh();
    browser.storage.onChanged.addListener(refresh);
    browser.permissions.onRemoved.addListener(refresh);
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(refresh);
      browser.permissions.onRemoved.removeListener(refresh);
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch {
      setMessage(
        'Could not complete this action. Check the profile, access permission and extension errors.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    await sendRequest({ type: 'ai.configure', profile });
    if (key) {
      const value = key;
      setKey('');
      await sendRequest({
        type: 'credentials.set',
        credentialId: 'ai',
        credential: { schemaVersion: 1, origin, key: value },
        rememberOnDevice: remember,
      });
    }
    setDirty(false);
    setMessage(
      'Saved without contacting the provider. Re-enable captions after changes.',
    );
  }
  async function enable() {
    // Keep the browser permission request directly inside the user gesture.
    const granted = browser.permissions.request({ origins: [host] });
    await run(async () => {
      if (!(await granted)) {
        setMessage('Provider access was not granted.');
        return;
      }
      await sendRequest({ type: 'ai.enable' });
      setMessage(
        `${definition.name} selected. Other engines are inactive. Re-enable captions on the video page.`,
      );
    });
  }
  return (
    <section className="glass-panel google-panel" aria-labelledby="ai-title">
      <h2 id="ai-title">AI · Your API key</h2>
      <p>
        Paid API usage on your own account. Caption text, language choices and
        up to four current cues as context go directly to{' '}
        <strong>{new URL(profile.endpoint).hostname}</strong>. No audio, video
        or website cookies are sent.
      </p>
      <fieldset disabled={busy}>
        <legend className="visually-hidden">AI profile</legend>
        <label>
          AI provider
          <select
            aria-label="AI provider"
            value={profile.endpoint}
            onChange={(event) => {
              const next = AI_PROFILES.find(
                (item) => item.endpoint === event.target.value,
              );
              if (!next) return;
              setProfile(
                AIProfileSchema.parse({
                  schemaVersion: 1,
                  endpoint: next.endpoint,
                  model: next.defaultModel,
                }),
              );
              setKey('');
              setRemember(false);
              setDirty(true);
            }}
          >
            {AI_PROFILES.map((item) => (
              <option value={item.endpoint} key={item.endpoint}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Supported HTTPS endpoint
          <input readOnly value={profile.endpoint} />
        </label>
        <label>
          Model
          <select
            value={profile.model}
            onChange={(event) => {
              const parsed = AIProfileSchema.safeParse({
                ...profile,
                model: event.target.value,
              });
              if (parsed.success) {
                setProfile(parsed.data);
                setDirty(true);
              }
            }}
          >
            {definition.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>
        <p className="field-help">
          Reviewed profiles only; no custom endpoints. Saving a different AI
          provider deletes the old origin-bound key. Enter a key for the
          selected provider. Save before enabling or testing.
        </p>
        <label>
          API key
          <input
            type="password"
            value={key}
            maxLength={4096}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            onChange={(event) => setKey(event.target.value)}
            placeholder="Enter a key to save or replace it"
          />
        </label>
        <label className="key-retention">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />{' '}
          Remember this new key on this device
        </label>
        <p className="field-help">
          Default: session storage, cleared on browser restart or extension
          reload/update. Remembered keys survive restart until deleted; device
          storage is not encrypted by this extension. This checkbox applies when
          saving a new key.
        </p>
        <p>
          Saved key:{' '}
          {retention === 'device'
            ? 'remembered on this device'
            : retention === 'session'
              ? 'this session only'
              : 'none'}
          . AI is {enabled ? 'selected' : 'off'}; host access is{' '}
          {permitted ? 'granted' : 'not granted'}.
        </p>
        <div className="actions">
          <button type="button" onClick={() => void run(save)}>
            Save AI profile and key
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void run(async () => {
                setKey('');
                await sendRequest({
                  type: 'credentials.delete',
                  credentialId: 'ai',
                });
                setMessage(
                  'Key deleted from session and device storage. Pending translation stopped.',
                );
              })
            }
          >
            Delete AI key
          </button>
          <button
            type="button"
            disabled={dirty || (enabled && permitted)}
            onClick={() => void enable()}
          >
            Use {definition.name} for captions
          </button>
          <button
            type="button"
            className="secondary"
            disabled={dirty || !retention || !permitted}
            onClick={() =>
              void run(async () => {
                const data = await sendRequest({ type: 'ai.test' });
                if (data.kind !== 'ai-test') throw new Error();
                setMessage(
                  data.success
                    ? 'Small test passed: The selected provider returned a valid response to the English-to-Turkish test. Check translation quality during playback.'
                    : TRANSLATION_MESSAGES[data.error ?? 'RESPONSE'],
                );
              })
            }
          >
            Run small paid test
          </button>
          <button
            type="button"
            className="secondary"
            disabled={dirty}
            onClick={() =>
              void run(async () => {
                await sendRequest({ type: 'ai.disable' });
                await browser.permissions.remove({ origins: [host] });
                if (await browser.permissions.contains({ origins: [host] }))
                  throw new Error();
                setMessage(
                  'AI disabled and selected provider access removed. Saved key retained until you delete it.',
                );
              })
            }
          >
            Disable AI and remove access
          </button>
        </div>
      </fieldset>
      <p className="field-help">
        The test sends only “Hello, world.” to the saved AI provider, once per
        click. Saving or opening this page never tests a key. Up to 10
        requests/minute, 100 per browser session, one at a time, 2,048 output
        tokens/request; no retries or automatic provider fallback. These are
        request limits, not a billing cap. Check your provider’s pricing and
        account limits.
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
