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

export class PlayerShortcut {
  readonly button = document.createElement('button');
  #host = document.createElement('translator-player-shortcut');
  #timer: ReturnType<typeof setInterval>;
  #closed = false;
  constructor(label: string, open: () => void) {
    const shadow = this.#host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host{all:initial;display:inline-flex;flex:0 0 34px;align-self:stretch;align-items:center;justify-content:center;width:34px;vertical-align:middle;color-scheme:dark}button{box-sizing:border-box;width:28px;height:28px;padding:0;cursor:pointer;font:700 13px/1 system-ui;color:#f3f6ff;border:1px solid #d4e4ff65;border-radius:7px;background:linear-gradient(145deg,#7187a980,#152139cc);box-shadow:inset 0 1px #ffffff45}button:hover{background:#536987}button:focus-visible{outline:2px solid #b0d6ff;outline-offset:2px}`;
    this.button.type = 'button';
    this.button.textContent = 'A文';
    this.button.title = label;
    this.button.setAttribute('aria-label', label);
    this.button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.isTrusted) open();
    });
    for (const type of ['pointerdown', 'keydown', 'keyup'])
      this.button.addEventListener(type, (event) => event.stopPropagation());
    shadow.append(style, this.button);
    this.#timer = setInterval(this.layout, 1000);
    window.addEventListener('scroll', this.layout, true);
    window.addEventListener('resize', this.layout);
    document.addEventListener('fullscreenchange', this.layout);
    this.layout();
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
    if (!row) {
      // Native browser controls and unknown layouts keep the page-edge menu.
      // Do not put a detached button over the picture or outside the player.
      this.#host.remove();
      return;
    }
    if (this.#host.parentElement === row) return;
    let anchor =
      row.querySelector(CAPTION) ??
      row.querySelector(
        '[aria-label*="caption" i],[aria-label*="subtitle" i],[aria-label*="altyaz" i]',
      );
    while (anchor?.parentElement && anchor.parentElement !== row)
      anchor = anchor.parentElement;
    row.insertBefore(this.#host, anchor ?? row.lastElementChild);
  };
  dispose() {
    this.#closed = true;
    clearInterval(this.#timer);
    window.removeEventListener('scroll', this.layout, true);
    window.removeEventListener('resize', this.layout);
    document.removeEventListener('fullscreenchange', this.layout);
    this.#host.remove();
  }
}
