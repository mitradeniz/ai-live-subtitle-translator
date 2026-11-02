import { createMark } from '../ui/mark.ts';

export type HideScope = 'once' | 'site' | 'all';

export interface EdgeSettingsOptions {
  t(text: string): string;
  compact: boolean;
  selection: boolean;
  setCompact(value: boolean): Promise<void>;
  setSelection(value: boolean): Promise<void>;
  hide(scope: HideScope): Promise<void>;
  settings(): Promise<void>;
  close(): void;
}

// Styles shared with the page tools shadow root (which provides .panel,
// .switch, .primary and button basics).
export const EDGE_SETTINGS_CSS =
  '.edge-settings>*{flex-shrink:0}.edge-settings header{display:flex;align-items:center;justify-content:space-between;gap:8px}.edge-settings .x{width:30px;height:30px;padding:0;display:grid;place-items:center;font-size:18px;line-height:1;border-color:transparent;background:transparent;color:rgb(226 233 247 / 70%)}.edge-settings .x:hover{background:rgb(255 255 255 / 10%);color:#fff}' +
  '.preview{position:relative;height:64px;border-radius:16px;overflow:hidden;background:linear-gradient(135deg,rgb(127 233 195 / 14%),rgb(110 195 255 / 12%) 50%,rgb(194 177 255 / 16%)),rgb(0 0 0 / 22%);box-shadow:inset 0 0 0 1px rgb(255 255 255 / 10%)}.preview i{position:absolute;left:14px;height:6px;border-radius:3px;background:rgb(255 255 255 / 12%)}.preview i:nth-child(1){top:16px;width:46%}.preview i:nth-child(2){top:29px;width:62%}.preview i:nth-child(3){top:42px;width:38%}.preview span{position:absolute;top:13px;right:10px;display:grid;place-items:center;width:38px;height:38px;border-radius:13px;background:linear-gradient(180deg,rgb(255 255 255 / 20%),rgb(255 255 255 / 5%)),rgb(16 20 36 / 66%);box-shadow:inset 0 1px 0 rgb(255 255 255 / 50%),inset 0 0 0 1px rgb(255 255 255 / 14%);transition:all .35s cubic-bezier(.34,1.56,.64,1)}.preview span svg{width:24px;height:24px;transition:inherit}.preview[data-compact="true"] span{top:18px;right:-12px;width:28px;height:28px;border-radius:10px}.preview[data-compact="true"] span svg{width:18px;height:18px}' +
  '.edge-settings .switch{background:transparent;border-color:transparent;padding:8px 4px}.edge-settings .switch:hover{background:rgb(255 255 255 / 6%)}.edge-settings hr{width:100%;border:0;border-top:1px solid rgb(255 255 255 / 12%);margin:2px 0}' +
  '.scopes{display:flex;flex-direction:column;gap:4px;margin:0;padding:10px;border:0;border-radius:16px;background:rgb(255 255 255 / 6%);box-shadow:inset 0 0 0 1px rgb(255 255 255 / 8%)}.scopes label{display:flex;gap:10px;align-items:flex-start;padding:6px 4px;border-radius:10px;cursor:pointer}.scopes label:hover{background:rgb(255 255 255 / 6%)}.scopes input{margin:3px 0 0;accent-color:#9ad3ff;flex:none}.scopes small{display:block;margin-top:2px;font-size:11px;color:rgb(226 233 247 / 60%)}.scopes .primary{margin-top:6px}.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}';

function switchButton(t: (text: string) => string, label: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'switch';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', 'false');
  const name = document.createElement('span');
  name.textContent = t(label);
  const track = document.createElement('span');
  track.className = 'track';
  track.setAttribute('aria-hidden', 'true');
  track.append(document.createElement('span'));
  button.append(name, track);
  return button;
}

