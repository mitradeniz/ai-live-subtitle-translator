import { browser } from 'wxt/browser';
import { ResponseSchema, type ErrorCode, type Request } from './protocol.ts';

type Command<T = Request> = T extends Request
  ? Omit<T, 'version' | 'requestId'>
  : never;

// CONTEXT: this script outlived an extension reload or update and can no
// longer reach the extension. RESPONSE: the reply did not match the protocol.
export type RequestFailure = ErrorCode | 'CONTEXT' | 'RESPONSE';
export class RequestError extends Error {
  readonly code: RequestFailure;
  constructor(code: RequestFailure) {
    super('Extension settings are unavailable.');
    this.name = 'RequestError';
    this.code = code;
  }
}
export function extensionAlive() {
  try {
    return Boolean(browser.runtime?.id);
  } catch {
    return false;
  }
}

export async function sendRequest(command: Command) {
  if (!extensionAlive()) throw new RequestError('CONTEXT');
  let response: unknown;
  try {
    response = await browser.runtime.sendMessage({
      ...command,
      version: 1,
      requestId: crypto.randomUUID(),
    });
  } catch {
    throw new RequestError(extensionAlive() ? 'UNAVAILABLE' : 'CONTEXT');
  }
  const parsed = ResponseSchema.safeParse(response);
  if (!parsed.success) throw new RequestError('RESPONSE');
  if (!parsed.data.ok) throw new RequestError(parsed.data.error);
  return parsed.data.data;
}
