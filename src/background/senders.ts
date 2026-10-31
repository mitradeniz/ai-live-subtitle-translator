import { z } from '../messaging/schema.ts';
import { BoundaryError } from './errors.ts';

// Only browser-supplied onMessage metadata is passed here, never message fields.
export type SenderPolicy = { extensionOrigin: string; firefox: boolean };

const SenderSchema = z.object({
  id: z.string(),
  url: z.string().max(8192),
  origin: z.string().max(512),
  // Browser document IDs are opaque: Chromium also emits unhyphenated hex IDs.
  documentId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^(?:[A-Za-z0-9_-]+|\{[a-fA-F0-9-]{36}\})$/)
    .optional(),
  documentLifecycle: z.literal('active').optional(),
  frameId: z.number().int().nonnegative().optional(),
  tab: z
    .object({
      id: z.number().int().nonnegative(),
      incognito: z.boolean().optional(),
    })
    .optional(),
});
export type ContentIdentity = {
  tabId: number;
  frameId: number;
  documentId: string;
  origin: string;
};
export type SenderIdentity =
  | { kind: 'ui'; page: 'popup' | 'options' }
  | { kind: 'content'; identity: ContentIdentity };

export function identifySender(
  raw: unknown,
  extensionId: string,
  policy?: SenderPolicy,
): SenderIdentity {
  const parsed = SenderSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.id !== extensionId ||
    parsed.data.tab?.incognito
  ) {
    throw new BoundaryError('FORBIDDEN');
  }
  const sender = parsed.data;
  const extensionOrigin =
    policy?.extensionOrigin ?? `chrome-extension://${extensionId}`;
  const firefox = policy?.firefox === true;
  if (!firefox && extensionOrigin !== `chrome-extension://${extensionId}`)
    throw new BoundaryError('FORBIDDEN');
  if (firefox && !/^moz-extension:\/\/[a-f0-9-]{36}$/i.test(extensionOrigin))
    throw new BoundaryError('FORBIDDEN');
  if (sender.origin === extensionOrigin) {
    const page =
      sender.url === `${extensionOrigin}/popup.html`
        ? 'popup'
        : sender.url === `${extensionOrigin}/options.html`
          ? 'options'
          : null;
    if (!page || (sender.frameId !== undefined && sender.frameId !== 0))
      throw new BoundaryError('FORBIDDEN');
    // Chrome's toolbar popup can omit document metadata entirely. Its exact
    // extension origin, URL and ID still come from the browser, not the message.
    const toolbarPopup =
      page === 'popup' &&
      sender.tab === undefined &&
      sender.frameId === undefined &&
      sender.documentId === undefined &&
      sender.documentLifecycle === undefined;
    if (
      !toolbarPopup &&
      (!sender.documentId || (!firefox && !sender.documentLifecycle))
    )
      throw new BoundaryError('FORBIDDEN');
    return { kind: 'ui', page };
  }
  let url: URL;
  try {
    url = new URL(sender.url);
  } catch {
    throw new BoundaryError('FORBIDDEN');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    sender.origin !== url.origin ||
    !sender.tab ||
    sender.frameId === undefined ||
    !sender.documentId ||
    (!firefox && !sender.documentLifecycle)
  )
    throw new BoundaryError('FORBIDDEN');
  return {
    kind: 'content',
    identity: {
      tabId: sender.tab.id,
      frameId: sender.frameId,
      documentId: sender.documentId,
      origin: sender.origin,
    },
  };
}
