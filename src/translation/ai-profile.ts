import { z } from '../messaging/schema.ts';

export const AI_ORIGIN = 'https://api.openai.com';
export const AI_HOST = `${AI_ORIGIN}/*`;
export const AI_ENDPOINT = `${AI_ORIGIN}/v1/chat/completions`;
export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
export const AI_MODELS = ['gpt-5.4-mini', 'gpt-5.4-mini-2026-03-17'] as const;
export const AI_PROFILES = [
  {
    name: 'OpenAI',
    endpoint: AI_ENDPOINT,
    models: AI_MODELS,
    defaultModel: AI_MODELS[1],
  },
  {
    name: 'DeepSeek',
    endpoint: DEEPSEEK_ENDPOINT,
    models: ['deepseek-flash'] as const,
    defaultModel: 'deepseek-flash',
  },
  {
    name: 'Gemini',
    endpoint: GEMINI_ENDPOINT,
    models: ['gemini-3.8-flash'] as const,
    defaultModel: 'gemini-3.8-flash',
  },
] as const;
// Endpoints and models are paired; no arbitrary compatible URL or remote discovery.
export const AIProfileSchema = z.discriminatedUnion('endpoint', [
  z.strictObject({
    schemaVersion: z.literal(1),
    endpoint: z.literal(AI_ENDPOINT),
    model: z.enum(AI_MODELS),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    endpoint: z.literal(DEEPSEEK_ENDPOINT),
    model: z.literal('deepseek-flash'),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    endpoint: z.literal(GEMINI_ENDPOINT),
    model: z.literal('gemini-3.8-flash'),
  }),
]);
export type AIProfile = z.infer<typeof AIProfileSchema>;
export const DEFAULT_AI_PROFILE: AIProfile = {
  schemaVersion: 1,
  endpoint: AI_ENDPOINT,
  model: AI_MODELS[1],
};
export function aiDefinition(profile: AIProfile) {
  return AI_PROFILES.find((item) => item.endpoint === profile.endpoint)!;
}
