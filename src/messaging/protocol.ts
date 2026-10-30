import { z } from './schema.ts';
import { PlaybackStateSchema } from './playback.ts';

const language = z
  .string()
  .min(2)
  .max(35)
  .regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/);
export const PreferencesSchema = z.strictObject({
  sourceLanguage: z.union([z.literal('auto'), language]),
  targetLanguage: language.refine((value) => value !== 'auto'),
  displayMode: z.enum(['bilingual', 'translated', 'original']),
  fontSize: z.number().int().min(16).max(48),
});
export const SettingsSchema = PreferencesSchema.extend({
  schemaVersion: z.literal(1),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  sourceLanguage: 'auto',
  targetLanguage: 'tr',
  displayMode: 'bilingual',
  fontSize: 24,
};

export const CredentialIdSchema = z.enum(['ai', 'google-cloud']);
export type CredentialId = z.infer<typeof CredentialIdSchema>;
export const OriginSchema = z
  .string()
  .max(256)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.origin === value &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  });
export const CredentialRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  origin: OriginSchema,
  key: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^\S+$/)
    .refine((value) =>
      [...value].every((character) => {
        const code = character.charCodeAt(0);
        return code > 31 && code !== 127;
      }),
    ),
});

const envelope = {
  version: z.literal(1),
  requestId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[\w-]+$/),
};
const sessionId = z.uuid();
export const RequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelope,
    type: z.literal('playback.enable'),
    youtubeSourceConfirmed: z.boolean().default(false),
  }),
  z.strictObject({ ...envelope, type: z.literal('playback.disable') }),
  z.strictObject({ ...envelope, type: z.literal('playback.status') }),
  z.strictObject({ ...envelope, type: z.literal('settings.read') }),
  z.strictObject({
    ...envelope,
    type: z.literal('settings.update'),
    preferences: PreferencesSchema,
  }),
  z.strictObject({ ...envelope, type: z.literal('settings.export') }),
  z.strictObject({
    ...envelope,
    type: z.literal('credentials.set'),
    credentialId: CredentialIdSchema,
    credential: CredentialRecordSchema,
    rememberOnDevice: z.boolean().default(false),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('credentials.delete'),
    credentialId: CredentialIdSchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('credentials.status'),
    credentialId: CredentialIdSchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('content.settings'),
    sessionId,
  }),
]);
export type Request = z.infer<typeof RequestSchema>;
export const SettingsExportSchema = z.strictObject({
  format: z.literal('subtitle-translator-settings'),
  schemaVersion: z.literal(1),
  settings: SettingsSchema,
});
export const CredentialStatusSchema = z.strictObject({
  configured: z.boolean(),
  retention: z.enum(['session', 'device']).nullable(),
});
export const ErrorCodeSchema = z.enum([
  'INVALID_MESSAGE',
  'FORBIDDEN',
  'INVALID_SESSION',
  'UNAVAILABLE',
  'UNSUPPORTED_SETTINGS_VERSION',
  'BUSY',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export const ResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    data: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('playback'),
        state: PlaybackStateSchema,
      }),
      z.strictObject({ kind: z.literal('settings'), settings: SettingsSchema }),
      z.strictObject({
        kind: z.literal('export'),
        exported: SettingsExportSchema,
      }),
      z.strictObject({
        kind: z.literal('credential-status'),
        status: CredentialStatusSchema,
      }),
      z.strictObject({ kind: z.literal('saved') }),
      z.strictObject({ kind: z.literal('deleted') }),
    ]),
  }),
  z.strictObject({ ok: z.literal(false), error: ErrorCodeSchema }),
]);
export type Response = z.infer<typeof ResponseSchema>;

// Bound work before schema parsing. Reject non-JSON objects, accessors and deep trees.
export function withinMessageBudget(value: unknown): boolean {
  let nodes = 0;
  let bytes = 0;
  const encoder = new TextEncoder();
  const seen = new Set<object>();
  function visit(item: unknown, depth: number): boolean {
    if (++nodes > 256 || depth > 6) return false;
    if (typeof item === 'string') {
      if (item.length > 4096) return false;
      bytes += encoder.encode(item).length;
      return bytes <= 16_384;
    }
    if (item === null || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (typeof item !== 'object' || seen.has(item)) return false;
    const prototype = Object.getPrototypeOf(item);
    if (
      !Array.isArray(item) &&
      prototype !== Object.prototype &&
      prototype !== null
    )
      return false;
    seen.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (typeof key !== 'string' || key.length > 64) return false;
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (
        !descriptor ||
        !('value' in descriptor) ||
        !visit(key, depth + 1) ||
        !visit(descriptor.value, depth + 1)
      )
        return false;
    }
    return true;
  }
  try {
    return visit(value, 0);
  } catch {
    return false;
  }
}