// The edge button's own settings, opened from its hover × helper.
export class EdgeSettings {
  readonly element = document.createElement('section');
  #status = document.createElement('p');
  #preview = document.createElement('div');
  #compact: HTMLButtonElement;
  #hide: HTMLButtonElement;
  #selection: HTMLButtonElement;
  #scopes = document.createElement('fieldset');
  #busy = false;
  constructor(private options: EdgeSettingsOptions) {
    const { t } = options;
    this.element.className = 'sheet edge-settings';
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', t('Edge button settings'));
    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.textContent = t('Edge button settings');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'x';
    close.textContent = '×';
    close.setAttribute('aria-label', t('Close'));
    close.addEventListener('click', (event) => {
      if (event.isTrusted) options.close();
    });
    header.append(title, close);
    this.#preview.className = 'preview';
    this.#preview.setAttribute('aria-hidden', 'true');
    const mark = document.createElement('span');
    mark.append(createMark(24));
    this.#preview.append(
      document.createElement('i'),
      document.createElement('i'),
      document.createElement('i'),
      mark,
    );
    this.#compact = switchButton(t, 'Make the button smaller');
    this.#compact.addEventListener('click', (event) => {
      if (!event.isTrusted || this.#busy) return;
      const value = this.#compact.getAttribute('aria-checked') !== 'true';
      void this.#run(() => options.setCompact(value)).then((ok) => {
        if (ok) this.update({ compact: value });
      });
    });
    this.#hide = switchButton(t, 'Hide the button');
    this.#hide.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      const open = this.#hide.getAttribute('aria-checked') !== 'true';
      this.#hide.setAttribute('aria-checked', String(open));
      this.#scopes.hidden = !open;
      if (open) this.#scopes.querySelector('input')?.focus();
    });
    this.#scopes.className = 'scopes';
    this.#scopes.hidden = true;
    const legend = document.createElement('legend');
    legend.className = 'visually-hidden';
    legend.textContent = t('Where to hide the button');
    this.#scopes.append(legend);
    for (const [value, label, hint] of [
      ['once', 'Hide until this page is reloaded', ''],
      [
        'site',
        'Hide on this site',
        'Show it again from the extension popup → Page translation.',
      ],
      [
        'all',
        'Turn off on all sites',
        'Turn it back on from the extension popup → Page translation.',
      ],
    ] as const) {
      const row = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'edge-hide-scope';
      input.value = value;
      input.checked = value === 'once';
      const text = document.createElement('span');
      text.textContent = t(label);
      if (hint) {
        const small = document.createElement('small');
        small.textContent = t(hint);
        text.append(small);
      }
      row.append(input, text);
      this.#scopes.append(row);
    }
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'primary';
    confirm.textContent = t('Hide the button');
    confirm.addEventListener('click', (event) => {
      if (!event.isTrusted || this.#busy) return;
      const scope = (this.#scopes.querySelector<HTMLInputElement>(
        'input:checked',
      )?.value ?? 'once') as HideScope;
      void this.#run(() => options.hide(scope));
    });
    this.#scopes.append(confirm);
    const divider = document.createElement('hr');
    this.#selection = switchButton(t, 'Selected text marker');
    this.#selection.addEventListener('click', (event) => {
      if (!event.isTrusted || this.#busy) return;
      const value = this.#selection.getAttribute('aria-checked') !== 'true';
      void this.#run(() => options.setSelection(value)).then((ok) => {
        if (ok) this.update({ selection: value });
      });
    });
    const settings = document.createElement('button');
    settings.type = 'button';
    settings.className = 'wide';
    settings.textContent = t('Open settings');
    settings.addEventListener('click', (event) => {
      if (event.isTrusted) void this.#run(() => options.settings());
    });
    this.#status.className = 'status';
    this.#status.setAttribute('role', 'status');
    this.element.append(
      header,
      this.#preview,
      this.#compact,
      this.#hide,
      this.#scopes,
      divider,
      this.#selection,
      settings,
      this.#status,
    );
    this.update({ compact: options.compact, selection: options.selection });
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        options.close();
      }
    });
  }
  update(state: { compact?: boolean; selection?: boolean }) {
    if (state.compact !== undefined) {
      this.#compact.setAttribute('aria-checked', String(state.compact));
      this.#preview.dataset.compact = String(state.compact);
    }
    if (state.selection !== undefined)
      this.#selection.setAttribute('aria-checked', String(state.selection));
  }
  // Each panel opening starts with the hide choices folded away.
  reset() {
    this.#hide.setAttribute('aria-checked', 'false');
    this.#scopes.hidden = true;
    this.#status.textContent = '';
  }
  focus() {
    this.element.querySelector<HTMLButtonElement>('.switch')?.focus();
  }
  async #run(action: () => Promise<void>) {
    this.#busy = true;
    this.#status.textContent = '';
    try {
      await action();
      return true;
    } catch {
      this.#status.textContent = this.options.t(
        'Could not save. Try again from the extension popup.',
      );
      return false;
    } finally {
      this.#busy = false;
    }
  }
}
