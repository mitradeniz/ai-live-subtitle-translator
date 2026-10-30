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
  'AI_KEY',
  'AI_PROFILE',
  'AI_BLOCKED',
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
  AI_KEY:
    'AI key is missing or invalid. Enter it in settings. Showing original captions.',
  AI_PROFILE:
    'Unsupported AI profile. Check settings. Showing original captions.',
  AI_BLOCKED:
    'OpenAI rejected the key, account access, or quota. Requests stopped for this browser session. Check your account, then explicitly save the key to resume.',
  OFF: 'Selected provider translation is off. Showing original captions.',
  PERMISSION: 'Provider access was removed. Showing original captions.',
  LANGUAGE: 'Unsupported provider language code. Showing original captions.',
  LIMIT: 'Local provider request limit reached. Showing original captions.',
  BUSY: 'The provider is busy with another caption. Showing original captions.',
  BLOCKED:
    'Google denied or throttled access. Translation stopped for this browser session.',
  TIMEOUT: 'The provider timed out. Showing original captions.',
  NETWORK: 'The provider could not be reached. Showing original captions.',
  RESPONSE:
    'The provider returned an unsupported response. Showing original captions.',
  CANCELLED: 'Translation cancelled. Showing original captions.',
};
export class TranslationFailure extends Error {
  readonly code: TranslationErrorCode;
  constructor(code: TranslationErrorCode) {
    super(TRANSLATION_MESSAGES[code]);
    this.code = code;
  }
}
