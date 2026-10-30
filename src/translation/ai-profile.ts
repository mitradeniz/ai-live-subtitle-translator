import { z } from '../messaging/schema.ts';

export const AI_ORIGIN = 'https://api.openai.com';
export const AI_HOST = `${AI_ORIGIN}/*`;
export const AI_ENDPOINT = `${AI_ORIGIN}/v1/chat/completions`;
// A reviewed profile, not an arbitrary OpenAI-compatible URL or model picker.
export const AI_MODELS = ['gpt-5.4-mini', 'gpt-5.4-mini-2026-03-17'] as const;
export const AIProfileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  endpoint: z.literal(AI_ENDPOINT),
  model: z.enum(AI_MODELS),
});
export type AIProfile = z.infer<typeof AIProfileSchema>;
export const DEFAULT_AI_PROFILE: AIProfile = {
  schemaVersion: 1,
  endpoint: AI_ENDPOINT,
  model: AI_MODELS[1],
};
