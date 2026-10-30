import type { CaptionTransform } from '../playback/cues.ts';

// Imported only by the explicitly separate mock build. No language translation.
export const mockTranslate: CaptionTransform = (cues, generation, signal) =>
  new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new Error('Cancelled'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve({
        generation,
        items: cues.map((cue) => ({
          id: cue.id,
          revision: cue.revision,
          text: `[MOCK] ${cue.text}`,
        })),
      });
    }, 120);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
