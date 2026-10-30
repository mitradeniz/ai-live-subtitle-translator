import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { sendRequest } from '../messaging/client';
import { DEFAULT_AI_PROFILE, type AIProfile } from '../translation/ai-profile';
import { CLOUD_HOST } from '../translation/google-cloud';
import { GOOGLE_HOST } from '../translation/contracts';
type Engine = 'none' | 'google' | 'google-cloud' | 'ai';
const labels = {
  none: 'Original captions only',
  google: 'Google · Experimental · No key',
  'google-cloud': 'Google Cloud · Your key · Provider billing',
  ai: 'AI · Your key and model',
};
export function ProviderSelector() {
  const [selected, setSelected] = useState<Engine>('none');
  const [choice, setChoice] = useState<Engine>('none');
  const [profile, setProfile] = useState<AIProfile>(DEFAULT_AI_PROFILE);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    let initialized = false;
    let revision = 0;
    const refresh = () => {
      const ticket = ++revision;
      void Promise.all([
        sendRequest({ type: 'provider.status' }),
        sendRequest({ type: 'ai.status' }),
      ])
        .then(([engine, ai]) => {
          if (!active || ticket !== revision) return;
          if (engine.kind === 'provider-status') {
            setSelected(engine.selected);
            setChoice(engine.selected);
          }
          if (ai.kind === 'ai-status') setProfile(ai.profile);
        })
        .catch(() => {
          if (active) setMessage('Provider status unavailable.');
        })
        .finally(() => {
          if (active && !initialized) {
            initialized = true;
            setBusy(false);
          }
        });
    };
    const onChanged = (changes: Record<string, unknown>) => {
      if (
        ['translation-provider.v1', 'ai-profile.v1', 'google-keyless.v1'].some(
          (key) => key in changes,
        )
      )
        refresh();
    };
    refresh();
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, []);
  function apply() {
    const host =
      choice === 'google'
        ? GOOGLE_HOST
        : choice === 'google-cloud'
          ? CLOUD_HOST
          : `${new URL(profile.endpoint).origin}/*`;
    const grant =
      choice === 'none'
        ? Promise.resolve(true)
        : browser.permissions.request({ origins: [host] });
    setBusy(true);
    setMessage('');
    void (async () => {
      if (!(await grant)) {
        setMessage('Access was not granted. Your current engine is unchanged.');
        return;
      }
      if (choice === 'none') {
        await sendRequest({ type: 'google.disable' });
        await sendRequest({ type: 'cloud.disable' });
        await sendRequest({ type: 'ai.disable' });
      } else
        await sendRequest({
          type:
            choice === 'google'
              ? 'google.enable'
              : choice === 'google-cloud'
                ? 'cloud.enable'
                : 'ai.enable',
        });
      setMessage(
        'Engine selected. Re-enable captions from the video page popup. No test was sent.',
      );
    })()
      .catch(() =>
        setMessage(
          'Could not select engine. Check saved profile and permission.',
        ),
      )
      .finally(() => setBusy(false));
  }
  return (
    <section
      className="glass-panel google-panel"
      aria-labelledby="engine-title"
    >
      <h2 id="engine-title">Translation engine</h2>
      <p>
        Current: {labels[selected]}. Only one engine handles captions. A failure
        never switches services automatically.
      </p>
      <label>
        Engine
        <select
          aria-label="Engine"
          disabled={busy}
          value={choice}
          onChange={(event) => {
            const value = event.target.value;
            if (
              value === 'none' ||
              value === 'google' ||
              value === 'google-cloud' ||
              value === 'ai'
            )
              setChoice(value);
          }}
        >
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="field-help">
        Configure keys and the AI profile below before selecting a paid engine.
        Changing an engine or language stops current translations. Use Enable
        captions in the video popup again.
      </p>
      <div className="actions">
        <button type="button" disabled={busy} onClick={apply}>
          Apply engine
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
