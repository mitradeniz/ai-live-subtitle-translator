import type { Settings } from '../messaging/protocol.ts';
import { translate, type Locale } from '../ui/strings.ts';
import { createMark } from '../ui/mark.ts';
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
  #dock = document.createElement('div');
  #logo = document.createElement('button');
  #peek = document.createElement('button');
  #position = { x: 1, y: 0.16 };
  #native: HTMLElement | null = null;
  #nativeOpacity = '';
  #nativePriority = '';
  #parts = '';
  #quickRequested = false;
  #menuTimer: ReturnType<typeof setTimeout> | undefined;
  #showControls = () => {
    this.#quickRequested = true;
    this.#toolbar.hidden = false;
    this.#logo.setAttribute('aria-expanded', 'true');
    this.layout();
  };
  #drag: { id: number; x: number; y: number; moved: boolean } | undefined;
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
      openSettings?: () => void;
    },
  ) {
    this.#video = video;
    document.addEventListener(
      'subtitle-translator:show-controls',
      this.#showControls,
    );
    this.#settings = options?.settings ?? {
      fontSize,
      displayMode: 'bilingual',
      contrast: 'glass',
      position: 'bottom',
    };
    this.#locale = options?.settings.uiLanguage ?? 'en';
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host { all:initial; position:fixed; display:block; pointer-events:none; z-index:2147483647; --size:24px; --caption-bg:rgb(10 14 26 / 48%); --caption-filter:blur(18px) saturate(160%); --font:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; }
      *{box-sizing:border-box}[hidden]{display:none!important}.wrap{display:flex;flex-direction:column;align-items:center;justify-content:end;height:100%;padding:16px 5% 58px;gap:6px}
      .wrap.top{justify-content:start;padding-top:24px}.caption{white-space:pre-line;overflow-wrap:anywhere;unicode-bidi:plaintext;text-align:center;color:#fff;background:var(--caption-bg);-webkit-backdrop-filter:var(--caption-filter);backdrop-filter:var(--caption-filter);border:1px solid rgb(255 255 255 / 22%);border-radius:14px;box-shadow:inset 0 1px 0 rgb(255 255 255 / 22%),0 10px 30px -12px rgb(0 0 0 / 60%);padding:8px 18px;font:600 var(--size)/1.4 var(--font);max-width:100%;max-height:65%;overflow:hidden;text-shadow:0 1px 3px rgb(0 0 0 / 70%),0 0 12px rgb(0 0 0 / 35%)}
      .caption.bilingual{display:flex;flex-direction:column-reverse}.original-line{font-size:.82em;font-weight:500;color:rgb(240 244 252 / 88%)}.caption:empty,.label:empty{display:none}.label{font:500 11px/1.5 var(--font);color:#e4ecff;overflow-wrap:anywhere;max-width:100%}.provider-status{background:rgb(14 20 40 / 62%);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-radius:999px;padding:3px 10px;box-shadow:inset 0 1px 0 rgb(255 255 255 / 20%),inset 0 0 0 1px rgb(255 255 255 / 10%)}
      .dock{position:fixed;pointer-events:auto;display:flex;flex-direction:column;align-items:flex-end;gap:8px;width:46px;font:500 12px var(--font)}.logo{width:46px;height:46px;padding:0!important;position:relative;display:grid!important;place-items:center;touch-action:none;cursor:grab!important;border:0!important;border-radius:16px!important;background:linear-gradient(180deg,rgb(255 255 255 / 22%),rgb(255 255 255 / 6%)),rgb(14 20 40 / 40%)!important;-webkit-backdrop-filter:blur(16px) saturate(170%);backdrop-filter:blur(16px) saturate(170%);box-shadow:inset 0 1px 0 rgb(255 255 255 / 55%),inset 0 0 0 1px rgb(255 255 255 / 16%),0 10px 26px -10px rgb(0 0 0 / 70%)}.logo svg{width:30px;height:30px;pointer-events:none}.logo:active{cursor:grabbing!important;transform:none}
      .controls{position:absolute;right:0;top:54px;width:290px;max-width:calc(100vw - 24px);max-height:70vh;overflow:auto;display:flex;flex-wrap:wrap;gap:7px;align-items:center;padding:14px;border:1px solid rgb(255 255 255 / 18%);border-radius:22px;background:linear-gradient(180deg,rgb(34 42 66 / 82%),rgb(14 18 32 / 88%));box-shadow:inset 0 1px 0 rgb(255 255 255 / 24%),0 18px 44px -12px rgb(0 0 0 / 70%);-webkit-backdrop-filter:blur(22px) saturate(170%);backdrop-filter:blur(22px) saturate(170%)}.controls.above{top:auto;bottom:54px}.controls .label{flex-basis:100%;max-height:90px;overflow:auto}.controls select{width:100%;max-width:none}.peek{position:fixed;right:8px;top:22%;pointer-events:auto;opacity:.85;background:rgb(14 20 40 / 60%);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
      button,select{font:550 12px var(--font);color:#fff;background:rgb(255 255 255 / 10%);border:1px solid rgb(255 255 255 / 14%);border-radius:999px;min-height:32px;padding:6px 11px;cursor:pointer;transition:background .2s,transform .4s cubic-bezier(.34,1.56,.64,1)}select{border-radius:12px;background:rgb(0 0 0 / 28%)}select option{background:#141a2a;color:#f3f6fc}button:hover{background:rgb(255 255 255 / 18%)}button:active{transform:scale(.94)}button:focus-visible,select:focus-visible{outline:2px solid #9fd0ff;outline-offset:2px}button:disabled{opacity:.4;cursor:default;transform:none}.settings-link{width:100%;text-align:left;border-radius:14px;background:rgb(255 255 255 / 6%)}.peek:hover{opacity:1}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto;transition:none!important}}@media(prefers-reduced-transparency:reduce){.caption,.controls,.logo,.provider-status,.peek{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}}`;
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
    this.#toolbar.id = 'subtitle-quick-settings';
    this.#toolbar.hidden = true;
    this.#dock.className = 'dock';
    this.#logo.className = 'logo';
    this.#logo.type = 'button';
    this.#logo.setAttribute('aria-controls', this.#toolbar.id);
    this.#logo.setAttribute('aria-expanded', 'false');
    this.#logo.append(createMark(30));
    const toggle = (open: boolean) => {
      this.#toolbar.hidden = !open;
      if (!open) this.#quickRequested = false;
      this.#logo.setAttribute('aria-expanded', String(open));
      this.layout();
    };
    // This control exists only while captions are running. Clicking must not
    // toggle the menu or restart a provider job; hover/focus opens the controls.
    this.#logo.addEventListener('click', (event) => {
      if (event.isTrusted && !this.#drag?.moved) {
        clearTimeout(this.#menuTimer);
        toggle(false);
      }
      this.#drag = undefined;
    });
    this.#dock.addEventListener('pointerenter', () => {
      clearTimeout(this.#menuTimer);
      toggle(true);
    });
    this.#dock.addEventListener('pointerleave', () => {
      clearTimeout(this.#menuTimer);
      this.#menuTimer = setTimeout(() => {
        if (!this.#toolbar.contains(shadow.activeElement)) toggle(false);
      }, 350);
    });
    this.#logo.addEventListener('focus', () => {
      if (this.#logo.matches(':focus-visible')) toggle(true);
    });
    this.#logo.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.#drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
      this.#logo.setPointerCapture(event.pointerId);
    });
    this.#logo.addEventListener('pointermove', (event) => {
      const drag = this.#drag;
      if (!drag || drag.id !== event.pointerId || !(event.buttons & 1)) return;
      if (
        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4 &&
        !drag.moved
      )
        return;
      drag.moved = true;
      const width = document.documentElement.clientWidth;
      this.#position = {
        // Stay attached to the nearest side while dragging.
        x: event.clientX < width / 2 ? 0 : 1,
        y: (event.clientY - 29) / Math.max(1, window.innerHeight - 58),
      };
      toggle(false);
    });
    this.#logo.addEventListener('pointerup', (event) => {
      if (this.#logo.hasPointerCapture(event.pointerId))
        this.#logo.releasePointerCapture(event.pointerId);
    });
    this.#logo.addEventListener('pointercancel', () => {
      this.#drag = undefined;
    });
    this.#logo.addEventListener('keydown', (event) => {
      if (event.key === 'F2') {
        event.preventDefault();
        toggle(true);
        this.#toolbar.querySelector<HTMLElement>('select,button')?.focus();
        return;
      }
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -0.04],
        ArrowDown: [0, 0.04],
      };
      const move = delta[event.key];
      if (!move) return;
      event.preventDefault();
      this.#position.x += move[0];
      this.#position.y += move[1];
      this.layout();
    });
    this.#dock.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        toggle(false);
        this.#logo.focus();
      }
    });
    this.#peek.type = 'button';
    this.#peek.className = 'peek';
    this.#peek.hidden = true;
    this.#peek.addEventListener('click', () => {
      this.#dock.hidden = false;
      this.#peek.hidden = true;
      this.#logo.focus();
    });
    this.#buttons.push(
      [this.#logo, 'Quick subtitle settings'],
      [this.#peek, 'Show controls'],
    );
    this.#dock.append(this.#logo, this.#toolbar);
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
      button('−', 'Hide controls', () => {
        toggle(false);
        this.#dock.hidden = true;
        this.#peek.hidden = false;
        this.#peek.focus();
      });
      const general = document.createElement('button');
      general.type = 'button';
      general.className = 'settings-link';
      general.addEventListener('click', (event) => {
        if (event.isTrusted) options.openSettings?.();
      });
      this.#labels.push([general, 'Open settings']);
      this.#buttons.push([general, 'Open settings']);
      this.#toolbar.append(general, this.#label);
    }
    this.#wrap.append(this.#status, this.#caption);
    if (!options) this.#wrap.prepend(this.#label);
    shadow.append(style);
    if (options) shadow.append(this.#dock, this.#peek);
    shadow.append(this.#wrap);
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
      settings.contrast === 'solid' ? '#000' : 'rgb(10 14 26 / 48%)',
    );
    this.host.style.setProperty(
      '--caption-filter',
      settings.contrast === 'solid' ? 'none' : 'blur(18px) saturate(160%)',
    );
    this.#wrap.classList.toggle('top', settings.position === 'top');
    this.#mode.value = settings.displayMode;
    for (const option of this.#mode.options)
      option.disabled =
        settings.displayMode === 'original' && option.value !== 'original';
    this.#mode.title =
      settings.displayMode === 'original'
        ? translate(
            'Resume translation from the extension popup.',
            this.#locale,
          )
        : '';
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
    this.#peek.textContent = translate('Show controls', this.#locale);
    this.setLabel(this.#labelText);
    this.setTranslationStatus(this.#statusText);
  }
  layout() {
    const pageTools = document.querySelector('translator-page-tools');
    this.#dock.style.visibility =
      pageTools && !this.#quickRequested ? 'hidden' : '';
    this.#peek.style.visibility = pageTools ? 'hidden' : '';
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
    this.#position.x = Math.max(0, Math.min(1, this.#position.x));
    this.#position.y = Math.max(0, Math.min(1, this.#position.y));
    // Controls use viewport coordinates; captions retain video-relative geometry.
    const width = document.documentElement.clientWidth;
    const height = window.innerHeight;
    const inset = Math.min(6, Math.max(0, (width - 46) / 2));
    const x = inset + this.#position.x * Math.max(0, width - 46 - inset * 2),
      y = 6 + this.#position.y * Math.max(0, height - 58);
    this.#dock.style.left = `${x}px`;
    this.#dock.style.top = `${y}px`;
    // The restore tab follows the same edge and height as the hidden control.
    this.#peek.style.left = this.#position.x === 0 ? `${inset}px` : 'auto';
    this.#peek.style.right = this.#position.x === 1 ? `${inset}px` : 'auto';
    this.#peek.style.top = `${y}px`;
    this.#toolbar.style.width = `${Math.min(290, Math.max(150, width - 24))}px`;
    this.#toolbar.style.maxHeight = `${Math.max(100, height - 80)}px`;
    const panelWidth = Math.min(290, Math.max(150, width - 24));
    this.#toolbar.style.right = 'auto';
    this.#toolbar.style.left = `${Math.max(12, Math.min(x + 46 - panelWidth, width - panelWidth - 12)) - x}px`;
    const above = y > height / 2;
    this.#toolbar.classList.toggle('above', above);
    this.#toolbar.style.maxHeight = `${Math.max(80, above ? y - 8 : height - y - 62)}px`;
    const nativeRect = this.#native?.getBoundingClientRect();
    this.#wrap.style.paddingBottom =
      nativeRect &&
      nativeRect.height > 0 &&
      nativeRect.height < rect.height * 0.45
        ? `${Math.max(12, rect.bottom - nativeRect.bottom)}px`
        : '58px';
  }
  nativeCaption(element: HTMLElement | null) {
    if (element === this.#native) return;
    if (this.#native) {
      if (this.#nativeOpacity)
        this.#native.style.setProperty(
          'opacity',
          this.#nativeOpacity,
          this.#nativePriority,
        );
      else this.#native.style.removeProperty('opacity');
    }
    this.#native = element;
    if (element) {
      this.#nativeOpacity = element.style.getPropertyValue('opacity');
      this.#nativePriority = element.style.getPropertyPriority('opacity');
      element.style.setProperty('opacity', '0', 'important');
    }
  }
  render(text: string, original?: string) {
    const parts = original ?? '';
    if (text === this.#text && parts === this.#parts) return;
    this.#caption.replaceChildren();
    this.#caption.classList.toggle('bilingual', !!parts);
    if (parts && text.startsWith(parts + '\n')) {
      const source = document.createElement('div');
      source.className = 'original-line';
      source.dir = 'auto';
      source.textContent = parts + '\n';
      const translated = document.createElement('div');
      translated.dir = 'auto';
      translated.textContent = text.slice(parts.length + 1);
      this.#caption.append(source, translated);
    } else this.#caption.textContent = text;
    this.#text = text;
    this.#parts = parts;
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
    clearTimeout(this.#menuTimer);
    this.nativeCaption(null);
    document.removeEventListener(
      'subtitle-translator:show-controls',
      this.#showControls,
    );
    this.host.remove();
  }
}
