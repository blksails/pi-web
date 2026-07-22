import type { PaneErrorCode, PaneErrorData } from "./contract.js";

export class PaneHostError extends Error {
  readonly code: PaneErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(code: PaneErrorCode, message: string, options: { readonly retryable?: boolean; readonly status?: number } = {}) {
    super(message);
    this.name = "PaneHostError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }

  toJSON(): PaneErrorData {
    return {
      code: this.code,
      message: this.message,
      ...(this.retryable ? { retryable: true } : {}),
      ...(this.status !== undefined ? { status: this.status } : {}),
    };
  }
}

export function asPaneHostError(error: unknown, fallback: PaneErrorCode = "HOST_UNAVAILABLE"): PaneHostError {
  return error instanceof PaneHostError
    ? error
    : new PaneHostError(fallback, error instanceof Error ? error.message : String(error));
}
