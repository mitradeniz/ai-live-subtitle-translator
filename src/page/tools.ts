import { SelectionPopup } from './selection-popup';
import { PageText, EXCLUDED } from './dom';
import { PlayerShortcut } from '../playback/shortcut';
import type { PagePreferences, PageState, WritingStyle } from './contracts';
import type { Settings, SelectionLanguages } from '../messaging/protocol';
import { sendRequest } from '../messaging/client';
import { translate } from '../ui/strings';
import { createCheck, createMark } from '../ui/mark';
import { TRANSLATION_MESSAGES } from '../translation/contracts';

type Feature = 'page' | 'selection' | 'hover' | 'input' | 'writing';
type Field = HTMLTextAreaElement | HTMLInputElement;
const isField = (element: unknown): element is Field =>
  (element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement &&
      ['text', 'search'].includes(element.type))) &&
  !element.disabled &&
  !element.readOnly &&
  !/password|secret|token|credit|card|cvc|cvv|otp|one.time|username|email|address|phone|tel|cc-/i.test(
    `${element.name} ${element.id} ${element.autocomplete}`,
  );

export class PageTools {
  readonly host = document.createElement('translator-page-tools');
  #shadow = this.host.attachShadow({ mode: 'open' });
  #dock = document.createElement('div');
  #button = document.createElement('button');
  #panel = document.createElement('section');
  #show = document.createElement('button');
  #status = document.createElement('p');
  #result = document.createElement('div');
  #draft = document.createElement('textarea');
  #writingPanel = document.createElement('details');
  #style = document.createElement('select');
  #apply: HTMLButtonElement;
  #translate: HTMLButtonElement;
  #restore: HTMLButtonElement;
  #captions = document.createElement('button');
  #badge = document.createElement('span');
  #captionsOn = false;
  #page: PageText;
  #playerShortcut: PlayerShortcut | undefined;
  #selectionPopup: SelectionPopup | undefined;
  #closed = false;
  #epoch = 0;
  #serial = 0;
  #pending = 0;
  #requests = 0;
  #position = { side: 1, height: 0.22 };
  #drag: { id: number; x: number; y: number; moved: boolean } | undefined;
  #hoverTimer: ReturnType<typeof setTimeout> | undefined;
  #lastHover = '';
  #field: Field | null = null;
  #fieldOriginal = '';
  #fieldResult = '';
  #selection = '';
  #url = location.href;
  #expiry: ReturnType<typeof setInterval>;
  #started = Date.now();
  state: PageState = 'ready';
  private sessionId: string;
  private prefs: PagePreferences;
  private settings: Settings;
  private ai: boolean;
  constructor(
    sessionId: string,
    prefs: PagePreferences,
    settings: Settings,
    label: string,
    ai: boolean,
    reloadMenu: (sessionId: string) => Promise<void>,
  ) {
    this.sessionId = sessionId;
    this.prefs = prefs;
    this.settings = settings;
    this.ai = ai;
    const css = document.createElement('style');
    css.textContent = `:host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;color-scheme:dark;--font:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}*{box-sizing:border-box}[hidden]{display:none!important}.dock{position:fixed;pointer-events:auto;font:13px/1.5 var(--font);color:#f3f6fc}.trigger{display:grid;place-items:center;width:46px;height:46px;padding:0;white-space:nowrap;border:0;border-radius:16px;touch-action:none;cursor:grab;background:linear-gradient(180deg,rgb(255 255 255 / 20%),rgb(255 255 255 / 5%)),rgb(16 20 36 / 66%);-webkit-backdrop-filter:blur(16px) saturate(170%);backdrop-filter:blur(16px) saturate(170%);box-shadow:inset 0 1px 0 rgb(255 255 255 / 50%),inset 0 0 0 1px rgb(255 255 255 / 14%),0 12px 28px -10px rgb(0 0 0 / 60%)}.trigger{position:relative}.trigger svg{width:30px;height:30px;pointer-events:none}.badge{position:absolute;top:-3px;right:-3px;display:grid;place-items:center;width:12px;height:12px;border-radius:50%;background:rgb(139 147 167 / 90%);box-shadow:0 0 0 2px rgb(16 20 36 / 92%);transition:width .35s cubic-bezier(.34,1.56,.64,1),height .35s cubic-bezier(.34,1.56,.64,1),background .3s}.badge svg{width:11px;height:11px;opacity:0;transition:opacity .2s}.trigger[data-active="true"] .badge{width:18px;height:18px;background:#7fe9c3;color:#06231a}.trigger[data-active="true"] .badge svg{opacity:1}.trigger:hover{background:linear-gradient(180deg,rgb(255 255 255 / 28%),rgb(255 255 255 / 9%)),rgb(16 20 36 / 72%)}.trigger:active{transform:none}.panel{position:absolute;width:320px;max-width:calc(100vw - 24px);padding:16px;border:1px solid rgb(255 255 255 / 16%);border-radius:24px;background:linear-gradient(180deg,rgb(34 42 66 / 86%),rgb(14 18 32 / 92%));box-shadow:inset 0 1px 0 rgb(255 255 255 / 24%),0 24px 50px -16px rgb(0 0 0 / 65%);-webkit-backdrop-filter:blur(24px) saturate(170%);backdrop-filter:blur(24px) saturate(170%);overflow:auto}.panel{display:flex;flex-direction:column;gap:8px}.panel h2{margin:0;font-size:16px;font-weight:650;letter-spacing:-.01em}.panel .destination{margin:-4px 0 4px;color:rgb(226 233 247 / 70%)}.panel .consent{margin:0;color:rgb(226 233 247 / 56%)}.panel .row{margin:0}.wide{width:100%}.switch{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:10px 14px;border-radius:16px}.switch .track{flex:none;width:34px;height:20px;padding:2px;border-radius:999px;background:rgb(255 255 255 / 16%);box-shadow:inset 0 1px 2px rgb(0 0 0 / 40%);transition:background .3s}.switch .track span{display:block;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgb(0 0 0 / 40%);transition:transform .45s cubic-bezier(.34,1.56,.64,1)}.switch[aria-checked="true"] .track{background:linear-gradient(135deg,#7fe9c3,#6ec3ff)}.switch[aria-checked="true"] .track span{transform:translateX(14px)}.footer button{flex:1}.panel p{margin:8px 0;overflow-wrap:anywhere;color:rgb(226 233 247 / 74%)}.row{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}button,select,textarea{font:inherit;color:inherit;border:1px solid rgb(255 255 255 / 12%);background:rgb(255 255 255 / 8%);border-radius:12px;padding:8px 12px}button{cursor:pointer;border-radius:999px;transition:background .2s,transform .4s cubic-bezier(.34,1.56,.64,1)}button:hover{background:rgb(255 255 255 / 16%)}button:active{transform:scale(.95)}select,textarea{background:rgb(0 0 0 / 28%)}select option{background:#141a2a;color:#f3f6fc}button:disabled{opacity:.45;cursor:default;transform:none}button:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #9fd0ff;outline-offset:2px}button[aria-pressed="true"]{background:linear-gradient(180deg,rgb(255 255 255 / 30%),rgb(255 255 255 / 12%));color:#fff;border-color:rgb(255 255 255 / 30%);box-shadow:inset 0 1px 0 rgb(255 255 255 / 50%)}.primary{background:linear-gradient(135deg,#9ad3ff,#c2b1ff);color:#0b1022;font-weight:700;width:100%;border:0;box-shadow:inset 0 1px 0 rgb(255 255 255 / 70%)}.primary:hover{background:linear-gradient(135deg,#aadbff,#cbbcff)}.result{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;padding:10px 12px;border-radius:14px;background:rgb(255 255 255 / 7%);box-shadow:inset 0 0 0 1px rgb(255 255 255 / 10%)}.result:empty{display:none}textarea{width:100%;min-height:82px;resize:vertical}.show{position:fixed;pointer-events:auto;font:12px var(--font);color:#f3f6fc;background:rgb(16 20 36 / 70%);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}.label{font-size:11px}.status{font-size:12px}.status:empty{display:none}select{max-width:100%}@media(prefers-reduced-motion:reduce){*{transition:none!important}}@media(prefers-reduced-transparency:reduce){.trigger,.panel,.show{-webkit-backdrop-filter:none;backdrop-filter:none}}`;
    this.#dock.className = 'dock';
    this.#button.className = 'trigger';
    this.#button.type = 'button';
    this.#button.append(createMark(30), this.#badge);
    // The corner badge shows whether page or video translation is running.
    this.#badge.className = 'badge';
    this.#badge.setAttribute('aria-hidden', 'true');
    this.#badge.append(createCheck(11));
    this.#button.setAttribute('aria-label', this.t('Translation tools'));
    this.#button.setAttribute('aria-haspopup', 'true');
    this.#button.setAttribute('aria-expanded', 'false');
    this.#panel.className = 'panel';
    this.#panel.hidden = true;
    this.#panel.setAttribute('aria-label', this.t('Translation tools'));
    const heading = document.createElement('h2');
    heading.textContent = this.t('Translation tools');
    const destination = document.createElement('p');
    destination.className = 'label destination';
    destination.textContent = `${label} · ${settings.sourceLanguage} → ${settings.targetLanguage}`;
    this.#status.className = 'status';
    this.#status.setAttribute('role', 'status');
    this.#result.className = 'result';
    this.#result.dir = 'auto';
    this.#result.setAttribute('aria-live', 'polite');
    this.#panel.append(heading, destination);
    // One page action at a time: translate, or restore once translated.
    this.#translate = this.button('Translate visible page', () => {
      this.startPage();
      this.#paintState();
    });
    this.#translate.className = 'primary';
    this.#translate.disabled = !prefs.page;
    this.#restore = this.button('Restore original page', () => {
      this.#page.restore();
      this.state = 'ready';
      this.#paintState();
    });
    this.#restore.className = 'wide';
    this.#panel.append(this.#translate, this.#restore);
    if (prefs.captions) {
      this.#captions.type = 'button';
      this.#captions.className = 'switch';
      this.#captions.setAttribute('role', 'switch');
      this.#captions.setAttribute('aria-checked', 'false');
      const name = document.createElement('span');
      name.textContent = this.t('Video subtitles');
      const track = document.createElement('span');
      track.className = 'track';
      track.setAttribute('aria-hidden', 'true');
      track.append(document.createElement('span'));
      this.#captions.append(name, track);
      this.#captions.addEventListener('click', (event) => {
        if (event.isTrusted) void this.toggleCaptions();
      });
      this.#panel.append(this.#captions);
    }
    const textRow = document.createElement('div');
    textRow.className = 'row';
    if (prefs.selection)
      textRow.append(this.button('Translate selection', () => this.selected()));
    if (prefs.input)
      textRow.append(
        this.button('Translate focused field', () => this.field()),
      );
    if (prefs.writing)
      textRow.append(this.button('AI Writing', () => this.writing()));
    if (textRow.childElementCount) this.#panel.append(textRow);
    if (prefs.hover) {
      const hint = document.createElement('p');
      hint.className = 'label';
      hint.textContent = this.t(
        'Hold Alt over text to preview its translation.',
      );
      this.#panel.append(hint);
    }
    this.#draft.placeholder = this.t(
      'Text or writing brief — sent only when you click Generate',
    );
    this.#draft.setAttribute('aria-label', this.t('Writing text'));
    this.#draft.maxLength = 1000;
    this.#draft.hidden = !prefs.writing;
    this.#style.setAttribute('aria-label', this.t('Writing style'));
    this.#style.hidden = !prefs.writing;
    for (const value of ['polish', 'concise', 'formal', 'draft'] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = this.t(
        {
          polish: 'Improve writing',
          concise: 'Shorten',
          formal: 'Formal tone',
          draft: 'Draft from brief',
        }[value],
      );
      this.#style.append(option);
    }
    const generate = this.button('Generate preview', () => this.writing());
    generate.hidden = !prefs.writing;
    generate.disabled = !ai;
    this.#apply = this.button('Apply to focused field', () => this.apply());
    this.#apply.disabled = true;
    this.#apply.hidden = !prefs.input && !prefs.writing;
    const writingTitle = document.createElement('summary');
    writingTitle.textContent = this.t('Writing options');
    this.#writingPanel.hidden = !prefs.writing;
    this.#writingPanel.append(writingTitle, this.#draft, this.#style, generate);
    this.#panel.append(
      this.#writingPanel,
      this.#status,
      this.#result,
      this.#apply,
    );
    const footer = document.createElement('div');
    footer.className = 'row footer';
    footer.append(
      this.button('Open settings', async () => {
        await sendRequest({ type: 'page.open-settings', sessionId });
      }),
      this.button('Hide controls', () => {
        this.open(false);
        this.#dock.hidden = true;
        this.#show.hidden = false;
        this.#show.focus();
      }),
    );
    const consent = document.createElement('p');
    consent.className = 'label consent';
    consent.textContent = this.t(
      'Requested text goes to this provider. User-key services may charge.',
    );
    this.#panel.append(footer, consent);
    this.#show.type = 'button';
    this.#show.className = 'show';
    this.#show.textContent = this.t('Show controls');
    this.#show.hidden = true;
    this.#show.addEventListener('click', (event) => {
      if (event.isTrusted) {
        this.#dock.hidden = false;
        this.#show.hidden = true;
        this.#button.focus();
      }
    });
    this.#dock.append(this.#button, this.#panel);
    this.#shadow.append(css, this.#dock, this.#show);
    if (prefs.captions)
      this.#playerShortcut = new PlayerShortcut({
        t: (text) => this.t(text),
        recipient: `${label} · ${settings.sourceLanguage} → ${settings.targetLanguage}`,
        read: async () => {
          const result = await sendRequest({ type: 'page.menu', sessionId });
          if (result.kind !== 'player-menu') throw new Error('Unavailable');
          return result;
        },
        change: async (change) => {
          const result = await sendRequest(
            'provider' in change
              ? {
                  type: 'page.menu-provider',
                  sessionId,
                  provider: change.provider,
                }
              : 'swap' in change
                ? { type: 'page.menu-swap', sessionId }
                : {
                    type: 'page.menu-language',
                    sessionId,
                    targetLanguage: change.targetLanguage,
                  },
          );
          if (result.kind !== 'player-menu-saved')
            throw new Error('Unavailable');
          if (!this.#closed) await reloadMenu(result.sessionId);
        },
        status: async () => {
          const result = await sendRequest({
            type: 'page.caption-status',
            sessionId,
          });
          return result.kind === 'playback' ? result.state : 'unavailable';
        },
        toggle: async (enabled) => {
          const result = await sendRequest({
            type: 'page.caption-toggle',
            sessionId,
            enabled,
          });
          return result.kind === 'playback' ? result.state : 'unavailable';
        },
        settings: async () => {
          await sendRequest({ type: 'page.open-settings', sessionId });
        },
      });
    this.#button.addEventListener('pointerdown', (event) => {
      if (!event.isTrusted || event.button !== 0) return;
      this.#drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
      this.#button.setPointerCapture(event.pointerId);
    });
    this.#button.addEventListener('pointermove', (event) => {
      const drag = this.#drag;
      if (
        !event.isTrusted ||
        !drag ||
        drag.id !== event.pointerId ||
        !(event.buttons & 1) ||
        (!drag.moved &&
          Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4)
      )
        return;
      drag.moved = true;
      this.#position = {
        side: event.clientX < document.documentElement.clientWidth / 2 ? 0 : 1,
        height: (event.clientY - 29) / Math.max(1, innerHeight - 58),
      };
      this.open(false);
      this.layout();
    });
    this.#button.addEventListener('pointerup', (event) => {
      if (this.#button.hasPointerCapture(event.pointerId))
        this.#button.releasePointerCapture(event.pointerId);
    });
    this.#button.addEventListener('pointercancel', () => {
      this.#drag = undefined;
    });
    // A real click opens or closes the menu; actions run from menu buttons.
    this.#button.addEventListener('click', (event) => {
      if (event.isTrusted && !this.#drag?.moved)
        this.open(Boolean(this.#panel.hidden));
      this.#drag = undefined;
    });
    this.#button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        this.#position.side = event.key === 'ArrowLeft' ? 0 : 1;
        this.layout();
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        this.#position.height += event.key === 'ArrowUp' ? -0.04 : 0.04;
        this.layout();
      }
      if (event.key === 'F2') {
        event.preventDefault();
        this.open(true);
        this.#panel.querySelector('button')?.focus();
      }
    });
    this.#dock.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.#button.focus();
        this.open(false);
      }
    });
    this.#page = new PageText(
      prefs.display,
      (items) => this.request('page', items),
      () => this.cancel(),
      (message) => {
        this.state = this.#page.active ? 'translating' : 'ready';
        this.showStatus(message);
        this.#paintState();
      },
    );
    if (prefs.selection && prefs.autoSelection)
      this.#selectionPopup = new SelectionPopup({
        t: (text) => this.t(text),
        languages: {
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
        },
        recipient: `${label}${ai || label.startsWith('Google Cloud') ? ` · ${this.t('Paid API')}` : label.startsWith('Google ·') ? ` · ${this.t('Experimental')}` : ''}`,
        translate: async (text, languages) => {
          const serial = ++this.#serial;
          const [result] = await this.request(
            'selection',
            [{ id: `selection-${serial}`, revision: serial, text }],
            undefined,
            true,
            languages,
          );
          return result!;
        },
        settings: async () => {
          await sendRequest({ type: 'page.open-settings', sessionId });
        },
      });
    document.addEventListener('focusin', this.#focus, true);
    document.addEventListener('pointerdown', this.#outside, true);
    document.addEventListener('pointerup', this.#select, true);
    document.addEventListener('pointerover', this.#hover, true);
    document.addEventListener('pointerout', this.#hoverOut, true);
    window.addEventListener('resize', this.layout);
    document.addEventListener('fullscreenchange', this.layout);
    this.#expiry = setInterval(() => {
      this.#watchCaptions();
      if (location.href !== this.#url) this.dispose();
      else if (
        Date.now() - this.#started >= 30 * 60_000 &&
        !this.host.dataset.edgeExpired
      ) {
        this.#page.dispose();
        this.#selectionPopup?.dispose();
        this.#epoch++;
        this.#serial++;
        this.#draft.value = '';
        this.#result.textContent = '';
        this.#selection = '';
        this.#fieldResult = '';
        this.#fieldOriginal = '';
        this.#field = null;
        this.#lastHover = '';
        this.#apply.disabled = true;
        this.state = 'ready';
        // The permitted bootstrap replaces this expired session with idle tools.
        // Keep the logo visible while doing so; never resume translation automatically.
        this.host.dataset.edgeExpired = 'true';
        this.showStatus('Open the extension popup to re-enable these tools.');
      }
    }, 1000);
    this.layout();
    this.#paintState();
  }
  private t(text: string) {
    return translate(text, this.settings.uiLanguage);
  }
  private button(label: string, action: () => void | Promise<void>) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = this.t(label);
    button.addEventListener('click', (event) => {
      if (event.isTrusted)
        void Promise.resolve()
          .then(action)
          .catch(() =>
            this.showStatus(
              'Open the extension popup to re-enable these tools.',
            ),
          );
    });
    return button;
  }
  private showStatus(text: string) {
    this.#status.textContent = this.t(text);
  }
  open(value: boolean) {
    if (this.#closed) return;
    const opening = value && Boolean(this.#panel.hidden);
    this.#panel.hidden = !value;
    this.#button.setAttribute('aria-expanded', String(value));
    this.layout();
    if (opening) void this.refreshCaptions();
  }
  #outside = (event: PointerEvent) => {
    if (
      event.isTrusted &&
      !this.#panel.hidden &&
      !event.composedPath().includes(this.host)
    )
      this.open(false);
  };
  #paintState() {
    if (this.#closed) return;
    const translating = this.#page.active;
    this.#translate.hidden = translating;
    this.#restore.hidden = !translating;
    this.#captions.setAttribute('aria-checked', String(this.#captionsOn));
    const active = translating || this.#captionsOn;
    this.#button.dataset.active = String(active);
    this.#button.title = this.t(
      active ? 'Translation is on' : 'Translation is off',
    );
  }
  // Display hint only: the overlay exists while captions run in this document.
  // The menu switch asks the background for the real state when it opens.
  #watchCaptions() {
    if (!this.prefs.captions || this.#pending) return;
    const running = Boolean(
      document.querySelector('subtitle-translator-overlay'),
    );
    if (running !== this.#captionsOn) {
      this.#captionsOn = running;
      this.#paintState();
    }
  }
  private async refreshCaptions() {
    if (!this.prefs.captions || this.#closed) return;
    try {
      const result = await sendRequest({
        type: 'page.caption-status',
        sessionId: this.sessionId,
      });
      if (this.#closed || this.#pending || result.kind !== 'playback') return;
      this.#captionsOn = result.state === 'enabled';
      this.#paintState();
    } catch {
      // Keep the last known state; actions still report their own errors.
    }
  }
  private async toggleCaptions() {
    if (!this.prefs.captions || this.#pending) return;
    const enable = !this.#captionsOn;
    this.#pending++;
    this.#captions.disabled = true;
    try {
      const result = await sendRequest({
        type: 'page.caption-toggle',
        sessionId: this.sessionId,
        enabled: enable,
      });
      if (this.#closed) return;
      const state = result.kind === 'playback' ? result.state : 'unavailable';
      this.#captionsOn = state === 'enabled';
      const messages = {
        enabled: 'Video subtitles started.',
        'no-video': 'No supported video found on this page.',
        'source-required':
          'Confirm the original YouTube caption track in Customize translation.',
        'key-required': 'Add your provider key in settings, then try again.',
        'permission-required':
          'Allow provider access in settings, then try again.',
        'needs-restart':
          'Choose a provider and translated display in the popup first.',
        disabled: enable
          ? 'Video subtitles could not start. Try again from the popup.'
          : 'Video subtitles stopped.',
        unavailable:
          'Video subtitles could not start. Try again from the popup.',
      };
      this.showStatus(messages[state]);
    } catch {
      this.showStatus(
        'Video subtitles could not start. Try again from the popup.',
      );
    } finally {
      this.#pending--;
      this.#captions.disabled = false;
      this.#paintState();
    }
  }
  get placement() {
    return { ...this.#position, hidden: Boolean(this.#dock.hidden) };
  }
  restorePlacement(placement: {
    side: number;
    height: number;
    hidden: boolean;
  }) {
    this.#position = { side: placement.side, height: placement.height };
    this.#dock.hidden = placement.hidden;
    this.#show.hidden = !placement.hidden;
    this.layout();
  }
  openPlayerMenu() {
    this.#playerShortcut?.open(
      'Preferences saved. Turn subtitle translation on to resume.',
    );
  }
  startPage() {
    if (!this.prefs.page || this.#page.active) return;
    this.#page.start();
    this.state = 'translating';
  }
  private cancel() {
    this.#epoch++;
    void sendRequest({ type: 'page.cancel', sessionId: this.sessionId }).catch(
      () => {},
    );
  }
  async request(
    feature: Feature,
    items: { id: string; revision: number; text: string }[],
    style?: WritingStyle,
    automaticSelection = false,
    selectionLanguages?: SelectionLanguages,
  ) {
    if (this.#closed || !this.prefs[feature])
      throw new Error(this.t('This feature is disabled.'));
    if (this.#requests >= 100 || this.#pending >= 2)
      throw new Error(this.t('Local request limit reached. Try again later.'));
    const epoch = this.#epoch;
    this.#requests++;
    this.#pending++;
    try {
      const result = await sendRequest({
        type: 'page.translate',
        sessionId: this.sessionId,
        feature,
        ...(automaticSelection ? { automaticSelection: true as const } : {}),
        ...(selectionLanguages ? { selectionLanguages } : {}),
        ...(style ? { style } : {}),
        job: {
          jobId: crypto.randomUUID(),
          generation: epoch,
          priority: feature === 'page' ? 'prefetch' : 'current',
          items,
        },
      });
      if (this.#closed || epoch !== this.#epoch)
        throw new Error(this.t('Translation cancelled.'));
      if (result.kind !== 'translation' || !result.result.ok)
        throw new Error(
          result.kind === 'translation' && !result.result.ok
            ? this.t(TRANSLATION_MESSAGES[result.result.error])
                .replaceAll('captions', 'text')
                .replaceAll('altyazı', 'metin')
            : this.t('Translation unavailable.'),
        );
      if (
        result.result.generation !== epoch ||
        result.result.items.length !== items.length ||
        result.result.items.some(
          (item, i) =>
            item.id !== items[i]!.id || item.revision !== items[i]!.revision,
        )
      )
        throw new Error(this.t('Translation unavailable.'));
      return result.result.items.map((item) => item.text);
    } finally {
      this.#pending--;
    }
  }
  private async preview(feature: Feature, text: string, style?: WritingStyle) {
    this.open(true);
    this.#apply.disabled = true;
    this.#result.textContent = '';
    if (!text.trim() || text.length > 1000) {
      this.showStatus('Select or enter up to 1,000 characters.');
      return '';
    }
    this.showStatus('Preparing preview…');
    const serial = ++this.#serial;
    try {
      const [result] = await this.request(
        feature,
        [{ id: `text-${serial}`, revision: serial, text }],
        style,
      );
      if (serial !== this.#serial || this.#closed) return '';
      this.#result.textContent = result!;
      this.showStatus('Preview ready. No form was submitted.');
      return result!;
    } catch (error) {
      if (serial === this.#serial)
        this.showStatus(
          error instanceof Error ? error.message : 'Translation unavailable.',
        );
      return '';
    }
  }
  #focus = (event: FocusEvent) => {
    if (event.isTrusted && isField(event.target)) {
      if (event.target !== this.#field) {
        this.#serial++;
        this.#fieldResult = '';
        this.#apply.disabled = true;
      }
      this.#field = event.target;
    }
  };
  #select = (event: PointerEvent) => {
    if (!this.prefs.selection) return;
    if (!event.isTrusted || this.host.contains(event.target as Node)) return;
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const text = selection.toString();
    const range = selection.getRangeAt(0);
    const parent =
      range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    if (
      !parent ||
      parent.getRootNode() !== document ||
      parent.closest(EXCLUDED) ||
      text.length > 1000
    ) {
      this.#selection = '';
      return;
    }
    if (
      [...parent.querySelectorAll(EXCLUDED)].some((node) =>
        range.intersectsNode(node),
      )
    ) {
      this.#selection = '';
      return;
    }
    this.#selection = text;
  };
  private async selected() {
    if (this.prefs.selection) await this.preview('selection', this.#selection);
  }
  private async field() {
    const field = this.#field;
    if (!this.prefs.input || !isField(field) || !field.isConnected) {
      this.open(true);
      this.showStatus(
        'Focus a plain text field first. Sensitive fields are excluded.',
      );
      return;
    }
    const original = field.value;
    const result = await this.preview('input', original);
    if (result && this.#field === field && field.value === original) {
      this.#fieldOriginal = original;
      this.#fieldResult = result;
      this.#apply.disabled = false;
    }
  }
  private async writing() {
    if (!this.prefs.writing) return;
    this.#writingPanel.open = true;
    if (!this.ai) {
      this.open(true);
      this.showStatus(
        'Choose an AI provider in the extension popup for writing.',
      );
      return;
    }
    const field = this.#field;
    const original = isField(field) && field.isConnected ? field.value : '';
    if (!this.#draft.value) this.#draft.value = original.slice(0, 1000);
    const result = await this.preview(
      'writing',
      this.#draft.value,
      this.#style.value as WritingStyle,
    );
    if (
      result &&
      isField(field) &&
      field.isConnected &&
      this.#field === field &&
      field.value === original
    ) {
      this.#fieldOriginal = original;
      this.#fieldResult = result;
      this.#apply.disabled = false;
    }
  }
  private apply() {
    const field = this.#field;
    if (
      !isField(field) ||
      !field.isConnected ||
      field.value !== this.#fieldOriginal ||
      !this.#fieldResult
    ) {
      this.#apply.disabled = true;
      this.showStatus('The field changed. Generate a fresh preview.');
      return;
    }
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
      field,
      this.#fieldResult,
    );
    field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    this.#apply.disabled = true;
    this.showStatus('Applied to the field. Review before sending.');
  }
  #hover = (event: PointerEvent) => {
    clearTimeout(this.#hoverTimer);
    if (
      !event.isTrusted ||
      !this.prefs.hover ||
      !event.altKey ||
      !(event.target instanceof Element) ||
      event.target.closest(EXCLUDED)
    )
      return;
    const target = event.target;
    const text = [...target.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join('')
      .trim();
    if (
      !text ||
      text.length > 1000 ||
      text === this.#lastHover ||
      !target.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    )
      return;
    this.#hoverTimer = setTimeout(() => {
      this.#lastHover = text;
      void this.preview('hover', text);
    }, 650);
  };
  #hoverOut = () => clearTimeout(this.#hoverTimer);
  layout = () => {
    if (this.#closed) return;
    const fullscreen = document.fullscreenElement;
    const parent =
      fullscreen && !(fullscreen instanceof HTMLVideoElement)
        ? fullscreen
        : document.documentElement;
    if (this.host.parentElement !== parent) parent.append(this.host);
    this.host.style.display =
      fullscreen instanceof HTMLVideoElement ? 'none' : 'block';
    const width = document.documentElement.clientWidth,
      height = innerHeight;
    this.#position.height = Math.min(1, Math.max(0, this.#position.height));
    const x = this.#position.side ? Math.max(6, width - 52) : 6,
      y = 6 + this.#position.height * Math.max(0, height - 58);
    Object.assign(this.#dock.style, { left: `${x}px`, top: `${y}px` });
    Object.assign(this.#show.style, {
      left: this.#position.side ? 'auto' : '6px',
      right: this.#position.side ? '6px' : 'auto',
      top: `${y}px`,
    });
    const panelWidth = Math.min(320, width - 24);
    const above = y > height / 2;
    Object.assign(this.#panel.style, {
      width: `${panelWidth}px`,
      left: `${Math.max(12, Math.min(x, width - panelWidth - 12)) - x}px`,
      top: above ? 'auto' : '54px',
      bottom: above ? '54px' : 'auto',
      maxHeight: `${Math.max(100, above ? y - 12 : height - y - 66)}px`,
    });
  };
  dispose() {
    if (this.#closed) return;
    this.#closed = true;
    this.#serial++;
    this.#page.dispose();
    this.#playerShortcut?.dispose();
    this.#selectionPopup?.dispose();
    clearInterval(this.#expiry);
    clearTimeout(this.#hoverTimer);
    document.removeEventListener('focusin', this.#focus, true);
    document.removeEventListener('pointerdown', this.#outside, true);
    document.removeEventListener('pointerup', this.#select, true);
    document.removeEventListener('pointerover', this.#hover, true);
    document.removeEventListener('pointerout', this.#hoverOut, true);
    window.removeEventListener('resize', this.layout);
    document.removeEventListener('fullscreenchange', this.layout);
    this.host.remove();
    this.state = 'off';
  }
}
