import { sendRequest } from '../messaging/client';
import type { CaptionTransform } from '../playback/cues';
import { TranslationFailure } from './contracts';
import { waitFor } from './retry';

export function providerTransform(sessionId: string): CaptionTransform {
  return async (cues, generation, signal, options) => {
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
      // Observed text has no future cue window; stabilize only that path.
      if (options?.observed !== false) await waitFor(300, signal);
      if (signal.aborted) throw new TranslationFailure('CANCELLED');
      if (cues.length > 4 || cues.some((cue) => cue.text.length > 1000))
        throw new TranslationFailure('LIMIT');
      const command = {
        type: 'content.translate' as const,
        sessionId,
        job: {
          jobId,
          generation,
          priority: options?.priority ?? ('current' as const),
          items: cues.map(({ id, revision, text }) => ({ id, revision, text })),
        },
      };
      dispatched = true;
      let data;
      try {
        data = await sendRequest(command);
      } catch {
        // One reconnect with the same job identity. Persisted trusted state decides
        // whether replay is safe; no loop keeps the worker alive.
        await waitFor(400, signal);
        data = await sendRequest(command);
      }
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
