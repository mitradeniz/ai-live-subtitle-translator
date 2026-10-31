// Page text is untrusted. Preserve nodes/listeners and never parse provider HTML.
export const EXCLUDED =
  'script,style,noscript,template,svg,math,video,audio,pre,code,kbd,samp,textarea,input,select,button,form,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],[translate="no"],.notranslate,translator-selection-popup,translator-player-shortcut,translator-page-tools,subtitle-translator-overlay,[data-page-translation]';
export function safeText(node: Text): boolean {
  const parent = node.parentElement;
  if (
    !parent ||
    parent.closest(EXCLUDED) ||
    !node.data.trim() ||
    !/\p{L}/u.test(node.data) ||
    node.data.length > 6000
  )
    return false;
  const style = getComputedStyle(parent);
  return (
    style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    parent.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })
  );
}
export function visibleText(node: Text): boolean {
  if (!node.isConnected || !safeText(node)) return false;
  const range = document.createRange();
  range.selectNodeContents(node);
  return [...range.getClientRects()].some(
    (rect) =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < innerHeight &&
      rect.right > 0 &&
      rect.left < document.documentElement.clientWidth,
  );
}
export function chunks(text: string): string[] {
  const result: string[] = [];
  while (text.length > 1000) {
    let end = text.lastIndexOf(' ', 999);
    if (end < 500) end = 999;
    else end++;
    // Do not split a surrogate pair.
    if (/[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
    result.push(text.slice(0, end));
    text = text.slice(end);
  }
  if (text) result.push(text);
  return result;
}
type Record = {
  node: Text;
  original: string;
  written: string;
  parts: string[];
  result: string[];
  span?: HTMLElement | undefined;
};
export class PageText {
  #records = new Map<Text, Record>();
  #visible = new Set<Element>();
  #parents = new Map<Element, Text[]>();
  #observer: IntersectionObserver;
  #mutation: MutationObserver;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #scanTimer: ReturnType<typeof setTimeout> | undefined;
  #scanning = false;
  #active = false;
  #closed = false;
  #busy = false;
  #epoch = 0;
  #characters = 0;
  #id = 0;
  #mode: 'bilingual' | 'translated';
  private translate: (
    items: { id: string; revision: number; text: string }[],
  ) => Promise<string[]>;
  private cancel: () => void;
  private status: (message: string) => void;
  constructor(
    mode: 'bilingual' | 'translated',
    translate: (
      items: { id: string; revision: number; text: string }[],
    ) => Promise<string[]>,
    cancel: () => void,
    status: (message: string) => void,
  ) {
    this.#mode = mode;
    this.translate = translate;
    this.cancel = cancel;
    this.status = status;
    this.#observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) this.#visible.add(entry.target);
          else this.#visible.delete(entry.target);
        }
        this.#schedule();
      },
      { rootMargin: '0px' },
    );
    this.#mutation = new MutationObserver((records) => {
      if (!this.#active) return;
      const changed = records.some((change) => {
        if (
          change.target instanceof Element &&
          change.target.closest(
            '[data-page-translation],translator-selection-popup,translator-player-shortcut,translator-page-tools,subtitle-translator-overlay',
          )
        )
          return false;
        if (change.type === 'characterData') {
          const record = this.#records.get(change.target as Text);
          return !record || record.node.data !== record.written;
        }
        return [...change.addedNodes, ...change.removedNodes].some(
          (node) =>
            !(
              node instanceof Element &&
              node.matches(
                '[data-page-translation],translator-selection-popup,translator-player-shortcut,translator-page-tools,subtitle-translator-overlay',
              )
            ),
        );
      });
      if (changed) this.#schedule(true);
    });
    window.addEventListener('scroll', this.#scroll, true);
    window.addEventListener('resize', this.#scroll);
  }
  get active() {
    return this.#active;
  }
  #scroll = () => this.#schedule();
  #rescan = false;
  #schedule(scan = false) {
    this.#rescan ||= scan;
    if (!this.#active || this.#closed || this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (this.#rescan) {
        this.#rescan = false;
        this.#scan();
      }
      void this.#pump();
    }, 160);
  }
  #scan() {
    if (this.#scanning) {
      this.#rescan = true;
      return;
    }
    this.#scanning = true;
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) =>
          node instanceof Element && node.matches(EXCLUDED)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      },
    );
    const parents = new Map<Element, Text[]>();
    let visited = 0;
    const step = () => {
      this.#scanTimer = undefined;
      if (!this.#active || this.#closed) {
        this.#scanning = false;
        return;
      }
      const started = performance.now();
      let count = 0;
      // Yield between small batches: course pages can contain large transcripts
      // and another translator can keep mutating the document during playback.
      while (visited < 12_000 && parents.size < 1500 && walker.nextNode()) {
        visited++;
        const node = walker.currentNode;
        if (node instanceof Text && safeText(node)) {
          const parent = node.parentElement!;
          const nodes = parents.get(parent) ?? [];
          if (nodes.length < 50) nodes.push(node);
          parents.set(parent, nodes);
          if (!this.#parents.has(parent)) this.#observer.observe(parent);
          this.#parents.set(parent, nodes);
        }
        if (++count >= 150 || performance.now() - started >= 4) {
          this.#scanTimer = setTimeout(step, 16);
          return;
        }
      }
      for (const parent of this.#parents.keys())
        if (!parents.has(parent)) {
          this.#observer.unobserve(parent);
          this.#visible.delete(parent);
        }
      this.#parents = parents;
      this.#scanning = false;
      this.#schedule();
    };
    step();
  }

  start() {
    if (this.#closed) return;
    this.#active = true;
    // An idle automatic logo must not watch every edit in a course application.
    this.#mutation.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    this.status('Translating visible text…');
    this.#scan();
    this.#schedule();
  }
  setMode(mode: 'bilingual' | 'translated') {
    this.#mode = mode;
    for (const record of this.#records.values()) this.#paint(record);
  }
  #paint(record: Record) {
    if (
      !this.#active ||
      !record.node.isConnected ||
      record.node.data !== record.written ||
      record.result.length !== record.parts.length
    )
      return;
    const translated = record.result.join('');
    if (
      this.#mode === 'translated' &&
      record.node.data === translated &&
      !record.span
    )
      return;
    if (
      this.#mode === 'bilingual' &&
      record.node.data === record.original &&
      record.span?.isConnected &&
      record.span.textContent === translated
    )
      return;
    record.span?.remove();
    record.span = undefined;
    if (this.#mode === 'translated') {
      record.node.data = translated;
      record.written = translated;
    } else {
      record.node.data = record.original;
      record.written = record.original;
      const span = document.createElement('span');
      span.dataset.pageTranslation = '';
      span.dir = 'auto';
      span.textContent = translated;
      span.style.cssText = `color:inherit;opacity:.92;border-left:2px solid #8faef2;padding-left:.5em;margin:.25em 0 .25em .5em;white-space:pre-wrap;${record.node.parentElement?.childNodes.length === 1 ? 'display:block' : 'display:inline'}`;
      record.node.after(span);
      record.span = span;
    }
  }
  async #pump() {
    if (!this.#active || this.#busy || this.#closed) return;
    const epoch = this.#epoch;
    const tasks: {
      record: Record;
      index: number;
      id: string;
      revision: number;
      text: string;
    }[] = [];
    let characters = 0;
    for (const parent of this.#visible)
      for (const node of this.#parents.get(parent) ?? []) {
        if (!visibleText(node)) continue;
        let record = this.#records.get(node);
        if (record && node.data !== record.written) {
          record.span?.remove();
          this.#records.delete(node);
          record = undefined;
        }
        if (!record) {
          if (
            this.#records.size >= 300 ||
            this.#characters + node.data.length > 60_000
          )
            continue;
          record = {
            node,
            original: node.data,
            written: node.data,
            parts: chunks(node.data),
            result: [],
          };
          this.#records.set(node, record);
          this.#characters += node.data.length;
        }
        if (record.result.length === record.parts.length) {
          this.#paint(record);
          continue;
        }
        for (let i = record.result.length; i < record.parts.length; i++) {
          const text = record.parts[i]!;
          if (tasks.length >= 4 || characters + text.length > 2000) break;
          tasks.push({
            record,
            index: i,
            id: `page-${++this.#id}`,
            revision: epoch,
            text,
          });
          characters += text.length;
        }
        if (tasks.length >= 4) break;
      }
    if (!tasks.length) {
      this.status(
        this.#characters >= 60_000 || this.#records.size >= 300
          ? 'Page limit reached. Restore originals or reload to start a new session.'
          : 'Visible text ready. Scroll to translate more.',
      );
      return;
    }
    this.#busy = true;
    try {
      const results = await this.translate(
        tasks.map(({ id, revision, text }) => ({ id, revision, text })),
      );
      if (epoch !== this.#epoch || !this.#active || this.#closed) return;
      for (let i = 0; i < tasks.length; i++) {
        const { record, index } = tasks[i]!;
        if (
          record.node.data !== record.written ||
          this.#records.get(record.node) !== record
        )
          continue;
        record.result[index] = results[i]!;
        this.#paint(record);
      }
    } catch (error) {
      if (epoch === this.#epoch) {
        this.#active = false;
        this.#mutation.disconnect();
        this.status(
          error instanceof Error ? error.message : 'Translation paused.',
        );
      }
    } finally {
      this.#busy = false;
      this.#schedule();
    }
  }
  restore() {
    this.#active = false;
    this.#mutation.disconnect();
    this.#epoch++;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    clearTimeout(this.#scanTimer);
    this.#scanTimer = undefined;
    this.#scanning = false;
    this.cancel();
    for (const record of this.#records.values()) {
      record.span?.remove();
      record.span = undefined;
      if (record.node.data === record.written)
        record.node.data = record.original;
      record.written = record.original;
    }
    this.status('Original page restored.');
  }
  dispose() {
    this.restore();
    this.#closed = true;
    this.#observer.disconnect();
    this.#mutation.disconnect();
    window.removeEventListener('scroll', this.#scroll, true);
    window.removeEventListener('resize', this.#scroll);
    this.#records.clear();
    this.#parents.clear();
    this.#visible.clear();
  }
}
