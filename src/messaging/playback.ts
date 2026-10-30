import { z } from './schema.ts';

export const PlaybackStateSchema = z.enum([
  'enabled',
  'disabled',
  'no-video',
  'unavailable',
  'source-required',
]);
export type PlaybackState = z.infer<typeof PlaybackStateSchema>;
export type PlaybackOperation =
  'playback.enable' | 'playback.disable' | 'playback.status';
export type PlaybackHandler = (
  operation: PlaybackOperation,
  youtubeSourceConfirmed: boolean,
) => Promise<PlaybackState>;

export const PlaybackControlSchema = z.discriminatedUnion('type', [
  z.strictObject({
    version: z.literal(1),
    type: z.literal('playback.start'),
    sessionId: z.uuid(),
    youtubeSourceConfirmed: z.boolean().default(false),
  }),
  z.strictObject({ version: z.literal(1), type: z.literal('playback.stop') }),
  z.strictObject({
    version: z.literal(1),
    type: z.literal('playback.site-stop'),
  }),
  z.strictObject({
    version: z.literal(1),
    type: z.literal('playback.preferences'),
  }),
  z.strictObject({
    version: z.literal(1),
    type: z.literal('playback.translation-reset'),
  }),
  z.strictObject({
    version: z.literal(1),
    type: z.literal('playback.inspect'),
  }),
]);
