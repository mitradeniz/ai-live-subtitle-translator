// A page-owned player toolbar is unstable. Keep our button in the isolated
// controls layer, positioned inside the visible video above its native controls.
export class PlayerShortcut {
  readonly button = document.createElement('button');
  #timer: ReturnType<typeof setInterval>;
  #video: HTMLVideoElement | undefined;
  #closed = false;
  constructor(parent: ShadowRoot, label: string, open: () => void) {
    this.button.type = 'button';
    this.button.className = 'player-shortcut';
    this.button.textContent = 'A文';
    this.button.title = label;
    this.button.setAttribute('aria-label', label);
    this.button.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      event.stopPropagation();
      open();
    });
    this.button.hidden = true;
    parent.append(this.button);
    this.#timer = setInterval(this.#discover, 1000);
    window.addEventListener('scroll', this.layout, true);
    window.addEventListener('resize', this.layout);
    document.addEventListener('fullscreenchange', this.layout);
    this.#discover();
  }
  #discover = () => {
    // Main-document videos only; never reach into cross-origin frames.
    let area = 0;
    this.#video = undefined;
    for (const video of Array.from(document.querySelectorAll('video')).slice(
      0,
      32,
    )) {
      const rect = video.getBoundingClientRect();
      if (
        rect.bottom <= 0 ||
        rect.top >= innerHeight ||
        rect.right <= 0 ||
        rect.left >= innerWidth ||
        !video.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      )
        continue;
      if (rect.width * rect.height > area) {
        this.#video = video;
        area = rect.width * rect.height;
      }
    }
    this.layout();
  };
  layout = () => {
    if (this.#closed) return;
    const video = this.#video;
    const rect = video?.getBoundingClientRect();
    const full = document.fullscreenElement;
    this.button.hidden =
      !video?.isConnected ||
      !rect ||
      rect.width < 240 ||
      rect.height < 140 ||
      rect.bottom <= 0 ||
      rect.top >= innerHeight ||
      rect.right <= 0 ||
      rect.left >= innerWidth ||
      full === video ||
      !!(full && !full.contains(video));
    if (this.button.hidden || !rect) return;
    this.button.style.left = `${Math.max(6, Math.min(innerWidth - 46, rect.right - 50))}px`;
    this.button.style.top = `${Math.max(6, Math.min(innerHeight - 46, rect.bottom - 94))}px`;
  };
  dispose() {
    this.#closed = true;
    clearInterval(this.#timer);
    window.removeEventListener('scroll', this.layout, true);
    window.removeEventListener('resize', this.layout);
    document.removeEventListener('fullscreenchange', this.layout);
    this.button.remove();
  }
}
