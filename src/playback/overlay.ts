export class CaptionOverlay {
  readonly host = document.createElement('subtitle-translator-overlay');
  #caption = document.createElement('div');
  #label = document.createElement('div');
  #video: HTMLVideoElement;
  #text = '';

  constructor(video: HTMLVideoElement, fontSize: number, label: string) {
    this.#video = video;
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host { all: initial; position: fixed; display: block; pointer-events: none; z-index: 2147483647; }
      .wrap { display: flex; flex-direction: column; align-items: center; justify-content: end; height: 100%; box-sizing: border-box; padding: 16px 5% 64px; }
      .caption { white-space: pre-line; overflow-wrap: anywhere; text-align: center; color: #fff; background: #080d16eb; border: 1px solid #ffffff30; border-radius: 12px; padding: 8px 16px; font: 600 ${fontSize}px/1.4 system-ui,sans-serif; max-width: 100%; max-height: 65%; overflow: hidden; text-shadow: 0 2px 4px #000; }
      .caption:empty { display: none; }
      .label { font: 600 11px/1.5 system-ui,sans-serif; color: #e2e8ff; background: #10172fe8; border-radius: 6px; padding: 3px 8px; margin-bottom: 6px; }
      .label:empty { display: none; }`;
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    this.#caption.className = 'caption';
    this.#caption.dir = 'auto';
    this.#label.className = 'label';
    this.#label.textContent = label;
    wrap.append(this.#label, this.#caption);
    shadow.append(style, wrap);
    this.layout();
  }

  layout() {
    const fullscreen = document.fullscreenElement;
    // A video is a replaced element: DOM overlays cannot paint in its native fullscreen.
    const unsupported =
      fullscreen === this.#video ||
      (fullscreen !== null && !fullscreen.contains(this.#video));
    const parent =
      !unsupported && fullscreen ? fullscreen : document.documentElement;
    if (this.host.parentElement !== parent) parent.append(this.host);
    const rect = this.#video.getBoundingClientRect();
    this.host.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;display:${unsupported || rect.width === 0 || rect.height === 0 ? 'none' : 'block'}`;
  }

  render(text: string) {
    if (text !== this.#text) {
      this.#caption.textContent = text;
      this.#text = text;
    }
  }

  dispose() {
    this.host.remove();
  }
}
