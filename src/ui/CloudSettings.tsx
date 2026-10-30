import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { sendRequest } from '../messaging/client';
import { CLOUD_HOST, CLOUD_ORIGIN } from '../translation/google-cloud';
import { TRANSLATION_MESSAGES } from '../translation/contracts';

export function CloudSettings() {
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(false);
  const [retention, setRetention] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [permitted, setPermitted] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    let initialized = false;
    const refresh = () => {
      void sendRequest({ type: 'cloud.status' })
        .then((data) => {
          if (active && data.kind === 'cloud-status') {
            setRetention(data.status.retention);
            setEnabled(data.enabled);
            setPermitted(data.permitted);
          }
        })
        .catch(() => {
          if (active) setMessage('Google Cloud settings unavailable.');
        })
        .finally(() => {
          if (active && !initialized) {
            initialized = true;
            setBusy(false);
          }
        });
    };
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
        'Action failed. Check host access, extension errors and your Cloud configuration.',
      );
    } finally {
      setBusy(false);
    }
  }
  function enable() {
    const grant = browser.permissions.request({ origins: [CLOUD_HOST] });
    void run(async () => {
      if (!(await grant)) {
        setMessage('Google Cloud access was not granted.');
        return;
      }
      await sendRequest({ type: 'cloud.enable' });
      setMessage(
        'Google Cloud selected. Other engines are inactive. Re-enable captions on the video page.',
      );
    });
  }
  return (
    <section className="glass-panel google-panel" aria-labelledby="cloud-title">
      <h2 id="cloud-title">Google Cloud · Your API key</h2>
      <p>
        Official Translation Basic v2, billed to your Google Cloud project.
        Enable Cloud Translation API and billing in that project. This key is
        separate from Gemini and experimental keyless Google.
      </p>
      <p>
        Caption text and language choices go to{' '}
        <strong>translation.googleapis.com</strong>. No audio, video or website
        cookies. No AI prompt context.
      </p>
      <fieldset disabled={busy}>
        <legend className="visually-hidden">Google Cloud credentials</legend>
        <label>
          Google Cloud API key
          <input
            type="password"
            value={key}
            maxLength={4096}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        <label className="key-retention">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />{' '}
          Remember this new Cloud key on this device
        </label>
        <p className="field-help">
          Session storage by default: cleared on browser restart or extension
          reload/update. Remembered keys survive until deleted; device storage
          is not encrypted by this extension.
        </p>
        <p>
          Saved key:{' '}
          {retention === 'device'
            ? 'remembered on this device'
            : retention === 'session'
              ? 'this session only'
              : 'none'}
          . Cloud is {enabled ? 'selected' : 'off'}; host access is{' '}
          {permitted ? 'granted' : 'not granted'}.
        </p>
        <div className="actions">
          <button
            type="button"
            disabled={!key}
            onClick={() =>
              void run(async () => {
                const value = key;
                setKey('');
                await sendRequest({
                  type: 'credentials.set',
                  credentialId: 'google-cloud',
                  credential: {
                    schemaVersion: 1,
                    origin: CLOUD_ORIGIN,
                    key: value,
                  },
                  rememberOnDevice: remember,
                });
                setMessage(
                  'Cloud key saved without contacting Google. Re-enable captions after changes.',
                );
              })
            }
          >
            Save Cloud key
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void run(async () => {
                setKey('');
                await sendRequest({
                  type: 'credentials.delete',
                  credentialId: 'google-cloud',
                });
                setMessage(
                  'Cloud key deleted from session and device storage. Pending work stopped.',
                );
              })
            }
          >
            Delete Cloud key
          </button>
          <button
            type="button"
            disabled={enabled && permitted}
            onClick={enable}
          >
            Use Google Cloud for captions
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!retention || !permitted}
            onClick={() =>
              void run(async () => {
                const data = await sendRequest({ type: 'cloud.test' });
                if (data.kind !== 'cloud-test') throw new Error();
                setMessage(
                  data.success
                    ? 'Small Cloud test passed. Check actual translation quality during playback.'
                    : TRANSLATION_MESSAGES[data.error ?? 'RESPONSE'],
                );
              })
            }
          >
            Run small Cloud paid test
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void run(async () => {
                await sendRequest({ type: 'cloud.disable' });
                await browser.permissions.remove({ origins: [CLOUD_HOST] });
                if (
                  await browser.permissions.contains({ origins: [CLOUD_HOST] })
                )
                  throw new Error();
                setMessage(
                  'Cloud disabled and access removed. Saved key remains until deleted.',
                );
              })
            }
          >
            Disable Cloud and remove access
          </button>
        </div>
      </fieldset>
      <p className="field-help">
        Test: “Hello, world.” English-to-Turkish, only when clicked. At most one
        retry after an explicit rate-limit response; no automatic network retry
        or key test. Up to four 1,000-character cues/request, 10
        requests/minute, 100/session. These limits are not a billing cap. Errors
        keep originals; fix the indicated issue or explicitly select another
        engine.
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
