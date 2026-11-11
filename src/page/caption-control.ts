import type { CaptionReason } from '../messaging/protocol.ts';
import type { PlaybackState } from '../messaging/playback.ts';
import { RequestError } from '../messaging/client.ts';

export interface CaptionResult {
  state: PlaybackState;
  reason?: CaptionReason | undefined;
}

export interface CaptionOutcome {
  // What the last request asked for.
  enable?: boolean;
  result?: CaptionResult;
  error?: unknown;
  // The display was switched from original-only so translation could start.
  displayChanged?: boolean;
}

export interface CaptionControlOptions {
  request(enabled: boolean): Promise<CaptionResult>;
  // Leaves original-only for a translated display, so one click on a
  // translation switch does what it says.
  translateDisplay?(): Promise<void>;
  wait?(ms: number): Promise<void>;
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// One switch shared by the edge button and the player menu. A click records
// what the person wants and shows it at once; a single worker then sends one
// request at a time until the running state matches the latest click. Quick
// clicks are never dropped or answered out of order, and the background's
// one-start-per-second limit is waited out instead of reported as an error.
export class CaptionControl {
  #want: boolean | undefined;
  #on = false;
  #run: Promise<CaptionOutcome> | undefined;
  #version = 0;
  #listeners = new Set<() => void>();
  private options: CaptionControlOptions;
  constructor(options: CaptionControlOptions) {
    this.options = options;
  }
  // The state to show: a pending click wins over the last known state.
  get on() {
    return this.#want ?? this.#on;
  }
  get busy() {
    return this.#run !== undefined;
  }
  // Changes with every click and every finished change. A status read passes
  // the value from when it started, so an answer that crossed a click is
  // ignored.
  get version() {
    return this.#version;
  }
  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  // A status read only updates the shown state while nothing is pending.
  observe(state: PlaybackState, since = this.#version) {
    if (this.#run || since !== this.#version) return;
    const on = state === 'enabled';
    if (on === this.#on) return;
    this.#on = on;
    this.#emit();
  }
  toggle() {
    return this.set(!this.on);
  }
  set(enable: boolean): Promise<CaptionOutcome> {
    this.#want = enable;
    this.#version++;
    this.#emit();
    this.#run ??= this.#work().finally(() => {
      this.#run = undefined;
      this.#version++;
      this.#want = undefined;
      this.#emit();
    });
    return this.#run;
  }
  dispose() {
    this.#listeners.clear();
    this.#want = undefined;
  }
  #emit() {
    for (const listener of this.#listeners) listener();
  }
  async #work(): Promise<CaptionOutcome> {
    const wait = this.options.wait ?? pause;
    let outcome: CaptionOutcome = {};
    let retries = 0;
    let requests = 0;
    let displayChanged = false;
    while (
      this.#want !== undefined &&
      this.#want !== this.#on &&
      requests++ < 12
    ) {
      const enable = this.#want;
      try {
        const result = await this.options.request(enable);
        this.#on = result.state === 'enabled';
        outcome = { enable, result, displayChanged };
        if (enable && !this.#on) {
          if (
            result.reason === 'original-only' &&
            !displayChanged &&
            this.options.translateDisplay
          ) {
            await this.options.translateDisplay();
            displayChanged = true;
            continue;
          }
          // It cannot start; stop and say why, unless a newer click asked
          // for something else.
          if (this.#want === enable) this.#want = undefined;
        }
      } catch (error) {
        if (
          error instanceof RequestError &&
          error.code === 'BUSY' &&
          retries++ < 4
        ) {
          await wait(1100);
          continue;
        }
        outcome = { enable, error, displayChanged };
        this.#want = undefined;
      }
      this.#emit();
    }
    return outcome;
  }
}

// Words for the result of a click, for the player menu or the edge button.
export function captionMessage(
  outcome: CaptionOutcome,
  place: 'menu' | 'edge',
): string {
  if (outcome.error !== undefined) {
    const code =
      outcome.error instanceof RequestError ? outcome.error.code : undefined;
    return code === 'CONTEXT'
      ? 'The extension was updated. Refresh this page to use it again.'
      : code === 'BUSY'
        ? 'The extension is busy. Try again in a moment.'
        : code === 'INVALID_SESSION' || code === 'FORBIDDEN'
          ? 'Open the extension popup to re-enable these tools.'
          : 'Video subtitles could not start. Try again.';
  }
  const result = outcome.result;
  if (!result) return '';
  switch (result.state) {
    case 'enabled':
      return outcome.displayChanged
        ? place === 'menu'
          ? 'Display changed to Original and translation. Change it in Subtitle style.'
          : 'Display changed to Original and translation. Change it in the player menu.'
        : place === 'edge'
          ? 'Video subtitles started.'
          : '';
    case 'disabled':
      return outcome.enable
        ? 'Video subtitles could not start. Try again.'
        : place === 'edge'
          ? 'Video subtitles stopped.'
          : '';
    case 'needs-restart':
      return result.reason === 'original-only'
        ? 'Subtitle display is set to Original only. Choose a display with translation.'
        : result.reason === 'no-provider'
          ? place === 'menu'
            ? 'Choose a translation provider above to translate subtitles.'
            : 'Choose a translation provider in the player menu or the popup.'
          : result.reason === 'provider-setup'
            ? 'Google translation is not set up yet. Turn it on in Settings.'
            : 'Subtitle translation stopped. Turn it on again to resume.';
    case 'key-required':
      return 'Add your provider key in settings, then try again.';
    case 'permission-required':
      return 'Allow provider access in settings, then try again.';
    case 'source-required':
      return 'Confirm the original YouTube caption track in Customize translation.';
    case 'no-video':
      return 'No supported video found on this page.';
    case 'unavailable':
      return 'Video subtitles could not start. Try again from the popup.';
  }
}
