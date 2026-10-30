import { browser } from 'wxt/browser';
import { ResponseSchema, type Request } from './protocol.ts';

type Command<T = Request> = T extends Request
  ? Omit<T, 'version' | 'requestId'>
  : never;

export async function sendRequest(command: Command) {
  const response: unknown = await browser.runtime.sendMessage({
    ...command,
    version: 1,
    requestId: crypto.randomUUID(),
  });
  const parsed = ResponseSchema.safeParse(response);
  if (!parsed.success || !parsed.data.ok)
    throw new Error('Extension settings are unavailable.');
  return parsed.data.data;
}
