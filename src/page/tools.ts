import { PageText, EXCLUDED } from './dom';
import type { PagePreferences, PageState, WritingStyle } from './contracts';
import type { Settings } from '../messaging/protocol';
import { sendRequest } from '../messaging/client';
import { translate } from '../ui/strings';
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
  #restore: HTMLButtonElement;
  #page: PageText;
  #closed = false;
  #epoch = 0;
  #serial = 0;
  #pending = 0;
  #requests = 0;
  #position = { side: 1, height: 0.22 };
  #drag: { id: number; x: number; y: number; moved: boolean } | undefined;
  #menuTimer: ReturnType<typeof setTimeout> | undefined;
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
  ) {
    this.sessionId = sessionId;
    this.prefs = prefs;
    this.settings = settings;
    this.ai = ai;
    const css = document.createElement('style');
    css.textContent = `:host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;color-scheme:dark}*{box-sizing:border-box}[hidden]{display:none!important}.dock{position:fixed;pointer-events:auto;font:13px/1.5 system-ui,sans-serif;color:#e9efff}.trigger{width:46px;height:46px;padding:0;white-space:nowrap;border-radius:14px;touch-action:none;cursor:grab;font-size:20px;font-weight:700;background:linear-gradient(140deg,#d7e7ff80,#25334be8 55%,#8faef24a);box-shadow:inset 0 1px #fff8,0 6px 22px #0005;backdrop-filter:blur(14px)}.panel{position:absolute;width:320px;max-width:calc(100vw - 24px);padding:16px;border:1px solid #c5dbff40;border-radius:20px;background:linear-gradient(140deg,#1e2b42f7,#0b101cf9);box-shadow:0 18px 50px #0006;backdrop-filter:blur(20px);overflow:auto}.panel h2{margin:0 0 8px;font-size:17px}.panel p{margin:8px 0;overflow-wrap:anywhere;color:#bfcee5}.row{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}button,select,textarea{font:inherit;color:inherit;border:1px solid #94afd24a;background:#ffffff0c;border-radius:10px;padding:8px 10px}button{cursor:pointer}button:hover{background:#ffffff20}button:disabled{opacity:.45;cursor:default}button:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #a9c8ff;outline-offset:2px}.primary{background:#bfd2fa;color:#101a2e;font-weight:700;width:100%}.result{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;border-left:2px solid #8faef2;padding:0 8px}.result:empty{display:none}textarea{width:100%;min-height:82px;resize:vertical}.show{position:fixed;pointer-events:auto;font:12px system-ui,sans-serif;color:#e9efff;background:#141e31ed}.label{font-size:11px}.status{font-size:12px}select{max-width:100%}`;
    this.#dock.className = 'dock';
    this.#button.className = 'trigger';
    this.#button.type = 'button';
    this.#button.textContent = 'A文';
    this.#button.setAttribute(
      'aria-label',
      this.t('Translate · hover for tools'),
    );
    this.#button.setAttribute('aria-expanded', 'false');
    this.#panel.className = 'panel';
    this.#panel.hidden = true;
    this.#panel.setAttribute('aria-label', this.t('Translation tools'));
    const heading = document.createElement('h2');
    heading.textContent = this.t('Translation tools');
    const destination = document.createElement('p');
    destination.className = 'label';
    destination.textContent = `${label} · ${settings.sourceLanguage} → ${settings.targetLanguage}`;
    const consent = document.createElement('p');
    consent.className = 'label';
    consent.textContent = this.t(
      'Requested text goes to this provider. User-key services may charge.',
    );
    this.#status.className = 'status';
    this.#status.setAttribute('role', 'status');
    this.#result.className = 'result';
    this.#result.dir = 'auto';
    this.#result.setAttribute('aria-live', 'polite');
    this.#panel.append(heading, destination, consent);
    const main = this.button('Translate visible page', () => this.startPage());
    main.className = 'primary';
    main.disabled = !prefs.page;
    this.#panel.append(main);
    const row = document.createElement('div');
    row.className = 'row';
    this.#restore = this.button('Restore original page', () => {
      this.#page.restore();
      this.state = 'ready';
    });
    row.append(
      this.#restore,
      this.button('Change provider / languages', () => this.popup()),
      this.button('Customize translation', () => this.popup()),
    );
    this.#panel.append(row);
    const display = document.createElement('select');
    display.setAttribute('aria-label', this.t('Page display'));
    for (const [value, label] of [
      ['bilingual', 'Original and translation'],
      ['translated', 'Translation only'],
    ]) {
      const option = document.createElement('option');
      option.value = value!;
      option.textContent = this.t(label!);
      display.append(option);
    }
    display.value = prefs.display;
    display.addEventListener('change', (event) => {
      if (event.isTrusted)
        this.#page.setMode(
          display.value === 'translated' ? 'translated' : 'bilingual',
        );
    });
    this.#panel.append(display);
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
    this.#panel.append(textRow);
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
    footer.className = 'row';
    footer.append(
      this.button('Video controls', () => {
        this.open(false);
        document.dispatchEvent(new Event('subtitle-translator:show-controls'));
      }),
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
    this.#panel.append(footer);
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
    this.#button.addEventListener('click', (event) => {
      if (event.isTrusted && !this.#drag?.moved) {
        clearTimeout(this.#menuTimer);
        this.open(false);
        this.action();
      }
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
    this.#button.addEventListener('focus', () => {
      if (this.#button.matches(':focus-visible')) this.open(true);
    });
    this.#dock.addEventListener('pointerenter', (event) => {
      if (event.isTrusted) {
        clearTimeout(this.#menuTimer);
        this.#menuTimer = setTimeout(() => this.open(true), 220);
      }
    });
    this.#dock.addEventListener('pointerleave', () => {
      clearTimeout(this.#menuTimer);
      this.#menuTimer = setTimeout(() => {
        if (!this.#panel.contains(this.#shadow.activeElement)) this.open(false);
      }, 350);
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
      },
    );
    document.addEventListener('focusin', this.#focus, true);
    document.addEventListener('pointerup', this.#select, true);
    document.addEventListener('pointerover', this.#hover, true);
    document.addEventListener('pointerout', this.#hoverOut, true);
    window.addEventListener('resize', this.layout);
    document.addEventListener('fullscreenchange', this.layout);
    this.#expiry = setInterval(() => {
      if (
        location.href !== this.#url ||
        Date.now() - this.#started >= 30 * 60_000
      )
        this.dispose();
    }, 1000);
    this.layout();
    this.showStatus('Ready. Click the edge button to run your chosen action.');
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
    this.#panel.hidden = !value;
    this.#button.setAttribute('aria-expanded', String(value));
    this.layout();
  }
  private async popup() {
    await sendRequest({ type: 'page.open-popup', sessionId: this.sessionId });
  }
  action() {
    if (this.#closed) return;
    switch (this.prefs.clickAction) {
      case 'page':
        this.startPage();
        break;
      case 'captions':
        void this.startCaptions();
        break;
      case 'selection':
        void this.selected();
        break;
      case 'input':
        void this.field();
        break;
      case 'writing':
        void this.writing();
        break;
    }
  }
  private async startCaptions() {
    if (!this.prefs.captions || this.#pending) return;
    this.#pending++;
    try {
      const result = await sendRequest({
        type: 'page.captions',
        sessionId: this.sessionId,
      });
      if (this.#closed) return;
      const state = result.kind === 'playback' ? result.state : 'unavailable';
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
        disabled: 'Video subtitles could not start. Try again from the popup.',
        unavailable:
          'Video subtitles could not start. Try again from the popup.',
      };
      this.showStatus(messages[state]);
      if (state !== 'enabled') this.open(true);
    } catch {
      this.showStatus(
        'Video subtitles could not start. Try again from the popup.',
      );
      this.open(true);
    } finally {
      this.#pending--;
    }
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
    clearInterval(this.#expiry);
    clearTimeout(this.#hoverTimer);
    clearTimeout(this.#menuTimer);
    document.removeEventListener('focusin', this.#focus, true);
    document.removeEventListener('pointerup', this.#select, true);
    document.removeEventListener('pointerover', this.#hover, true);
    document.removeEventListener('pointerout', this.#hoverOut, true);
    window.removeEventListener('resize', this.layout);
    document.removeEventListener('fullscreenchange', this.layout);
    this.host.remove();
    this.state = 'off';
  }
}
