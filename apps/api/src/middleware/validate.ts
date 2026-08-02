import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { AppError } from '../lib/errors';

type Target = 'body' | 'query' | 'params';

/**
 * Nothing reaches a service until it has been through a schema. Zod strips
 * unknown keys rather than passing them through, so a client cannot smuggle
 * `{ role: "owner" }` into an object spread further down the call stack.
 */
export function validate(schema: ZodSchema, target: Target = 'body'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      return next(
        new AppError(
          422,
          'VALIDATION_FAILED',
          'Some fields need attention.',
          fieldErrors(result.error),
        ),
      );
    }

    // Reassign so downstream handlers see the parsed, coerced, stripped value.
    Object.defineProperty(req, target, { value: result.data, writable: true });
    next();
  };
}

function fieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
