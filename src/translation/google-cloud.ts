import { z } from '../messaging/schema.ts';
import { TranslationFailure, type TranslationJob } from './contracts.ts';
import { paidJSON, validatePaidInput } from './paid-http.ts';
import { LANGUAGE_CODES, normalizeLanguage } from './languages.ts';

export const CLOUD_ORIGIN = 'https://translation.googleapis.com';
export const CLOUD_HOST = `${CLOUD_ORIGIN}/*`;
export const CLOUD_ENDPOINT = `${CLOUD_ORIGIN}/language/translate/v2`;
export const CLOUD_PROFILE = {
  schemaVersion: 1,
  endpoint: CLOUD_ENDPOINT,
  model: 'nmt',
} as const;
// Deliberately bounded documented subset (the picker languages); no network
// language discovery.
const languages = new Set(LANGUAGE_CODES);
export function cloudLanguage(
  value: string,
  source = false,
): string | undefined {
  if (source && value === 'auto') return undefined;
  const mapped = normalizeLanguage(value);
  if (!languages.has(mapped)) throw new TranslationFailure('LANGUAGE');
  return mapped;
}
const ResponseSchema = z.object({
  data: z.object({
    translations: z
      .array(
        z.object({
          translatedText: z
            .string()
            .min(1)
            .max(4000)
            .refine((text) => !!text.trim()),
          detectedSourceLanguage: z.string().max(35).optional(),
          model: z.string().max(128).optional(),
        }),
      )
      .min(1)
      .max(4),
  }),
});
export function parseCloudResponse(raw: unknown, job: TranslationJob) {
  const parsed = ResponseSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.data.translations.length !== job.items.length
  )
    throw new TranslationFailure('RESPONSE');
  // v2 returns one result per q, in input order. Never split or join cues.
  return {
    generation: job.generation,
    items: job.items.map((item, index) => ({
      id: item.id,
      revision: item.revision,
      text: parsed.data.data.translations[index]!.translatedText,
    })),
  };
}
export async function translateCloud(
  key: string,
  job: TranslationJob,
  source: string,
  target: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
  timeoutMs = 15_000,
) {
  validatePaidInput(key, job);
  const raw = await paidJSON(
    CLOUD_ENDPOINT,
    {
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        q: job.items.map((item) => item.text),
        source: cloudLanguage(source, true),
        target: cloudLanguage(target),
        format: 'text',
        model: 'nmt',
      }),
    },
    signal,
    request,
    timeoutMs,
  );
  return parseCloudResponse(raw, job);
}
