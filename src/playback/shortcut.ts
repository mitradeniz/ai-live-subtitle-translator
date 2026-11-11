import type {
  Appearance,
  PlayerMenu,
  MenuProvider,
} from '../messaging/protocol.ts';
import {
  captionMessage,
  type CaptionControl,
  type CaptionResult,
} from '../page/caption-control.ts';
import { nativeSourceWebVtt } from './download.ts';
import { readWithDeadline, ReadTimeout } from '../messaging/deadline.ts';
import { RequestError } from '../messaging/client.ts';

// Why the menu could not load, in words a person can act on.
const LOAD_MESSAGES = [
  'Open the extension popup to re-enable these tools.',
  'The extension was updated. Refresh this page to use it again.',
  'Reconnecting…',
  'Turn on Video subtitles in Customize translation.',
  'The extension is busy. Try again in a moment.',
  'The extension did not answer in time. Try again.',
] as const;
function loadMessage(error: unknown): (typeof LOAD_MESSAGES)[number] {
  if (error instanceof ReadTimeout) return LOAD_MESSAGES[5];
  if (!(error instanceof RequestError)) return LOAD_MESSAGES[0];
  return error.code === 'CONTEXT'
    ? LOAD_MESSAGES[1]
    : error.code === 'INVALID_SESSION'
      ? LOAD_MESSAGES[2]
      : error.code === 'FORBIDDEN'
        ? LOAD_MESSAGES[3]
        : error.code === 'BUSY'
          ? LOAD_MESSAGES[4]
          : LOAD_MESSAGES[0];
}
import { createMark } from '../ui/mark.ts';
import { LANGUAGES, languageName } from '../translation/languages.ts';

// Player-owned control rows are unstable. Keep their selectors local and only
// mount beside controls belonging to the selected main-document video.
const ROWS =
  '.vjs-control-bar,.jw-button-container,.shaka-controls-button-panel,.vds-controls-group,media-controls-group,.plyr__controls,.ytp-right-controls,[role="toolbar"]';
const CAPTION =
  '.vjs-subs-caps-button,.vjs-captions-button,.jw-icon-cc,.shaka-caption-button,.vds-caption-button,media-caption-button,[data-plyr="captions"],.ytp-subtitles-button';

function controlRow(video: HTMLVideoElement): HTMLElement | null {
  const rect = video.getBoundingClientRect();
  let root = video.parentElement;
  for (let depth = 0; root && depth < 6; depth++, root = root.parentElement) {
    if (root === document.body || root === document.documentElement) break;
    if (root.querySelectorAll('video').length !== 1) break;
    for (const row of Array.from(
      root.querySelectorAll<HTMLElement>(ROWS),
    ).slice(0, 16)) {
      if (
        !row.querySelector(CAPTION) &&
        row.querySelectorAll('button,[role="button"]').length < 2
      )
        continue;
      const box = row.getBoundingClientRect();
      if (
        box.width >= 80 &&
        box.height >= 20 &&
        box.height <= 96 &&
        box.left >= rect.left - 12 &&
        box.right <= rect.right + 12 &&
        box.top >= rect.bottom - 120 &&
        box.bottom <= rect.bottom + 100
      )
        return row;
    }
  }
  return null;
}

type MenuChange =
  { provider: MenuProvider } | { targetLanguage: string } | { swap: true };

export interface PlayerMenuOptions {
  t(text: string): string;
  recipient: string;
  // Shared with the edge button, so both always show the same state.
  captions: CaptionControl;
  read(): Promise<PlayerMenu>;
  // resume: subtitles were running, so continue them after the change.
  change(change: MenuChange, resume: boolean): Promise<void>;
  status(): Promise<CaptionResult>;
  appearance(next: Appearance): Promise<void>;
  settings(): Promise<void>;
}

const FONT_MIN = 16,
  FONT_MAX = 48;

