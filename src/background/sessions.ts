import { z } from '../messaging/schema.ts';
import type { TrustedStorage } from './storage.ts';
import { BoundaryError } from './errors.ts';
import { identifySender, type ContentIdentity } from './senders.ts';

const Saved = z
  .array(
    z.tuple([
      z.uuid(),
      z.strictObject({
        tabId: z.number().int().nonnegative(),
        frameId: z.number().int().nonnegative(),
        documentId: z.string().min(1).max(128),
        origin: z
          .string()
          .max(512)
          .refine((v) => {
            try {
              const u = new URL(v);
              return ['http:', 'https:'].includes(u.protocol) && u.origin === v;
            } catch {
              return false;
            }
          }),
        expiresAt: z.number().finite(),
      }),
    ]),
  )
  .max(128);
type Session = ContentIdentity & { expiresAt: number };

export class SessionRegistry {
  readonly ready: Promise<void>;
  #storage: TrustedStorage | undefined;
  #dirty = false;
  #writes: Promise<void> = Promise.resolve();
  readonly #sessions = new Map<string, Session>();
  readonly #extensionId: string;
  readonly #key: string;
  readonly #now: () => number;
  readonly #onRevoke: (tabId: number, sessionId: string) => void;
  constructor(
    extensionId: string,
    now: () => number = Date.now,
    onRevoke: (tabId: number, sessionId: string) => void = () => {},
    storage?: TrustedStorage,
    key = 'playback-sessions.v1',
  ) {
    this.#extensionId = extensionId;
    this.#key = key;
    this.#now = now;
    this.#onRevoke = onRevoke;
    this.#storage = storage;
    this.ready = storage
      ? storage.run(async ({ session }) => {
          const parsed = Saved.safeParse(
            (await session.get(this.#key))[this.#key],
          );
          if (parsed.success && !this.#dirty)
            for (const [id, item] of parsed.data)
              if (item.expiresAt > now() && item.expiresAt <= now() + 1_800_000)
                this.#sessions.set(id, item);
          await session.set({ [this.#key]: Array.from(this.#sessions) });
        })
      : Promise.resolve();
    void this.ready.catch(() => {});
  }

  // Background-only activation hook. No runtime message grants a session.
  // Call only after a deliberate user-authorized activation.
  grant(browserSender: unknown): string {
    const sender = identifySender(browserSender, this.#extensionId);
    if (sender.kind !== 'content') throw new BoundaryError('FORBIDDEN');
    this.#prune();
    for (const [id, session] of this.#sessions) {
      if (
        session.tabId === sender.identity.tabId &&
        session.frameId === sender.identity.frameId
      ) {
        this.#onRevoke(session.tabId, id);
        this.#sessions.delete(id);
      }
    }
    if (this.#sessions.size >= 128) throw new BoundaryError('BUSY');
    const id = crypto.randomUUID();
    this.#sessions.set(id, {
      ...sender.identity,
      expiresAt: this.#now() + 30 * 60_000,
    });
    this.#persist();
    return id;
  }

  assertBound(id: string, identity: ContentIdentity): void {
    this.#prune();
    const session = this.#sessions.get(id);
    if (
      !session ||
      session.tabId !== identity.tabId ||
      session.frameId !== identity.frameId ||
      session.documentId !== identity.documentId ||
      session.origin !== identity.origin
    ) {
      throw new BoundaryError('INVALID_SESSION');
    }
  }

  revokeOrigin(origin: string): void {
    for (const [id, session] of this.#sessions)
      if (session.origin === origin) {
        this.#onRevoke(session.tabId, id);
        this.#sessions.delete(id);
      }
    this.#persist();
  }
  interruptAll(): void {
    for (const [id, session] of this.#sessions)
      this.#onRevoke(session.tabId, id);
  }
  revokeAll(): void {
    for (const [id, session] of this.#sessions)
      this.#onRevoke(session.tabId, id);
    this.#sessions.clear();
    this.#persist();
  }

  revokeTab(tabId: number): void {
    for (const [id, session] of this.#sessions)
      if (session.tabId === tabId) {
        this.#onRevoke(tabId, id);
        this.#sessions.delete(id);
      }
    this.#persist();
  }

  #persist() {
    this.#dirty = true;
    if (!this.#storage) return;
    this.#writes = this.#writes
      .then(() => this.ready)
      .then(() =>
        this.#storage!.run(({ session }) =>
          session.set({ [this.#key]: Array.from(this.#sessions) }),
        ),
      );
    // Dispatch/activation awaits flush, which propagates failures closed.
    void this.#writes.catch(() => {});
  }
  async flush() {
    await this.ready;
    await this.#writes;
  }
  #prune(): void {
    for (const [id, session] of this.#sessions)
      if (session.expiresAt <= this.#now()) {
        this.#onRevoke(session.tabId, id);
        this.#sessions.delete(id);
      }
  }
}
