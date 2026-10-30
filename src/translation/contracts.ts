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
  'AUTH',
  'QUOTA',
  'PROVIDER_REQUEST',
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
  AUTH: 'Provider rejected the key or account access. Check the key, enabled API, restrictions and billing in settings; save the key to resume. Showing original captions.',
  QUOTA:
    'Provider quota or balance is unavailable. Check your provider account; save the key only after resolving it. Showing original captions.',
  PROVIDER_REQUEST:
    'Provider rejected this configuration or language. Check the saved profile and language in settings. Showing original captions.',
  AI_KEY:
    'Provider key is missing or invalid. Enter it in settings. Showing original captions.',
  AI_PROFILE:
    'Unsupported AI profile. Check settings. Showing original captions.',
  AI_BLOCKED:
    'Provider access was stopped by an earlier key or quota failure. Requests stopped for this browser session. Check your account, then explicitly save the key to resume.',
  OFF: 'Selected provider translation is off. Showing original captions.',
  PERMISSION:
    'Provider access was removed. Restore it in settings and enable captions again. Showing original captions.',
  LANGUAGE:
    'Unsupported provider language code. Choose a supported source/target in settings and re-enable captions. Showing original captions.',
  LIMIT: 'Local provider request limit reached. Showing original captions.',
  BUSY: 'The provider is busy with another caption. Showing original captions.',
  BLOCKED:
    'Google denied or throttled access. Translation stopped for this browser session.',
  TIMEOUT:
    'The provider timed out. Check connectivity and re-enable captions. Showing original captions.',
  NETWORK:
    'The provider could not be reached. Check connectivity and re-enable captions. Showing original captions.',
  RESPONSE:
    'The provider returned an unsupported response. Re-enable captions to retry, or choose another engine in settings. Showing original captions.',
  CANCELLED: 'Translation cancelled. Showing original captions.',
};
export class TranslationFailure extends Error {
  readonly code: TranslationErrorCode;
  constructor(code: TranslationErrorCode) {
    super(TRANSLATION_MESSAGES[code]);
    this.code = code;
  }
}