export class PlayerShortcut {
  readonly button = document.createElement('button');
  #host = document.createElement('translator-player-shortcut');
  #menu = document.createElement('section');
  #switch = document.createElement('button');
  #download = document.createElement('button');
  #status = document.createElement('p');
  #provider = document.createElement('select');
  #language = document.createElement('select');
  #swap = document.createElement('button');
  #pair = document.createElement('small');
  #main = document.createElement('div');
  #lookPage = document.createElement('div');
  #lookRow = document.createElement('button');
  #lookSummary = document.createElement('small');
  #display = document.createElement('select');
  #contrast = document.createElement('select');
  #place = document.createElement('select');
  #size = document.createElement('output');
  #smaller = document.createElement('button');
  #larger = document.createElement('button');
  #look: Appearance | undefined;
  #queued: Appearance | undefined;
  #saving = false;
  #hint = '';
  #unsubscribe: () => void;
  #config: PlayerMenu | undefined;
  #timer: ReturnType<typeof setInterval>;
  #closed = false;
  #busy = false;
  #refreshing = false;
  #epoch = 0;
  #lastRead = 0;
  #video: HTMLVideoElement | undefined;
  #urls = new Set<string>();
  constructor(private options: PlayerMenuOptions) {
    const shadow = this.#host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host{all:initial;display:inline-flex;flex:0 0 34px;align-self:stretch;align-items:center;justify-content:center;width:34px;vertical-align:middle;color-scheme:dark}*{box-sizing:border-box}button{cursor:pointer;font:500 13px/1.4 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#f3f6fc}select:focus-visible,button:focus-visible{outline:2px solid #9fd0ff;outline-offset:2px}button:disabled{opacity:.5;cursor:default}.trigger{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:9px;background:linear-gradient(180deg,rgb(255 255 255 / 24%),rgb(255 255 255 / 6%)),rgb(16 20 36 / 45%);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:inset 0 1px 0 rgb(255 255 255 / 50%),inset 0 0 0 1px rgb(255 255 255 / 16%)}.trigger svg{width:20px;height:20px;pointer-events:none}.trigger:hover{background:linear-gradient(180deg,rgb(255 255 255 / 32%),rgb(255 255 255 / 10%)),rgb(16 20 36 / 55%)}.menu{position:fixed;inset:auto;margin:0;width:270px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;padding:8px;border:1px solid rgb(255 255 255 / 16%);border-radius:20px;background:linear-gradient(180deg,rgb(34 42 66 / 88%),rgb(14 18 32 / 92%));color:#f3f6fc;box-shadow:inset 0 1px 0 rgb(255 255 255 / 22%),0 18px 44px -14px rgb(0 0 0 / 70%);-webkit-backdrop-filter:blur(22px) saturate(170%);backdrop-filter:blur(22px) saturate(170%);font:12px/1.4 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}.item{display:flex;align-items:center;gap:10px;width:100%;min-height:42px;padding:9px 10px;border:0;border-radius:12px;background:transparent;text-align:start}.item:hover:not(:disabled){background:rgb(255 255 255 / 9%)}.icon{flex:0 0 20px;white-space:nowrap;width:20px;text-align:center;color:#c8ecff}.caption{flex:1}.caption small{display:block;font-size:10px;color:rgb(226 233 247 / 66%);margin-top:2px}.track{width:30px;height:18px;padding:2px;border-radius:20px;background:rgb(255 255 255 / 16%);box-shadow:inset 0 1px 2px rgb(0 0 0 / 40%);flex-shrink:0;transition:background .3s}.thumb{display:block;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgb(0 0 0 / 40%);transition:transform .45s cubic-bezier(.34,1.56,.64,1)}[aria-checked="true"] .track{background:linear-gradient(135deg,#7fe9c3,#6ec3ff)}[aria-checked="true"] .thumb{transform:translateX(12px)}.recipient{font-size:10px;color:rgb(226 233 247 / 66%);border-top:1px solid rgb(255 255 255 / 10%);padding:8px 10px 2px;margin:3px 0 0;overflow-wrap:anywhere}.status{font-size:11px;color:#ffe1b3;margin:4px 10px;overflow-wrap:anywhere}.status:empty{display:none}.field{display:block;padding:6px 10px;font-size:11px;color:rgb(226 233 247 / 74%)}.field select{display:block;width:100%;min-width:0;margin-top:5px;padding:7px 10px;border:1px solid rgb(255 255 255 / 12%);border-radius:10px;background:rgb(0 0 0 / 28%);color:#f3f6fc;font:12px ui-sans-serif,system-ui,sans-serif}.field select option{background:#141a2a}.field select:disabled{opacity:.5}.swap .icon{font-size:15px;transition:transform .55s cubic-bezier(.3,1.45,.5,1)}.swap:hover:not(:disabled) .icon{transform:rotate(180deg)}.swap small{direction:ltr;unicode-bidi:isolate}.chevron{flex:none;font-size:18px;line-height:1;color:rgb(226 233 247 / 60%)}.back{border-bottom:1px solid rgb(255 255 255 / 10%);border-radius:12px 12px 0 0;margin-bottom:4px}.back .icon{font-size:18px;line-height:1}.pair{display:grid;grid-template-columns:1fr 1fr}.pair .field:first-child{padding-right:4px}.pair .field:last-child{padding-left:4px}.size{display:flex;align-items:center;justify-content:space-between;gap:8px}.stepper{display:flex;align-items:center;gap:4px}.stepper button{display:grid;place-items:center;width:32px;height:28px;padding:0;border:1px solid rgb(255 255 255 / 12%);border-radius:9px;background:rgb(0 0 0 / 28%);font-size:12px}.stepper button:hover:not(:disabled){background:rgb(255 255 255 / 12%)}.stepper output{min-width:28px;text-align:center;font-variant-numeric:tabular-nums;color:#f3f6fc;font-size:12px}[aria-busy="true"] .track{opacity:.7}@media(prefers-reduced-motion:reduce){*{transition:none!important}}`;
    this.button.type = 'button';
    this.button.className = 'trigger';
    this.button.append(createMark(20));
    this.button.title = options.t('Video translation settings');
    this.button.setAttribute(
      'aria-label',
      options.t('Video translation settings'),
    );
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.setAttribute('aria-expanded', 'false');
    this.#menu.className = 'menu';
    this.#menu.popover = 'auto';
    this.#menu.tabIndex = -1;
    this.#menu.setAttribute('role', 'dialog');
    this.#menu.setAttribute(
      'aria-label',
      options.t('Video translation settings'),
    );
    this.#menu.addEventListener('toggle', () => {
      const open = this.#menu.matches(':popover-open');
      this.button.setAttribute('aria-expanded', String(open));
      if (!open) this.#epoch++;
    });
    this.#menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && event.isTrusted) {
        event.preventDefault();
        // The style page steps back first, like a player's own settings.
        if (!this.#lookPage.hidden) this.#showLook(false);
        else {
          this.#menu.hidePopover();
          this.button.focus();
        }
      }
      event.stopPropagation();
    });
    this.button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!event.isTrusted) return;
      if (this.#menu.matches(':popover-open')) this.#menu.hidePopover();
      else {
        this.open();
      }
    });
    for (const type of ['pointerdown', 'keydown', 'keyup'])
      this.button.addEventListener(type, (event) => event.stopPropagation());
    this.#switch.type = 'button';
    this.#switch.className = 'item';
    this.#switch.setAttribute('role', 'switch');
    this.#switch.setAttribute('aria-label', options.t('Subtitle translation'));
    this.#switch.setAttribute('aria-checked', 'false');
    this.#switch.disabled = true;
    this.#row(this.#switch, 'A文', 'Subtitle translation');
    this.#unsubscribe = options.captions.subscribe(() => {
      if (!this.#closed) this.#paint();
    });
    const track = document.createElement('span');
    track.className = 'track';
    track.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    track.append(thumb);
    this.#switch.append(track);
    // Every click counts, even while an earlier one is still being applied.
    this.#switch.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.isTrusted && !this.#busy) void this.#flip();
    });
    this.#download.type = 'button';
    this.#download.className = 'item';
    this.#row(
      this.#download,
      '⇩',
      'Download subtitles',
      'Original subtitles · VTT',
    );
    this.#download.title = options.t(
      'Requires a loaded, unambiguous native caption track.',
    );
    this.#download.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!event.isTrusted) return;
      const source = this.#source();
      if (!source) {
        this.#notice('No downloadable timed source subtitles.');
        return;
      }
      const url = URL.createObjectURL(
        new Blob([source], { type: 'text/vtt;charset=utf-8' }),
      );
      this.#urls.add(url);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'subtitles-original.vtt';
      shadow.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        this.#urls.delete(url);
      }, 1000);
    });
    const settings = document.createElement('button');
    settings.type = 'button';
    settings.className = 'item';
    this.#row(settings, '⚙', 'Settings');
    settings.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.isTrusted)
        void options
          .settings()
          .then(() => this.#menu.hidePopover())
          .catch(() =>
            this.#notice('Open the extension popup to re-enable these tools.'),
          );
    });
    const recipient = document.createElement('p');
    recipient.className = 'recipient';
    recipient.textContent = options.recipient;
    this.#status.className = 'status';
    this.#status.setAttribute('role', 'status');
    const fields = [
      ['Translation provider', this.#provider],
      ['Target language', this.#language],
    ] as const;
    this.#swap.type = 'button';
    this.#swap.className = 'item swap';
    this.#swap.setAttribute(
      'aria-label',
      options.t('Swap source and target languages'),
    );
    this.#swap.disabled = true;
    this.#row(this.#swap, '⇄', 'Swap languages');
    this.#swap.querySelector('.caption')?.append(this.#pair);
    this.#swap.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!event.isTrusted || this.#busy || !this.#config) return;
      if (this.#config.sourceLanguage === 'auto') {
        this.#notice('Set a source language in settings to swap.');
        return;
      }
      void this.#change({ swap: true });
    });
    const labels = fields.map(([text, select]) => {
      const label = document.createElement('label');
      label.className = 'field';
      label.textContent = options.t(text);
      select.setAttribute('aria-label', options.t(text));
      select.disabled = true;
      label.append(select);
      select.addEventListener('change', (event) => {
        event.stopPropagation();
        if (!event.isTrusted || this.#busy || !this.#config) return;
        void this.#change(
          select === this.#provider
            ? { provider: select.value as MenuProvider }
            : { targetLanguage: select.value },
        );
      });
      return label;
    });
    // Subtitle style opens as its own page, so the menu stays short enough
    // to sit above the player's controls.
    this.#lookRow.type = 'button';
    this.#lookRow.className = 'item';
    this.#lookRow.setAttribute('aria-haspopup', 'true');
    this.#row(this.#lookRow, 'Aa', 'Subtitle style');
    this.#lookRow.querySelector('.caption')?.append(this.#lookSummary);
    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    this.#lookRow.append(chevron);
    this.#lookRow.disabled = true;
    this.#lookRow.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.isTrusted) this.#showLook(true);
    });
    this.#main.append(
      this.#switch,
      ...labels,
      this.#swap,
      this.#lookRow,
      this.#download,
      settings,
      recipient,
    );
    this.#lookPage.hidden = true;
    this.#lookPage.setAttribute('role', 'group');
    this.#lookPage.setAttribute('aria-label', options.t('Subtitle style'));
    this.#lookPage.append(...this.#buildLook());
    this.#menu.append(this.#main, this.#lookPage, this.#status);
    shadow.append(style, this.button, this.#menu);
    this.#timer = setInterval(() => {
      this.layout();
      if (
        this.#menu.matches(':popover-open') &&
        Date.now() - this.#lastRead >= 2000
      )
        void this.#refresh();
    }, 1000);
    window.addEventListener('scroll', this.layout, true);
    window.addEventListener('resize', this.layout);
    document.addEventListener('fullscreenchange', this.layout);
    this.layout();
  }
  open(notice = '') {
    if (this.#closed || !this.#host.isConnected) return;
    this.#showLook(false, false);
    this.#menu.showPopover();
    this.#menu.focus();
    this.#download.disabled = !this.#source();
    this.#notice(notice);
    void this.#refresh();
  }
  #paintConfig(config: PlayerMenu) {
    this.#config = config;
    this.#provider.replaceChildren();
    const states = {
      ready: '',
      'key-required': 'Add key in settings',
      'permission-required': 'Allow access in settings',
      'setup-required': 'Set up in settings',
    };
    for (const choice of config.choices) {
      const option = document.createElement('option');
      option.value = choice.id;
      const name =
        choice.id === 'none'
          ? this.options.t('Original only')
          : choice.id === 'google-cloud'
            ? 'Google Cloud'
            : choice.id === 'google'
              ? this.options.t('Google · Experimental')
              : choice.id;
      option.textContent = `${choice.keySaved ? '✓ ' : ''}${name}${!['google', 'none'].includes(choice.id) ? ` · ${this.options.t('Paid API')}` : ''}${choice.state === 'ready' ? '' : ` · ${this.options.t(states[choice.state])}`}`;
      option.disabled = choice.state !== 'ready';
      option.title = choice.label;
      this.#provider.append(option);
    }
    this.#provider.value = config.selected;
    this.#provider.title =
      config.choices.find((choice) => choice.id === config.selected)?.label ??
      '';
    const languages: [string, string][] = LANGUAGES.map(([code, name]) => [
      code,
      name,
    ]);
    if (!languages.some(([code]) => code === config.targetLanguage))
      languages.push([config.targetLanguage, config.targetLanguage]);
    this.#language.replaceChildren(
      ...languages.map(([code, label]) => {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = label;
        return option;
      }),
    );
    this.#language.value = config.targetLanguage;
    const name = (code: string) =>
      code === 'auto' ? this.options.t('Auto-detect') : languageName(code);
    this.#pair.textContent = `${name(config.sourceLanguage)} → ${name(config.targetLanguage)}`;
    this.#swap.title =
      config.sourceLanguage === 'auto'
        ? this.options.t('Set a source language in settings to swap.')
        : this.options.t('Swap source and target languages');
    // A saved change still on its way keeps what the person just chose.
    if (!this.#saving && !this.#queued) {
      this.#look = config.appearance;
      this.#paintLook();
    }
    this.#position();
  }
  // Subtitle display, background, position and size, saved as they change.
  #showLook(show: boolean, focus = true) {
    this.#main.hidden = show;
    this.#lookPage.hidden = !show;
    if (focus)
      (show
        ? this.#lookPage.querySelector<HTMLElement>('.back')
        : this.#lookRow
      )?.focus();
    this.#position();
  }
  #buildLook() {
    const t = this.options.t;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'item back';
    this.#row(back, '‹', 'Subtitle style');
    back.setAttribute('aria-label', t('Back'));
    back.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.isTrusted) this.#showLook(false);
    });
    const field = (text: string, select: HTMLSelectElement) => {
      const label = document.createElement('label');
      label.className = 'field';
      label.textContent = t(text);
      select.setAttribute('aria-label', t(text));
      select.disabled = true;
      label.append(select);
      return label;
    };
    const fill = (
      select: HTMLSelectElement,
      items: readonly (readonly [string, string])[],
    ) =>
      select.replaceChildren(
        ...items.map(([value, text]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = t(text);
          return option;
        }),
      );
    fill(this.#display, [
      ['translated', 'Translation only'],
      ['bilingual', 'Original and translation'],
      ['original', 'Original only'],
    ]);
    fill(this.#contrast, [
      ['glass', 'Glass'],
      ['solid', 'Solid'],
    ]);
    fill(this.#place, [
      ['bottom', 'Bottom'],
      ['top', 'Top'],
    ]);
    for (const [select, key] of [
      [this.#display, 'displayMode'],
      [this.#contrast, 'contrast'],
      [this.#place, 'position'],
    ] as const)
      select.addEventListener('change', (event) => {
        event.stopPropagation();
        if (event.isTrusted)
          this.#setLook({ [key]: select.value } as Partial<Appearance>);
      });
    const pair = document.createElement('div');
    pair.className = 'pair';
    pair.append(
      field('Background', this.#contrast),
      field('Position', this.#place),
    );
    const size = document.createElement('div');
    size.className = 'field size';
    const name = document.createElement('span');
    name.textContent = t('Font size');
    const stepper = document.createElement('div');
    stepper.className = 'stepper';
    stepper.setAttribute('role', 'group');
    stepper.setAttribute('aria-label', t('Font size'));
    for (const [button, text, label, step] of [
      [this.#smaller, 'A−', 'Smaller text', -2],
      [this.#larger, 'A+', 'Larger text', 2],
    ] as const) {
      button.type = 'button';
      button.textContent = text;
      button.title = t(label);
      button.setAttribute('aria-label', t(label));
      button.disabled = true;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!event.isTrusted || !this.#look) return;
        this.#setLook({
          fontSize: Math.min(
            FONT_MAX,
            Math.max(FONT_MIN, this.#look.fontSize + step),
          ),
        });
      });
    }
    this.#size.setAttribute('aria-live', 'polite');
    stepper.append(this.#smaller, this.#size, this.#larger);
    size.append(name, stepper);
    return [back, field('Display mode', this.#display), pair, size];
  }
  #paintLook() {
    const look = this.#look;
    const off = this.#busy || !look;
    this.#display.disabled =
      this.#contrast.disabled =
      this.#place.disabled =
        off;
    this.#smaller.disabled = off || look.fontSize <= FONT_MIN;
    this.#larger.disabled = off || look.fontSize >= FONT_MAX;
    this.#lookRow.disabled = off;
    if (!look) return;
    this.#display.value = look.displayMode;
    this.#contrast.value = look.contrast;
    this.#place.value = look.position;
    this.#size.textContent = String(look.fontSize);
    const mode = {
      translated: 'Translation only',
      bilingual: 'Original and translation',
      original: 'Original only',
    }[look.displayMode];
    this.#lookSummary.textContent = `${this.options.t(mode)} · ${look.fontSize}`;
  }
  #setLook(patch: Partial<Appearance>) {
    if (this.#closed || this.#busy || !this.#look) return;
    const next = { ...this.#look, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.#look)) return;
    this.#look = next;
    this.#queued = next;
    this.#paintLook();
    void this.#saveLook();
  }
  // Saves one change at a time and always ends with the latest choice.
  async #saveLook() {
    if (this.#saving) return;
    this.#saving = true;
    this.#epoch++;
    try {
      while (this.#queued && !this.#closed) {
        const next = this.#queued;
        this.#queued = undefined;
        await this.options.appearance(next);
        if (this.#config) this.#config = { ...this.#config, appearance: next };
      }
      if (this.#hint && this.#status.textContent === this.#hint)
        this.#notice('');
    } catch {
      this.#queued = undefined;
      this.#notice('Could not save the subtitle style. Try again.');
      if (this.#config) {
        this.#look = this.#config.appearance;
        this.#paintLook();
      }
    } finally {
      this.#saving = false;
      // A display change can start or stop translation; show it soon.
      this.#lastRead = 0;
    }
  }
  async #change(change: MenuChange) {
    this.#busy = true;
    this.#epoch++;
    this.#paint();
    this.#notice('Saving preferences…');
    try {
      await this.options.change(change, this.options.captions.on);
    } catch {
      if (this.#config) this.#paintConfig(this.#config);
      this.#notice(
        'Could not save. Check provider setup in settings or reopen the popup.',
      );
    } finally {
      this.#busy = false;
      if (!this.#closed) this.#paint();
    }
  }
  #row(
    button: HTMLButtonElement,
    icon: string,
    label: string,
    detail?: string,
  ) {
    const glyph = document.createElement('span');
    glyph.className = 'icon';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = icon;
    const caption = document.createElement('span');
    caption.className = 'caption';
    caption.textContent = this.options.t(label);
    if (detail) {
      const small = document.createElement('small');
      small.textContent = this.options.t(detail);
      caption.append(small);
    }
    button.append(glyph, caption);
  }
  #source() {
    return this.#video?.isConnected ? nativeSourceWebVtt(this.#video) : null;
  }
  #notice(text: string) {
    if (!this.#closed) {
      this.#status.textContent = this.options.t(text);
      this.#position();
    }
  }
  #paint() {
    const captions = this.options.captions;
    this.#switch.setAttribute('aria-checked', String(captions.on));
    this.#switch.setAttribute('aria-busy', String(captions.busy));
    this.#switch.disabled = this.#busy;
    this.#paintLook();
    this.#provider.disabled = this.#language.disabled =
      this.#busy || !this.#config;
    this.#swap.disabled =
      this.#busy || !this.#config || this.#config.sourceLanguage === 'auto';
  }
  async #refresh() {
    if (this.#closed || this.#busy || this.#refreshing) return;
    const epoch = this.#epoch;
    const since = this.options.captions.version;
    this.#refreshing = true;
    this.#lastRead = Date.now();
    let loaded = Boolean(this.#config);
    let failure: unknown;
    try {
      // Settings and subtitle status are read independently, so a slow or
      // failed status check never leaves the provider and language empty.
      const [state, config] = await Promise.allSettled([
        readWithDeadline(this.options.status(), 5000),
        readWithDeadline(this.options.read(), 5000),
      ]);
      if (!this.#closed && epoch === this.#epoch && !this.#busy) {
        if (config.status === 'rejected') failure = config.reason;
        if (config.status === 'fulfilled') {
          loaded = true;
          // Avoid replacing options under an open native select during polling.
          if (JSON.stringify(config.value) !== JSON.stringify(this.#config))
            this.#paintConfig(config.value);
        }
        // An unknown status keeps the last state; a click reports the
        // exact reason if subtitles cannot start.
        if (state.status === 'fulfilled') {
          this.options.captions.observe(state.value.state, since);
          this.#explain(state.value);
        }
      }
    } finally {
      this.#refreshing = false;
      if (!this.#closed && epoch === this.#epoch) {
        this.#paint();
        if (!loaded) this.#notice(loadMessage(failure));
        else if (
          LOAD_MESSAGES.some(
            (text) => this.#status.textContent === this.options.t(text),
          )
        )
          this.#notice('');
      }
    }
  }
  // Continue subtitles after a menu change replaced this page session. The
  // shared switch waits out the background's one-start-per-second limit.
  async resume() {
    await this.#flip(true, true);
  }
  async #flip(enable?: boolean, keepNotice = false) {
    this.#epoch++;
    if (!keepNotice) this.#notice('');
    const captions = this.options.captions;
    const outcome = await (enable === undefined
      ? captions.toggle()
      : captions.set(enable));
    if (this.#closed) return;
    this.#hint = '';
    this.#notice(captionMessage(outcome, 'menu'));
    // Show the display the switch picked without waiting for the next read.
    if (outcome.displayChanged && this.#look && !this.#queued) {
      this.#look = { ...this.#look, displayMode: 'bilingual' };
      if (this.#config)
        this.#config = { ...this.#config, appearance: this.#look };
      this.#paintLook();
    }
  }
  // While the switch is off for a reason the menu can fix, say which.
  #explain(result: CaptionResult) {
    const text = !result.reason
      ? ''
      : this.options.t(
          result.reason === 'original-only'
            ? 'Showing original subtitles only. Turn subtitle translation on to translate them.'
            : captionMessage({ enable: true, result }, 'menu'),
        );
    const shown = this.#status.textContent ?? '';
    if (text && (!shown || shown === this.#hint)) {
      this.#hint = text;
      this.#status.textContent = text;
      this.#position();
    } else if (!text && this.#hint && shown === this.#hint) {
      this.#hint = '';
      this.#notice('');
    }
  }
  #position() {
    if (!this.#menu.matches(':popover-open')) return;
    const rect = this.button.getBoundingClientRect();
    const width = this.#menu.offsetWidth,
      height = this.#menu.offsetHeight;
    this.#menu.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.right - width))}px`;
    this.#menu.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, rect.top - height - 8))}px`;
  }
  layout = () => {
    if (this.#closed) return;
    let video: HTMLVideoElement | undefined;
    let area = 0;
    for (const candidate of Array.from(
      document.querySelectorAll('video'),
    ).slice(0, 32)) {
      const rect = candidate.getBoundingClientRect();
      if (
        rect.width < 240 ||
        rect.height < 140 ||
        rect.bottom <= 0 ||
        rect.top >= innerHeight ||
        rect.right <= 0 ||
        rect.left >= innerWidth ||
        !candidate.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        })
      )
        continue;
      if (rect.width * rect.height > area) {
        video = candidate;
        area = rect.width * rect.height;
      }
    }
    const full = document.fullscreenElement;
    const row =
      video && full !== video && (!full || full.contains(video))
        ? controlRow(video)
        : null;
    if (!row || this.#video !== video) {
      if (this.#menu.matches(':popover-open')) this.#menu.hidePopover();
      this.#host.remove();
    }
    this.#video = video;
    if (!row) return;
    if (this.#host.parentElement !== row) {
      let anchor =
        row.querySelector(CAPTION) ??
        row.querySelector(
          '[aria-label*="caption" i],[aria-label*="subtitle" i],[aria-label*="altyaz" i]',
        );
      while (anchor?.parentElement && anchor.parentElement !== row)
        anchor = anchor.parentElement;
      row.insertBefore(this.#host, anchor ?? row.lastElementChild);
    }
    this.#position();
  };
  dispose() {
    this.#closed = true;
    this.#epoch++;
    clearInterval(this.#timer);
    window.removeEventListener('scroll', this.layout, true);
    window.removeEventListener('resize', this.layout);
    document.removeEventListener('fullscreenchange', this.layout);
    this.#unsubscribe();
    for (const url of this.#urls) URL.revokeObjectURL(url);
    this.#urls.clear();
    this.#host.remove();
  }
}
