import type { Settings } from '../messaging/protocol.ts';
import { translate, type Locale } from '../ui/strings.ts';
export type Appearance = Pick<
  Settings,
  'displayMode' | 'fontSize' | 'contrast' | 'position'
>;
export class CaptionOverlay {
  readonly host = document.createElement('subtitle-translator-overlay');
  #caption = document.createElement('div');
  #label = document.createElement('div');
  #status = document.createElement('div');
  #wrap = document.createElement('div');
  #toolbar = document.createElement('div');
  #video: HTMLVideoElement;
  #text = '';
  #labelText = '';
  #statusText = '';
  #locale: Locale = 'en';
  #settings: Appearance;
  #mode = document.createElement('select');
  #labels: [Element, string][] = [];
  #buttons: [HTMLButtonElement, string][] = [];
  constructor(
    video: HTMLVideoElement,
    fontSize: number,
    label: string,
    options?: {
      settings: Settings;
      change: (appearance: Appearance) => void;
      disable: () => void;
    },
  ) {
    this.#video = video;
    this.#settings = options?.settings ?? {
      fontSize,
      displayMode: 'bilingual',
      contrast: 'glass',
      position: 'bottom',
    };
    this.#locale = options?.settings.uiLanguage ?? 'en';
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host { all:initial; position:fixed; display:block; pointer-events:none; z-index:2147483647; --size:24px; --caption-bg:#080d16eb; }
      *{box-sizing:border-box}.wrap{display:flex;flex-direction:column;align-items:center;justify-content:end;height:100%;padding:16px 5% 58px;gap:6px}
      .wrap.top{justify-content:start;padding-top:24px}.caption{white-space:pre-line;overflow-wrap:anywhere;unicode-bidi:plaintext;text-align:center;color:#fff;background:var(--caption-bg);border:1px solid #ffffff40;border-radius:12px;padding:8px 16px;font:600 var(--size)/1.4 system-ui,sans-serif;max-width:100%;max-height:65%;overflow:hidden;text-shadow:0 2px 4px #000}
      .caption:empty,.label:empty{display:none}.label{font:600 11px/1.5 system-ui,sans-serif;color:#e2e8ff;background:#10172ff2;border-radius:6px;padding:3px 8px;max-width:100%;overflow-wrap:anywhere}
      .controls{pointer-events:auto;display:flex;flex-wrap:wrap;gap:5px;align-items:center;justify-content:center;padding:5px;border:1px solid #ffffff50;border-radius:12px;background:#0b1427f2;opacity:.15;transition:opacity .15s;max-width:100%}
      .controls:hover,.controls:focus-within{opacity:1}button,select{font:500 12px system-ui,sans-serif;color:#fff;background:#25334b;border:1px solid #95abd080;border-radius:7px;min-height:32px;padding:5px 8px;cursor:pointer}button:focus-visible,select:focus-visible{outline:3px solid #b0d6ff;outline-offset:2px}select{max-width:180px}button:disabled{opacity:.4;cursor:default}@media(prefers-reduced-motion:reduce){.controls{transition:none}}`;
    this.#wrap.className = 'wrap';
    this.#caption.className = 'caption';
    this.#caption.dir = 'auto';
    this.#label.className = 'label';
    this.#labelText = label;
    this.#label.textContent = label;
    this.#status.className = 'label provider-status';
    this.#status.setAttribute('role', 'status');
    this.#toolbar.className = 'controls';
    this.#toolbar.setAttribute('role', 'group');
    if (options) {
      const change = (patch: Partial<Appearance>) => {
        const next = { ...this.#settings, ...patch };
        this.appearance({
          ...options.settings,
          ...next,
          uiLanguage: this.#locale,
        });
        options.change(next);
      };
      for (const [value, text] of [
        ['bilingual', 'Original and translation'],
        ['translated', 'Translation only'],
        ['original', 'Original only'],
      ]) {
        const option = document.createElement('option');
        option.value = value!;
        option.textContent = text!;
        this.#labels.push([option, text!]);
        this.#mode.append(option);
      }
      this.#mode.addEventListener('change', () => {
        const value = this.#mode.value;
        if (
          value === 'bilingual' ||
          value === 'translated' ||
          value === 'original'
        )
          change({ displayMode: value });
      });
      this.#toolbar.append(this.#mode);
      const button = (text: string, name: string, action: () => void) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.addEventListener('click', action);
        this.#buttons.push([b, name]);
        this.#toolbar.append(b);
      };
      button('A−', 'Smaller text', () =>
        change({ fontSize: Math.max(16, this.#settings.fontSize - 2) }),
      );
      button('A+', 'Larger text', () =>
        change({ fontSize: Math.min(48, this.#settings.fontSize + 2) }),
      );
      button('◐', 'Toggle contrast', () =>
        change({
          contrast: this.#settings.contrast === 'solid' ? 'glass' : 'solid',
        }),
      );
      button('↕', 'Move captions', () =>
        change({
          position: this.#settings.position === 'top' ? 'bottom' : 'top',
        }),
      );
      button('×', 'Disable captions', options.disable);
    }
    this.#wrap.append(this.#label, this.#status, this.#caption);
    if (options) this.#wrap.append(this.#toolbar);
    shadow.append(style, this.#wrap);
    if (options) this.appearance(options.settings);
    else this.host.style.setProperty('--size', `${fontSize}px`);
    this.layout();
  }
  appearance(settings: Settings) {
    this.#settings = {
      displayMode: settings.displayMode,
      fontSize: settings.fontSize,
      contrast: settings.contrast,
      position: settings.position,
    };
    this.#locale = settings.uiLanguage;
    this.host.style.setProperty('--size', `${settings.fontSize}px`);
    this.host.style.setProperty(
      '--caption-bg',
      settings.contrast === 'solid' ? '#000' : '#080d16eb',
    );
    this.#wrap.classList.toggle('top', settings.position === 'top');
    this.#mode.value = settings.displayMode;
    this.#mode.setAttribute(
      'aria-label',
      translate('Display mode', this.#locale),
    );
    this.#toolbar.setAttribute(
      'aria-label',
      translate('Caption controls', this.#locale),
    );
    for (const [node, text] of this.#labels)
      node.textContent = translate(text, this.#locale);
    for (const [node, text] of this.#buttons) {
      node.setAttribute('aria-label', translate(text, this.#locale));
      node.title = translate(text, this.#locale);
    }
    this.#toolbar.lang = this.#locale;
    this.setLabel(this.#labelText);
    this.setTranslationStatus(this.#statusText);
  }
  layout() {
    const fullscreen = document.fullscreenElement;
    const unsupported =
      fullscreen === this.#video ||
      (fullscreen !== null && !fullscreen.contains(this.#video));
    const parent =
      !unsupported && fullscreen ? fullscreen : document.documentElement;
    if (this.host.parentElement !== parent) parent.append(this.host);
    const rect = this.#video.getBoundingClientRect();
    Object.assign(this.host.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      display: unsupported || !rect.width || !rect.height ? 'none' : 'block',
    });
  }
  render(text: string) {
    if (text !== this.#text) {
      this.#caption.textContent = text;
      this.#text = text;
    }
  }
  setLabel(text: string) {
    this.#labelText = text;
    const rendered = translate(text, this.#locale);
    if (this.#label.textContent !== rendered)
      this.#label.textContent = rendered;
  }
  setTranslationStatus(text: string) {
    this.#statusText = text;
    const rendered = translate(text, this.#locale);
    if (this.#status.textContent !== rendered)
      this.#status.textContent = rendered;
  }
  dispose() {
    this.host.remove();
  }
}
