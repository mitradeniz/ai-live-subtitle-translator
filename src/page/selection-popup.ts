import type { SelectionLanguages } from '../messaging/protocol.ts';
import { EXCLUDED } from './dom.ts';
import { createMark } from '../ui/mark.ts';
import { LANGUAGES } from '../translation/languages.ts';

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
  #recipient = document.createElement('p');
  #chip = document.createElement('button');
  #selected: Selected | null = null;
  #down: { before: Selected | null; x: number; y: number } | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pending:
    | { selected: Selected; generation: number; languages: SelectionLanguages }
    | undefined;
  #generation = 0;
  #busy = false;
  #closed = false;
  constructor(
    private options: {
      // 'auto' opens the card after a selection; 'click' first shows a small
      // icon next to the selection and sends nothing until it is clicked.
      mode: 'auto' | 'click';
      t(text: string): string;
      recipient: string;
      languages: SelectionLanguages;
      translate(text: string, languages: SelectionLanguages): Promise<string>;
      settings(): Promise<void>;
    },
  ) {
    const shadow = this.#host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host{all:initial;color-scheme:dark}*{box-sizing:border-box}.panel{position:fixed;inset:auto;margin:0;width:380px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;padding:16px;border:1px solid rgb(255 255 255 / 16%);border-radius:24px;background:linear-gradient(180deg,rgb(34 42 66 / 86%),rgb(14 18 32 / 92%));-webkit-backdrop-filter:blur(24px) saturate(170%);backdrop-filter:blur(24px) saturate(170%);box-shadow:inset 0 1px 0 rgb(255 255 255 / 24%),0 24px 50px -16px rgb(0 0 0 / 65%);color:#f3f6fc;font:14px/1.55 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}header{display:flex;align-items:center;gap:10px}strong{flex:1;font-size:13px;font-weight:650}.logo{display:grid;place-items:center;width:30px;height:30px;border-radius:10px;background:linear-gradient(180deg,rgb(255 255 255 / 22%),rgb(255 255 255 / 6%));box-shadow:inset 0 1px 0 rgb(255 255 255 / 45%),inset 0 0 0 1px rgb(255 255 255 / 14%)}.logo svg{width:22px;height:22px}.source{font-size:13px;color:rgb(226 233 247 / 72%)}.result{background:rgb(255 255 255 / 7%);border-radius:14px;box-shadow:inset 0 0 0 1px rgb(255 255 255 / 10%);padding:12px 14px;font-size:17px;font-weight:600}.result:empty{display:none}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}.status{font-size:12px;color:#ffe1b3}.status:empty{display:none}.recipient{font-size:11px;color:rgb(226 233 247 / 66%);border-top:1px solid rgb(255 255 255 / 12%);padding-top:10px;margin-bottom:0}button{font:inherit;color:inherit;background:rgb(255 255 255 / 9%);border:1px solid rgb(255 255 255 / 14%);border-radius:999px;cursor:pointer;padding:4px 12px;transition:background .2s,transform .4s cubic-bezier(.34,1.56,.64,1)}button:hover{background:rgb(255 255 255 / 18%)}button:active{transform:scale(.95)}select:focus-visible,button:focus-visible{outline:2px solid #9fd0ff;outline-offset:2px}footer{display:flex;justify-content:flex-end}.languages{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.languages label{font-size:11px;color:rgb(226 233 247 / 72%);min-width:0}.languages select{display:block;width:100%;margin-top:4px;padding:8px 10px;color:#f3f6fc;background:rgb(0 0 0 / 28%);border:1px solid rgb(255 255 255 / 12%);border-radius:12px;font:13px ui-sans-serif,system-ui,sans-serif}.languages select option{background:#141a2a}.chip{position:fixed;inset:auto;margin:0;padding:0;width:34px;height:34px;place-items:center;overflow:visible;border:1px solid rgb(255 255 255 / 22%);border-radius:12px;background:linear-gradient(180deg,rgb(46 56 88 / 90%),rgb(16 20 36 / 94%));-webkit-backdrop-filter:blur(18px) saturate(170%);backdrop-filter:blur(18px) saturate(170%);box-shadow:inset 0 1px 0 rgb(255 255 255 / 36%),0 10px 24px -8px rgb(0 0 0 / 60%);animation:chip .32s cubic-bezier(.34,1.56,.64,1)}.chip:popover-open{display:grid}.chip:hover{background:linear-gradient(180deg,rgb(62 74 112 / 92%),rgb(22 28 48 / 94%))}.chip svg{width:22px;height:22px}@keyframes chip{from{opacity:0;transform:scale(.6)}}@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}@media(prefers-reduced-transparency:reduce){.panel,.chip{-webkit-backdrop-filter:none;backdrop-filter:none;background:#141a2a}}`;
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
    logo.setAttribute('aria-hidden', 'true');
    logo.append(createMark(22));
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
    this.#recipient.className = 'recipient';
    this.#updateRecipient();
    const languages = this.#languageControls();
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
      languages,
      this.#source,
      this.#result,
      this.#status,
      footer,
      this.#recipient,
    );
    this.#chip.type = 'button';
    this.#chip.className = 'chip';
    this.#chip.popover = 'manual';
    this.#chip.title = options.t('Translate selection');
    this.#chip.setAttribute('aria-label', options.t('Translate selection'));
    this.#chip.append(createMark(22));
    this.#chip.addEventListener('click', (event) => {
      if (!event.isTrusted || this.#closed) return;
      this.#hideChip();
      this.#queue();
    });
    shadow.append(style, this.#panel, this.#chip);
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
    document.addEventListener('keydown', this.#keyDown, true);
    window.addEventListener('scroll', this.#position, true);
    window.addEventListener('resize', this.#position);
  }
  #updateRecipient() {
    this.#recipient.textContent = `${this.options.recipient} · ${this.options.languages.sourceLanguage} → ${this.options.languages.targetLanguage}`;
  }
  #languageControls() {
    const row = document.createElement('div');
    row.className = 'languages';
    const choices: [string, string][] = LANGUAGES.map(([code, name]) => [
      code,
      name,
    ]);
    for (const [key, title] of [
      ['sourceLanguage', 'Source language'],
      ['targetLanguage', 'Target language'],
    ] as const) {
      const label = document.createElement('label');
      label.textContent = this.options.t(title);
      const select = document.createElement('select');
      select.setAttribute('aria-label', this.options.t(title));
      const items =
        key === 'sourceLanguage'
          ? [['auto', this.options.t('Auto-detect')], ...choices]
          : [...choices];
      const value = this.options.languages[key];
      if (!items.some(([code]) => code === value)) items.push([value, value]);
      for (const [code, name] of items) {
        const option = document.createElement('option');
        option.value = code!;
        option.textContent = name!;
        select.append(option);
      }
      select.value = value;
      select.addEventListener('change', (event) => {
        event.stopPropagation();
        if (
          !event.isTrusted ||
          this.#closed ||
          !this.#selected ||
          !this.#panel.matches(':popover-open')
        )
          return;
        this.options.languages = {
          ...this.options.languages,
          [key]: select.value,
        };
        this.#updateRecipient();
        this.#queue();
      });
      label.append(select);
      row.append(label);
    }
    return row;
  }
  #queue() {
    if (!this.#selected) return;
    const generation = ++this.#generation;
    this.#pending = {
      selected: this.#selected,
      generation,
      languages: { ...this.options.languages },
    };
    this.#source.textContent = this.#selected.text;
    this.#result.textContent = '';
    this.#status.textContent = this.options.t('Translating selected text…');
    this.#panel.showPopover();
    this.#position();
    void this.#pump();
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
    this.#hideChip();
    if (this.#panel.matches(':popover-open')) this.#panel.hidePopover();
  }
  #hideChip() {
    if (this.#chip.matches(':popover-open')) this.#chip.hidePopover();
  }
  #keyDown = (event: KeyboardEvent) => {
    if (
      event.isTrusted &&
      event.key === 'Escape' &&
      this.#chip.matches(':popover-open')
    )
      this.hide();
  };
  #pointerDown = (event: PointerEvent) => {
    this.#down = undefined;
    if (!event.isTrusted || this.#closed) return;
    if (!(event.target instanceof Element) || event.target.closest(EXCLUDED))
      return;
    this.hide();
    if (event.button !== 0 || event.pointerType !== 'mouse') return;
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
      if (this.options.mode === 'auto') this.#queue();
      else {
        this.#chip.showPopover();
        this.#position();
      }
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
      const text = await this.options.translate(
        job.selected.text,
        job.languages,
      );
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
    if (this.#selected && this.#chip.matches(':popover-open')) {
      this.#placeChip(this.#selected);
      return;
    }
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
  // Sit just after the end of the selection, flipping above it near the
  // bottom edge, and go away once the selection scrolls out of view.
  #placeChip(selected: Selected) {
    const rects = selected.range.getClientRects();
    const rect =
      rects[rects.length - 1] ?? selected.range.getBoundingClientRect();
    if (
      rect.bottom < 0 ||
      rect.top > innerHeight ||
      !selected.range.startContainer.isConnected
    ) {
      this.hide();
      return;
    }
    const size = this.#chip.offsetWidth || 34;
    const left = Math.max(8, Math.min(innerWidth - size - 8, rect.right + 4));
    const top =
      rect.bottom + 6 + size <= innerHeight - 8
        ? rect.bottom + 6
        : rect.top - size - 6;
    this.#chip.style.left = `${left}px`;
    this.#chip.style.top = `${Math.max(8, Math.min(innerHeight - size - 8, top))}px`;
  }
  dispose() {
    this.#closed = true;
    this.hide();
    document.removeEventListener('pointerdown', this.#pointerDown, true);
    document.removeEventListener('pointerup', this.#pointerUp, true);
    document.removeEventListener('keydown', this.#keyDown, true);
    window.removeEventListener('scroll', this.#position, true);
    window.removeEventListener('resize', this.#position);
    this.#host.remove();
  }
}
