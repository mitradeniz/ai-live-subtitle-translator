import { z } from '../messaging/schema.ts';

export const GOOGLE_ORIGIN = 'https://translate.googleapis.com';
export const GOOGLE_HOST = `${GOOGLE_ORIGIN}/*`;
export const TranslationItemSchema = z.strictObject({
  id: z.string().min(1).max(128),
  revision: z.number().int().nonnegative(),
  text: z.string().min(1).max(1000),
});
export const TranslationJobSchema = z.strictObject({
  jobId: z.uuid(),
  generation: z.number().int().nonnegative(),
  items: z.array(TranslationItemSchema).min(1).max(4),
});
export type TranslationJob = z.infer<typeof TranslationJobSchema>;
export const TranslationErrorSchema = z.enum([
  'OFF',
  'PERMISSION',
  'LANGUAGE',
  'LIMIT',
  'BUSY',
  'BLOCKED',
  'TIMEOUT',
  'NETWORK',
  'RESPONSE',
  'CANCELLED',
]);
export type TranslationErrorCode = z.infer<typeof TranslationErrorSchema>;
export const TRANSLATION_MESSAGES: Record<TranslationErrorCode, string> = {
  OFF: 'Google translation is off. Showing original captions.',
  PERMISSION: 'Google access was removed. Showing original captions.',
  LANGUAGE: 'Unsupported Google language code. Showing original captions.',
  LIMIT: 'Local Google request limit reached. Showing original captions.',
  BUSY: 'Google is busy with another caption. Showing original captions.',
  BLOCKED:
    'Google denied or throttled access. Translation stopped for this browser session.',
  TIMEOUT: 'Google timed out. Showing original captions.',
  NETWORK: 'Google could not be reached. Showing original captions.',
  RESPONSE:
    'Google returned an unsupported response. Showing original captions.',
  CANCELLED: 'Translation cancelled. Showing original captions.',
};
export class TranslationFailure extends Error {
  readonly code: TranslationErrorCode;
  constructor(code: TranslationErrorCode) {
    super(TRANSLATION_MESSAGES[code]);
    this.code = code;
  }
}
