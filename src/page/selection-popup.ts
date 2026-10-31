import { EXCLUDED } from './dom.ts';

type Selected = { text: string; range: Range; snapshot: string };
function selected(): Selected | null {
  const selection = getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed)
    return null;
  const text = selection.toString();
  if (!text.trim() || text.length > 1000) return null;
  const range = selection.getRangeAt(0);
  const parent =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (!parent || parent.getRootNode() !== document || parent.closest(EXCLUDED))
    return null;
  // Bound the inspection even for a selection spanning a very large document.
  const walk = document.createTreeWalker(parent, NodeFilter.SHOW_ELEMENT);
  let count = 0;
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    if (++count > 2000) return null;
    if ((node as Element).matches(EXCLUDED) && range.intersectsNode(node))
      return null;
  }
  if (!range.getBoundingClientRect().height) return null;
  return { text, range: range.cloneRange(), snapshot: range.toString() };
}
function same(a: Selected | null, b: Selected | null) {
  return (
    a?.text === b?.text &&
    a?.range.startContainer === b?.range.startContainer &&
    a?.range.startOffset === b?.range.startOffset &&
    a?.range.endContainer === b?.range.endContainer &&
    a?.range.endOffset === b?.range.endOffset
  );
}

export class SelectionPopup {
  #host = document.createElement('translator-selection-popup');
  #panel = document.createElement('section');
  #source = document.createElement('p');
  #result = document.createElement('p');
  #status = document.createElement('p');
  #selected: Selected | null = null;
  #down: { before: Selected | null; x: number; y: number } | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pending: { selected: Selected; generation: number } | undefined;
  #generation = 0;
  #busy = false;
  #closed = false;
  constructor(
    private options: {
      t(text: string): string;
      recipient: string;
      translate(text: string): Promise<string>;
      settings(): Promise<void>;
    },
  ) {
    const shadow = this.#host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host{all:initial;color-scheme:dark}*{box-sizing:border-box}.panel{position:fixed;inset:auto;margin:0;width:380px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;padding:18px;border:1px solid #c8dcff40;border-radius:20px;background:linear-gradient(140deg,#26344af5,#101723f7);backdrop-filter:blur(20px);box-shadow:0 16px 48px #0006,inset 0 1px #ffffff18;color:#f0f4ff;font:14px/1.55 system-ui}header{display:flex;align-items:center;gap:10px}strong{flex:1;font-size:13px}.logo{padding:3px 5px;border:1px solid #d4e4ff65;border-radius:7px;background:linear-gradient(140deg,#9caec6aa,#24364c);font-weight:700}.source{font-size:13px;color:#c7d2e8}.result{background:#ffffff08;border:1px solid #ffffff15;border-radius:12px;padding:14px;font-size:17px}.result:empty{display:none}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}.status{font-size:12px;color:#e4d6ac}.status:empty{display:none}.recipient{font-size:10px;color:#b7c6df;border-top:1px solid #ffffff18;padding-top:10px;margin-bottom:0}button{font:inherit;color:inherit;background:#ffffff09;border:1px solid #ffffff20;border-radius:8px;cursor:pointer;padding:4px 8px}button:hover{background:#ffffff20}button:focus-visible{outline:2px solid #b6d4ff;outline-offset:2px}footer{display:flex;justify-content:flex-end}`;
    this.#panel.className = 'panel';
    this.#panel.popover = 'auto';
    this.#panel.setAttribute('role', 'dialog');
    this.#panel.setAttribute(
      'aria-label',
      options.t('Selected text translation'),
    );
    const header = document.createElement('header');
    const logo = document.createElement('span');
    logo.className = 'logo';
    logo.textContent = 'A文';
    const title = document.createElement('strong');
    title.textContent = options.t('Selected text translation');
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', options.t('Close'));
    close.addEventListener('click', (event) => {
      if (event.isTrusted) this.hide();
    });
    header.append(logo, title, close);
    this.#source.className = 'source';
    this.#source.dir = 'auto';
    this.#result.className = 'result';
    this.#result.dir = 'auto';
    this.#result.setAttribute('aria-live', 'polite');
    this.#status.className = 'status';
    this.#status.setAttribute('role', 'status');
    const recipient = document.createElement('p');
    recipient.className = 'recipient';
    recipient.textContent = options.recipient;
    const footer = document.createElement('footer');
    const settings = document.createElement('button');
    settings.type = 'button';
    settings.textContent = options.t('Settings');
    settings.addEventListener('click', (event) => {
      if (event.isTrusted)
        void options.settings().catch(() => {
          this.#status.textContent = options.t(
            'Open the extension popup to re-enable these tools.',
          );
        });
    });
    footer.append(settings);
    this.#panel.append(
      header,
      this.#source,
      this.#result,
      this.#status,
      footer,
      recipient,
    );
    shadow.append(style, this.#panel);
    (document.body ?? document.documentElement).append(this.#host);
    this.#panel.addEventListener('beforetoggle', (event) => {
      if ((event as ToggleEvent).newState === 'closed') this.#invalidate();
    });
    this.#panel.addEventListener('keydown', (event) => {
      if (event.isTrusted && event.key === 'Escape') this.hide();
      event.stopPropagation();
    });
    document.addEventListener('pointerdown', this.#pointerDown, true);
    document.addEventListener('pointerup', this.#pointerUp, true);
    window.addEventListener('scroll', this.#position, true);
    window.addEventListener('resize', this.#position);
  }
  #invalidate() {
    this.#generation++;
    clearTimeout(this.#timer);
    this.#pending = undefined;
    this.#selected = null;
    this.#source.textContent =
      this.#result.textContent =
      this.#status.textContent =
        '';
  }
  hide() {
    this.#invalidate();
    if (this.#panel.matches(':popover-open')) this.#panel.hidePopover();
  }
  #pointerDown = (event: PointerEvent) => {
    this.#down = undefined;
    if (
      !event.isTrusted ||
      event.button !== 0 ||
      event.pointerType !== 'mouse' ||
      this.#closed
    )
      return;
    if (!(event.target instanceof Element) || event.target.closest(EXCLUDED))
      return;
    this.hide();
    this.#down = { before: selected(), x: event.clientX, y: event.clientY };
  };
  #pointerUp = (event: PointerEvent) => {
    const down = this.#down;
    this.#down = undefined;
    if (!down || !event.isTrusted || event.button !== 0 || this.#closed) return;
    clearTimeout(this.#timer);
    const generation = this.#generation;
    this.#timer = setTimeout(() => {
      if (this.#closed || generation !== this.#generation) return;
      const value = selected();
      if (
        !value ||
        (same(value, down.before) &&
          Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4)
      )
        return;
      this.#selected = value;
      this.#pending = { selected: value, generation };
      this.#source.textContent = value.text;
      this.#result.textContent = '';
      this.#status.textContent = this.options.t('Translating selected text…');
      this.#panel.showPopover();
      this.#position();
      void this.#pump();
    }, 250);
  };
  async #pump() {
    if (this.#busy || !this.#pending || this.#closed) return;
    const job = this.#pending;
    this.#pending = undefined;
    this.#busy = true;
    const current = () =>
      !this.#closed &&
      job.generation === this.#generation &&
      this.#panel.matches(':popover-open') &&
      job.selected.range.startContainer.isConnected &&
      job.selected.range.toString() === job.selected.snapshot;
    try {
      if (!current()) return;
      const text = await this.options.translate(job.selected.text);
      if (current()) {
        this.#result.textContent = text;
        this.#status.textContent = '';
        this.#position();
      }
    } catch (error) {
      if (current())
        this.#status.textContent =
          error instanceof Error
            ? error.message
            : this.options.t('Translation unavailable.');
    } finally {
      if (!this.#closed && job.generation === this.#generation && !current())
        this.hide();
      this.#busy = false;
      if (this.#pending) void this.#pump();
    }
  }
  #position = () => {
    if (!this.#selected || !this.#panel.matches(':popover-open')) return;
    const rect = this.#selected.range.getBoundingClientRect();
    if (
      rect.bottom < 0 ||
      rect.top > innerHeight ||
      !this.#selected.range.startContainer.isConnected
    ) {
      this.hide();
      return;
    }
    const width = this.#panel.offsetWidth,
      height = this.#panel.offsetHeight;
    this.#panel.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, rect.left))}px`;
    const top =
      rect.bottom + 10 + height <= innerHeight - 12
        ? rect.bottom + 10
        : rect.top - height - 10;
    this.#panel.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, top))}px`;
  };
  dispose() {
    this.#closed = true;
    this.hide();
    document.removeEventListener('pointerdown', this.#pointerDown, true);
    document.removeEventListener('pointerup', this.#pointerUp, true);
    window.removeEventListener('scroll', this.#position, true);
    window.removeEventListener('resize', this.#position);
    this.#host.remove();
  }
}
