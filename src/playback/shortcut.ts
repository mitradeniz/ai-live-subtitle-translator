import { nativeSourceWebVtt } from './download.ts';
import { readWithDeadline } from '../messaging/deadline.ts';
import type { PlaybackState } from '../messaging/playback.ts';

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

export interface PlayerMenuOptions {
  t(text: string): string;
  recipient: string;
  status(): Promise<PlaybackState>;
  toggle(enabled: boolean): Promise<PlaybackState>;
  settings(): Promise<void>;
}

export class PlayerShortcut {
  readonly button = document.createElement('button');
  #host = document.createElement('translator-player-shortcut');
  #menu = document.createElement('section');
  #switch = document.createElement('button');
  #download = document.createElement('button');
  #status = document.createElement('p');
  #timer: ReturnType<typeof setInterval>;
  #closed = false;
  #busy = false;
  #refreshing = false;
  #state: PlaybackState = 'unavailable';
  #epoch = 0;
  #lastRead = 0;
  #video: HTMLVideoElement | undefined;
  #urls = new Set<string>();
  constructor(private options: PlayerMenuOptions) {
    const shadow = this.#host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host{all:initial;display:inline-flex;flex:0 0 34px;align-self:stretch;align-items:center;justify-content:center;width:34px;vertical-align:middle;color-scheme:dark}*{box-sizing:border-box}button{cursor:pointer;font:500 13px/1.4 system-ui;color:#f3f6ff}button:focus-visible{outline:2px solid #b0d6ff;outline-offset:2px}button:disabled{opacity:.5;cursor:default}.trigger{width:28px;height:28px;padding:0;font-weight:700;border:1px solid #d4e4ff65;border-radius:7px;background:linear-gradient(145deg,#7187a980,#152139cc);box-shadow:inset 0 1px #ffffff45}.trigger:hover{background:#536987}.menu{position:fixed;inset:auto;margin:0;width:270px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;padding:8px;border:1px solid #d6e5ff35;border-radius:17px;background:linear-gradient(140deg,#263447f2,#0b1522f2);color:#f3f6ff;box-shadow:0 10px 35px #0005,inset 0 1px #ffffff16;backdrop-filter:blur(18px);font:12px/1.4 system-ui}.item{display:flex;align-items:center;gap:10px;width:100%;min-height:42px;padding:9px 10px;border:0;border-radius:10px;background:transparent;text-align:start}.item:hover:not(:disabled){background:#ffffff12}.icon{flex:0 0 20px;white-space:nowrap;width:20px;text-align:center;color:#c9d7ee}.caption{flex:1}.caption small{display:block;font-size:10px;color:#aebed7;margin-top:2px}.track{width:30px;height:17px;padding:2px;border-radius:20px;background:#63728b;flex-shrink:0}.thumb{display:block;width:13px;height:13px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0005}[aria-checked="true"] .track{background:#9dbbff}[aria-checked="true"] .thumb{transform:translateX(13px)}.recipient{font-size:10px;color:#b9c8df;border-top:1px solid #ffffff16;padding:8px 10px 2px;margin:3px 0 0;overflow-wrap:anywhere}.status{font-size:11px;color:#e2cf9b;margin:4px 10px;overflow-wrap:anywhere}.status:empty{display:none}`;
    this.button.type = 'button';
    this.button.className = 'trigger';
    this.button.textContent = 'A文';
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
        this.#menu.hidePopover();
        this.button.focus();
      }
      event.stopPropagation();
    });
    this.button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!event.isTrusted) return;
      if (this.#menu.matches(':popover-open')) this.#menu.hidePopover();
      else {
        this.#menu.showPopover();
        this.#position();
        this.#menu.focus();
        this.#download.disabled = !this.#source();
        void this.#refresh();
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
    const track = document.createElement('span');
    track.className = 'track';
    track.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    track.append(thumb);
    this.#switch.append(track);
    this.#switch.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.isTrusted && !this.#busy) void this.#toggle();
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
    this.#menu.append(
      this.#switch,
      this.#download,
      settings,
      recipient,
      this.#status,
    );
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
    this.#switch.setAttribute(
      'aria-checked',
      String(this.#state === 'enabled'),
    );
    this.#switch.disabled = this.#busy || this.#state === 'unavailable';
  }
  async #refresh() {
    if (this.#closed || this.#busy || this.#refreshing) return;
    const epoch = this.#epoch;
    this.#refreshing = true;
    this.#lastRead = Date.now();
    try {
      const state = await readWithDeadline(this.options.status(), 3000);
      if (!this.#closed && epoch === this.#epoch && !this.#busy)
        this.#state = state;
    } catch {
      if (!this.#closed && epoch === this.#epoch) this.#state = 'unavailable';
    } finally {
      this.#refreshing = false;
      if (!this.#closed && epoch === this.#epoch) {
        this.#paint();
        if (this.#state === 'unavailable')
          this.#notice('Page status unavailable');
      }
    }
  }
  async #toggle() {
    this.#busy = true;
    this.#epoch++;
    this.#notice('');
    this.#paint();
    try {
      const state = await this.options.toggle(this.#state !== 'enabled');
      if (this.#closed) return;
      this.#state = state;
      const message = {
        enabled: '',
        disabled: '',
        'needs-restart':
          'Choose a provider and translated display in the popup first.',
        'key-required': 'Add your provider key in settings, then try again.',
        'permission-required':
          'Allow provider access in settings, then try again.',
        'source-required':
          'Confirm the original YouTube caption track in Customize translation.',
        'no-video': 'No supported video found on this page.',
        unavailable: 'Open the extension popup to re-enable these tools.',
      }[state];
      this.#notice(message);
    } catch {
      this.#notice('Open the extension popup to re-enable these tools.');
    } finally {
      this.#busy = false;
      this.#paint();
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
    for (const url of this.#urls) URL.revokeObjectURL(url);
    this.#urls.clear();
    this.#host.remove();
  }
}
