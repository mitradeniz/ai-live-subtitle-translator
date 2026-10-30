import type { ErrorCode } from '../messaging/protocol.ts';

export class BoundaryError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    super(code);
    this.code = code;
  }
}
