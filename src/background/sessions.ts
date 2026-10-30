import { BoundaryError } from './errors.ts';
import { identifySender, type ContentIdentity } from './senders.ts';

type Session = ContentIdentity & { expiresAt: number };

export class SessionRegistry {
  readonly #sessions = new Map<string, Session>();
  readonly #extensionId: string;
  readonly #now: () => number;
  readonly #onRevoke: (tabId: number) => void;
  constructor(
    extensionId: string,
    now: () => number = Date.now,
    onRevoke: (tabId: number) => void = () => {},
  ) {
    this.#extensionId = extensionId;
    this.#now = now;
    this.#onRevoke = onRevoke;
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
        this.#onRevoke(session.tabId);
        this.#sessions.delete(id);
      }
    }
    if (this.#sessions.size >= 128) throw new BoundaryError('BUSY');
    const id = crypto.randomUUID();
    this.#sessions.set(id, {
      ...sender.identity,
      expiresAt: this.#now() + 30 * 60_000,
    });
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

  revokeTab(tabId: number): void {
    this.#onRevoke(tabId);
    for (const [id, session] of this.#sessions)
      if (session.tabId === tabId) this.#sessions.delete(id);
  }

  #prune(): void {
    for (const [id, session] of this.#sessions)
      if (session.expiresAt <= this.#now()) {
        this.#onRevoke(session.tabId);
        this.#sessions.delete(id);
      }
  }
}
