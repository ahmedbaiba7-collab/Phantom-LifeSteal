/**
 * Application errors carry a stable machine code alongside the HTTP status.
 * Clients branch on `code`, never on message text, and messages never disclose
 * whether an account exists.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (code: string, msg: string, details?: unknown) =>
  new AppError(400, code, msg, details);
export const unauthorized = (code = 'AUTH_REQUIRED', msg = 'Sign in to continue.') =>
  new AppError(401, code, msg);
export const forbidden = (code = 'FORBIDDEN', msg = 'You do not have access to this.') =>
  new AppError(403, code, msg);
export const notFound = (code = 'NOT_FOUND', msg = 'That does not exist.') =>
  new AppError(404, code, msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);
export const tooMany = (msg = 'Too many requests. Try again shortly.') =>
  new AppError(429, 'RATE_LIMITED', msg);
export const serverError = (msg = 'Something went wrong on our side.') =>
  new AppError(500, 'INTERNAL_ERROR', msg);
