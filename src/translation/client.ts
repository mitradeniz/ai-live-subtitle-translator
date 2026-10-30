import { sendRequest } from '../messaging/client';
import type { CaptionTransform } from '../playback/cues';
import { TranslationFailure } from './contracts';

export function providerTransform(sessionId: string): CaptionTransform {
  return async (cues, generation, signal) => {
    const jobId = crypto.randomUUID();
    let dispatched = false;
    const cancel = () => {
      if (dispatched)
        void sendRequest({ type: 'content.cancel', sessionId, jobId }).catch(
          () => {},
        );
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      // Stabilize rolling captions before sending text off the device.
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new TranslationFailure('CANCELLED'));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve();
        }, 300);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      if (signal.aborted) throw new TranslationFailure('CANCELLED');
      if (cues.length > 4 || cues.some((cue) => cue.text.length > 1000))
        throw new TranslationFailure('LIMIT');
      dispatched = true;
      const data = await sendRequest({
        type: 'content.translate',
        sessionId,
        job: {
          jobId,
          generation,
          items: cues.map(({ id, revision, text }) => ({ id, revision, text })),
        },
      });
      if (signal.aborted) throw new TranslationFailure('CANCELLED');
      if (data.kind !== 'translation') throw new TranslationFailure('RESPONSE');
      if (!data.result.ok) throw new TranslationFailure(data.result.error);
      return data.result;
    } catch (error) {
      if (error instanceof TranslationFailure) throw error;
      throw new TranslationFailure('OFF');
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  };
}
