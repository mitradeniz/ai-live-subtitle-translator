import { z } from './schema.ts';

export const PlaybackStateSchema = z.enum([
  'enabled',
  'disabled',
  'no-video',
  'unavailable',
]);
export type PlaybackState = z.infer<typeof PlaybackStateSchema>;
export type PlaybackOperation =
  'playback.enable' | 'playback.disable' | 'playback.status';
export type PlaybackHandler = (
  operation: PlaybackOperation,
) => Promise<PlaybackState>;

export const PlaybackControlSchema = z.discriminatedUnion('type', [
  z.strictObject({
    version: z.literal(1),
    type: z.literal('playback.start'),
    sessionId: z.uuid(),
  }),
  z.strictObject({ version: z.literal(1), type: z.literal('playback.stop') }),
  z.strictObject({
    version: z.literal(1),
    type: z.literal('playback.inspect'),
  }),
]);
