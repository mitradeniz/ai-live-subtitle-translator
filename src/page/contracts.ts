import { z } from '../messaging/schema.ts';
export const PageFeatureSchema = z.enum([
  'page',
  'selection',
  'hover',
  'input',
  'writing',
]);
export const WritingStyleSchema = z.enum([
  'polish',
  'concise',
  'formal',
  'draft',
]);
export type WritingStyle = z.infer<typeof WritingStyleSchema>;
export const PagePreferencesSchema = z.strictObject({
  page: z.boolean().default(true),
  captions: z.boolean().default(true),
  youtubeSourceConfirmed: z.boolean().default(false),
  selection: z.boolean().default(false),
  hover: z.boolean().default(false),
  input: z.boolean().default(false),
  writing: z.boolean().default(false),
  clickAction: z
    .enum(['page', 'captions', 'selection', 'input', 'writing'])
    .default('page'),
  display: z.enum(['bilingual', 'translated']).default('bilingual'),
});
export type PagePreferences = z.infer<typeof PagePreferencesSchema>;
export const DEFAULT_PAGE_PREFERENCES = PagePreferencesSchema.parse({});
export const PageStateSchema = z.enum([
  'off',
  'ready',
  'translating',
  'translated',
  'paused',
  'unavailable',
]);
export type PageState = z.infer<typeof PageStateSchema>;
export const PageControlSchema = z.discriminatedUnion('type', [
  z.strictObject({
    version: z.literal(1),
    type: z.literal('page.start'),
    sessionId: z.uuid(),
    run: z.boolean(),
  }),
  ...(['page.stop', 'page.inspect', 'page.reset'] as const).map((type) =>
    z.strictObject({ version: z.literal(1), type: z.literal(type) }),
  ),
]);
export type PageHandler = (
  operation: 'page.enable' | 'page.disable' | 'page.status',
  run: boolean,
) => Promise<PageState>;
