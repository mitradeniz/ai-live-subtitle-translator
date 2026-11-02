import { SelectionPopup } from './selection-popup';
import {
  EdgeSettings,
  EDGE_SETTINGS_CSS,
  type HideScope,
} from './edge-settings';
import { PageText, EXCLUDED } from './dom';
import { PlayerShortcut } from '../playback/shortcut';
import type { PagePreferences, PageState, WritingStyle } from './contracts';
import type { Settings, SelectionLanguages } from '../messaging/protocol';
import { sendRequest } from '../messaging/client';
import { translate } from '../ui/strings';
import { createCheck, createIcon, createMark } from '../ui/mark';
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
  #status = document.createElement('p');
  #result = document.createElement('div');
  #draft = document.createElement('textarea');
  #writingPanel = document.createElement('details');
  #style = document.createElement('select');
  #apply: HTMLButtonElement;
  #captions = document.createElement('button');
  #badge = document.createElement('span');
  #tip = document.createElement('span');
  #tipAction = document.createElement('span');
  #tipNote = document.createElement('small');
  #more = document.createElement('button');
  #edgeSettings: EdgeSettings;
  #selectionButton: HTMLButtonElement | undefined;
  #createSelection: () => SelectionPopup;
  #flashTimer: ReturnType<typeof setTimeout> | undefined;
  #noteTimer: ReturnType<typeof setTimeout> | undefined;
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
    reloadMenu: (sessionId: string, resume?: boolean) => Promise<void>,
    // Receives the position and hidden state when these tools close.
    private remember: (placement: PageTools['placement']) => void = () => {},
  ) {
    this.sessionId = sessionId;
    this.prefs = prefs;
    this.settings = settings;
    this.ai = ai;
    const css = document.createElement('style');
    css.textContent = `:host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;color-scheme:dark;--font:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}*{box-sizing:border-box}[hidden]{display:none!important}.dock{position:fixed;pointer-events:auto;font:13px/1.5 var(--font);color:#f3f6fc}.trigger{display:grid;place-items:center;width:38px;height:38px;padding:0;white-space:nowrap;border:0;border-radius:13px;touch-action:none;cursor:grab;background:linear-gradient(180deg,rgb(255 255 255 / 20%),rgb(255 255 255 / 5%)),rgb(16 20 36 / 66%);-webkit-backdrop-filter:blur(16px) saturate(170%);backdrop-filter:blur(16px) saturate(170%);box-shadow:inset 0 1px 0 rgb(255 255 255 / 50%),inset 0 0 0 1px rgb(255 255 255 / 14%),0 12px 28px -10px rgb(0 0 0 / 60%)}.trigger{position:relative}.trigger>svg{width:24px;height:24px;pointer-events:none}.badge{position:absolute;top:-2px;right:-2px;display:grid;place-items:center;width:7px;height:7px;border-radius:50%;background:rgb(139 147 167 / 55%);box-shadow:0 0 0 1.5px rgb(16 20 36 / 80%);transition:width .3s cubic-bezier(.34,1.56,.64,1),height .3s cubic-bezier(.34,1.56,.64,1),background .3s}.badge svg{width:8px;height:8px;opacity:0;transition:opacity .2s}.trigger[data-active="true"] .badge{width:12px;height:12px;background:rgb(127 233 195 / 72%);color:rgb(6 35 26 / 85%)}.trigger[data-active="true"] .badge svg{opacity:1}.trigger:hover{background:linear-gradient(180deg,rgb(255 255 255 / 28%),rgb(255 255 255 / 9%)),rgb(16 20 36 / 72%)}.trigger:active{transform:none}.panel,.sheet{position:absolute;width:320px;max-width:calc(100vw - 24px);padding:16px;border:1px solid rgb(255 255 255 / 16%);border-radius:24px;background:linear-gradient(180deg,rgb(34 42 66 / 86%),rgb(14 18 32 / 92%));box-shadow:inset 0 1px 0 rgb(255 255 255 / 24%),0 24px 50px -16px rgb(0 0 0 / 65%);-webkit-backdrop-filter:blur(24px) saturate(170%);backdrop-filter:blur(24px) saturate(170%);overflow:auto}.panel,.sheet{display:flex;flex-direction:column;gap:8px}.panel h2,.sheet h2{margin:0;font-size:16px;font-weight:650;letter-spacing:-.01em}.panel .destination{margin:-4px 0 4px;color:rgb(226 233 247 / 70%)}.panel .consent{margin:0;color:rgb(226 233 247 / 56%)}.panel .row{margin:0}.wide{width:100%}.switch{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:10px 14px;border-radius:16px}.switch .track{flex:none;width:34px;height:20px;padding:2px;border-radius:999px;background:rgb(255 255 255 / 16%);box-shadow:inset 0 1px 2px rgb(0 0 0 / 40%);transition:background .3s}.switch .track span{display:block;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgb(0 0 0 / 40%);transition:transform .45s cubic-bezier(.34,1.56,.64,1)}.switch[aria-checked="true"] .track{background:linear-gradient(135deg,#7fe9c3,#6ec3ff)}.switch[aria-checked="true"] .track span{transform:translateX(14px)}.footer button{flex:1}.panel p,.sheet p{margin:8px 0;overflow-wrap:anywhere;color:rgb(226 233 247 / 74%)}.row{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}button,select,textarea{font:inherit;color:inherit;border:1px solid rgb(255 255 255 / 12%);background:rgb(255 255 255 / 8%);border-radius:12px;padding:8px 12px}button{cursor:pointer;border-radius:999px;transition:background .2s,transform .4s cubic-bezier(.34,1.56,.64,1)}button:hover{background:rgb(255 255 255 / 16%)}button:active{transform:scale(.95)}select,textarea{background:rgb(0 0 0 / 28%)}select option{background:#141a2a;color:#f3f6fc}button:disabled{opacity:.45;cursor:default;transform:none}button:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #9fd0ff;outline-offset:2px}button[aria-pressed="true"]{background:linear-gradient(180deg,rgb(255 255 255 / 30%),rgb(255 255 255 / 12%));color:#fff;border-color:rgb(255 255 255 / 30%);box-shadow:inset 0 1px 0 rgb(255 255 255 / 50%)}.primary{background:linear-gradient(135deg,#9ad3ff,#c2b1ff);color:#0b1022;font-weight:700;width:100%;border:0;box-shadow:inset 0 1px 0 rgb(255 255 255 / 70%)}.primary:hover{background:linear-gradient(135deg,#aadbff,#cbbcff)}.result{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;padding:10px 12px;border-radius:14px;background:rgb(255 255 255 / 7%);box-shadow:inset 0 0 0 1px rgb(255 255 255 / 10%)}.result:empty{display:none}textarea{width:100%;min-height:82px;resize:vertical}.label{font-size:11px}.status{font-size:12px}.status:empty{display:none}select{max-width:100%}@media(prefers-reduced-motion:reduce){*{transition:none!important}}@media(prefers-reduced-transparency:reduce){.trigger,.panel,.sheet{-webkit-backdrop-filter:none;backdrop-filter:none}}.tip{position:absolute;top:19px;right:calc(100% + 10px);transform:translateY(-50%);display:flex;flex-direction:column;gap:2px;max-width:min(320px,calc(100vw - 80px));padding:7px 12px;border-radius:12px;background:rgb(10 12 22 / 88%);box-shadow:0 10px 24px -10px rgb(0 0 0 / 70%);font:13px/1.35 var(--font);white-space:nowrap;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .15s,visibility 0s .15s}.tip small{font-size:11px;color:rgb(226 233 247 / 66%);white-space:normal}.tip small:empty{display:none}.dock[data-side="0"] .tip{right:auto;left:calc(100% + 10px)}.trigger:hover+.tip,.trigger:focus-visible+.tip,.tip[data-flash="true"]{opacity:1;visibility:visible;transition-delay:0s}.dock[data-open="true"] .tip{display:none}.hover-only{opacity:0;visibility:hidden;transition:opacity .15s .25s,visibility 0s .4s}.dock:hover .hover-only,.dock:has(:focus-visible) .hover-only{opacity:1;visibility:visible;transition-delay:0s}.dock[data-open="true"] .hover-only{display:none}.extras{position:absolute;top:44px;left:5px;display:flex;flex-direction:column;gap:6px}.dock[data-up="true"] .extras{top:auto;bottom:44px;flex-direction:column-reverse}.mini{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:50%;color:#dfe7f7;background:linear-gradient(180deg,rgb(255 255 255 / 16%),rgb(255 255 255 / 4%)),rgb(16 20 36 / 72%);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);box-shadow:inset 0 1px 0 rgb(255 255 255 / 35%),inset 0 0 0 1px rgb(255 255 255 / 12%)}.mini:hover{background:linear-gradient(180deg,rgb(255 255 255 / 26%),rgb(255 255 255 / 8%)),rgb(16 20 36 / 80%)}.close{position:absolute;bottom:-5px;left:-7px;width:18px;height:18px}.dock[data-side="0"] .close{left:auto;right:-7px}.close svg{width:10px;height:10px}.dock[data-compact="true"] .trigger{width:28px;height:28px;border-radius:10px;opacity:.85;transition:transform .3s cubic-bezier(.34,1.56,.64,1),opacity .2s}.dock[data-compact="true"] .trigger>svg{width:18px;height:18px}.dock[data-compact="true"][data-side="1"] .trigger{transform:translateX(12px)}.dock[data-compact="true"][data-side="0"] .trigger{transform:translateX(-12px)}.dock[data-compact="true"]:hover .trigger,.dock[data-compact="true"] .trigger:focus-visible,.dock[data-compact="true"][data-open="true"] .trigger{transform:none;opacity:1}.dock[data-compact="true"] .tip{top:14px}.dock[data-compact="true"] .extras{top:34px;left:0}.dock[data-compact="true"][data-up="true"] .extras{top:auto;bottom:34px}${EDGE_SETTINGS_CSS}`;
    this.#dock.className = 'dock';
    this.#button.className = 'trigger';
    this.#button.type = 'button';
    this.#button.append(createMark(24), this.#badge);
    // A click turns translation on or off; the corner badge shows which.
    this.#badge.className = 'badge';
    this.#badge.setAttribute('aria-hidden', 'true');
    this.#badge.append(createCheck(8));
    this.#button.setAttribute('aria-pressed', 'false');
    this.#tip.className = 'tip';
    this.#tip.setAttribute('aria-hidden', 'true');
    this.#tip.append(this.#tipAction, this.#tipNote);
    // Hover shows two small helpers: more options and hide.
    this.#more.type = 'button';
    this.#more.className = 'mini';
    this.#more.append(createIcon('sliders', 15));
    this.#more.title = this.t('More options');
    this.#more.setAttribute('aria-label', this.t('More options'));
    this.#more.setAttribute('aria-haspopup', 'true');
    this.#more.setAttribute('aria-expanded', 'false');
    this.#more.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      const opening = Boolean(this.#panel.hidden);
      this.open(opening);
      if (opening) this.#panel.querySelector('button')?.focus();
    });
    const extras = document.createElement('div');
    extras.className = 'extras hover-only';
    extras.append(this.#more);
    const hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'mini close hover-only';
    hide.append(createIcon('close', 10));
    hide.title = this.t('Edge button settings');
    hide.setAttribute('aria-label', this.t('Edge button settings'));
    hide.setAttribute('aria-haspopup', 'dialog');
    hide.addEventListener('click', (event) => {
      if (event.isTrusted) this.#openSettings(true);
    });
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
    this.#selectionButton = this.button('Translate selection', () =>
      this.selected(),
    );
    this.#selectionButton.hidden = !prefs.selection;
    textRow.append(this.#selectionButton);
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
      this.button('Hide controls', () => this.#openSettings(true)),
    );
    const consent = document.createElement('p');
    consent.className = 'label consent';
    consent.textContent = this.t(
      'Requested text goes to this provider. User-key services may charge.',
    );
    this.#panel.append(footer, consent);
    this.#edgeSettings = new EdgeSettings({
      t: (text) => this.t(text),
      compact: prefs.compactEdge,
      selection: prefs.selection,
      setCompact: async (value) => {
        this.#dock.dataset.compact = String(value);
        this.layout();
        try {
          await this.#savePreferences({ compactEdge: value });
        } catch (error) {
          this.#dock.dataset.compact = String(!value);
          this.layout();
          throw error;
        }
      },
      setSelection: async (value) => {
        await this.#savePreferences({ selection: value });
        this.prefs = {
          ...this.prefs,
          selection: value,
          autoSelection: value && this.prefs.autoSelection,
        };
        this.#selectionPopup?.dispose();
        this.#selectionPopup = value ? this.#createSelection() : undefined;
        if (this.#selectionButton) this.#selectionButton.hidden = !value;
      },
      hide: (scope) => this.#hide(scope),
      settings: async () => {
        await sendRequest({ type: 'page.open-settings', sessionId });
      },
      close: () => {
        this.#openSettings(false);
        this.#button.focus();
      },
    });
    this.#dock.dataset.compact = String(prefs.compactEdge);
    this.#dock.append(
      this.#button,
      this.#tip,
      hide,
      extras,
      this.#panel,
      this.#edgeSettings.element,
    );
    this.#shadow.append(css, this.#dock);
    if (prefs.captions)
      this.#playerShortcut = new PlayerShortcut({
        t: (text) => this.t(text),
        recipient: `${label} · ${settings.sourceLanguage} → ${settings.targetLanguage}`,
        read: async () => {
          const result = await sendRequest({ type: 'page.menu', sessionId });
          if (result.kind !== 'player-menu') throw new Error('Unavailable');
          return result;
        },
        change: async (change, resume) => {
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
          if (!this.#closed) await reloadMenu(result.sessionId, resume);
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
        height: (event.clientY - 25) / Math.max(1, innerHeight - 50),
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
    // A real click turns translation on or off. More options sit on hover.
    this.#button.addEventListener('click', (event) => {
      if (event.isTrusted && !this.#drag?.moved) void this.#toggle();
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
        this.#openSettings(false);
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
    this.#createSelection = () =>
      new SelectionPopup({
        mode: this.prefs.autoSelection ? 'auto' : 'click',
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
            this.prefs.autoSelection,
            languages,
          );
          return result!;
        },
        settings: async () => {
          await sendRequest({ type: 'page.open-settings', sessionId });
        },
      });
    if (prefs.selection) this.#selectionPopup = this.#createSelection();
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
        // The player menu shares this session; remove it rather than leave
        // controls that can no longer load or save anything.
        this.#playerShortcut?.dispose();
        this.#playerShortcut = undefined;
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
    // With the menu closed, the latest status appears briefly beside the button.
    clearTimeout(this.#noteTimer);
    clearTimeout(this.#flashTimer);
    if (!this.#panel.hidden) return;
    this.#tipNote.textContent = this.t(text);
    this.#noteTimer = setTimeout(() => (this.#tipNote.textContent = ''), 6000);
    if (!this.#dock.hidden) {
      this.#tip.dataset.flash = 'true';
      this.#flashTimer = setTimeout(() => delete this.#tip.dataset.flash, 2500);
    }
  }
  open(value: boolean) {
    if (this.#closed) return;
    const opening = value && Boolean(this.#panel.hidden);
    if (value) this.#edgeSettings.element.hidden = true;
    this.#panel.hidden = !value;
    this.#dock.dataset.open = String(value);
    if (value) {
      delete this.#tip.dataset.flash;
      this.#tipNote.textContent = '';
    }
    this.#more.setAttribute('aria-expanded', String(value));
    this.layout();
    if (opening) void this.refreshCaptions();
  }
  #openSettings(value: boolean) {
    if (this.#closed) return;
    if (value) {
      this.open(false);
      this.#edgeSettings.reset();
    }
    this.#edgeSettings.element.hidden = !value;
    this.#dock.dataset.open = String(value);
    if (value) delete this.#tip.dataset.flash;
    this.layout();
    if (value) this.#edgeSettings.focus();
  }
  async #savePreferences(patch: {
    compactEdge?: boolean;
    selection?: boolean;
  }) {
    const result = await sendRequest({
      type: 'page.edge-preferences',
      sessionId: this.sessionId,
      ...patch,
    });
    if (result.kind !== 'page-preferences') throw new Error('Unavailable');
  }
  // 'once' hides the button until this page loads again. 'site' and 'all'
  // also save the choice; the popup can show the button again.
  async #hide(scope: HideScope) {
    if (scope !== 'once') {
      const result = await sendRequest({
        type: 'page.edge-hide',
        sessionId: this.sessionId,
        scope,
      });
      if (result.kind !== 'saved') throw new Error('Unavailable');
    }
    if (this.#closed) return;
    this.open(false);
    this.#openSettings(false);
    this.#dock.hidden = true;
  }
  // Page translation when that tool is on, otherwise video subtitles.
  #target(): 'page' | 'captions' | null {
    return this.prefs.page ? 'page' : this.prefs.captions ? 'captions' : null;
  }
  async #toggle() {
    if (this.#closed) return;
    const target = this.#target();
    this.open(false);
    if (!this.#edgeSettings.element.hidden) this.#openSettings(false);
    if (target === 'page') {
      if (this.#page.active) {
        this.#page.restore();
        this.state = 'ready';
      } else this.startPage();
      this.#paintState();
    } else if (target === 'captions') await this.toggleCaptions();
    else this.open(true);
  }
  #outside = (event: PointerEvent) => {
    if (
      event.isTrusted &&
      (!this.#panel.hidden || !this.#edgeSettings.element.hidden) &&
      !event.composedPath().includes(this.host)
    ) {
      this.open(false);
      this.#openSettings(false);
    }
  };
  #paintState() {
    if (this.#closed) return;
    this.#captions.setAttribute('aria-checked', String(this.#captionsOn));
    const target = this.#target();
    const active =
      target === 'page'
        ? this.#page.active
        : target === 'captions' && this.#captionsOn;
    this.#button.dataset.active = String(active);
    this.#button.setAttribute('aria-pressed', String(active));
    this.#button.setAttribute(
      'aria-label',
      this.t(
        target === 'captions'
          ? 'Video subtitles'
          : target === 'page'
            ? 'Translate this page'
            : 'Translation tools',
      ),
    );
    this.#tipAction.textContent = this.t(
      target === 'captions'
        ? active
          ? 'Turn off video subtitles'
          : 'Turn on video subtitles'
        : target === 'page'
          ? active
            ? 'Show original'
            : 'Translate this page'
          : 'Translation tools',
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
    this.layout();
  }
  openPlayerMenu(resume = false) {
    this.#playerShortcut?.open(
      resume
        ? 'Restarting subtitle translation…'
        : 'Preferences saved. Turn subtitle translation on to resume.',
    );
    // A language or provider change made while subtitles ran continues them.
    if (resume) void this.#playerShortcut?.resume();
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
    // Fullscreen belongs to the content: the edge button and its menu step
    // aside until it ends. The player menu stays in the player controls.
    const fullscreen = Boolean(document.fullscreenElement);
    const parent = document.documentElement;
    if (this.host.parentElement !== parent) parent.append(this.host);
    this.host.style.display = fullscreen ? 'none' : 'block';
    if (fullscreen && !this.#panel.hidden) this.open(false);
    if (fullscreen && !this.#edgeSettings.element.hidden)
      this.#openSettings(false);
    const width = document.documentElement.clientWidth,
      height = innerHeight;
    this.#position.height = Math.min(1, Math.max(0, this.#position.height));
    const compact = this.#dock.dataset.compact === 'true';
    const x = this.#position.side
        ? Math.max(6, width - (compact ? 30 : 44))
        : compact
          ? 2
          : 6,
      y = 6 + this.#position.height * Math.max(0, height - 50);
    Object.assign(this.#dock.style, { left: `${x}px`, top: `${y}px` });
    this.#dock.dataset.side = String(this.#position.side);
    this.#dock.dataset.up = String(y > height - 130);
    const panelWidth = Math.min(320, width - 24);
    const above = y > height / 2;
    for (const panel of [this.#panel, this.#edgeSettings.element])
      Object.assign(panel.style, {
        width: `${panelWidth}px`,
        left: `${Math.max(12, Math.min(x, width - panelWidth - 12)) - x}px`,
        top: above ? 'auto' : '46px',
        bottom: above ? '46px' : 'auto',
        maxHeight: `${Math.max(100, above ? y - 12 : height - y - 58)}px`,
      });
  };
  dispose() {
    if (this.#closed) return;
    this.remember(this.placement);
    this.#closed = true;
    this.#serial++;
    this.#page.dispose();
    this.#playerShortcut?.dispose();
    this.#selectionPopup?.dispose();
    clearInterval(this.#expiry);
    clearTimeout(this.#hoverTimer);
    clearTimeout(this.#flashTimer);
    clearTimeout(this.#noteTimer);
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
