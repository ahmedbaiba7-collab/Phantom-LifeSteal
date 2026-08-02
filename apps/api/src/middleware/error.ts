import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { isProd } from '../config/env';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `No route matches ${req.method} ${req.path}.`,
      requestId: req.id,
    },
  });
};

/**
 * The single exit point for every failure. Internal details — stack traces,
 * Prisma constraint names, driver messages — never cross this boundary in
 * production; the request id does, so support can find the log line.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our side. Try again in a moment.';
  let details: unknown;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      status = 409;
      code = 'ALREADY_EXISTS';
      message = 'That value is already taken.';
    } else if (err.code === 'P2025') {
      status = 404;
      code = 'NOT_FOUND';
      message = 'That does not exist.';
    } else {
      status = 400;
      code = 'DATABASE_ERROR';
      message = 'That request could not be completed.';
    }
  } else if (err instanceof SyntaxError && 'body' in err) {
    status = 400;
    code = 'MALFORMED_JSON';
    message = 'The request body is not valid JSON.';
  }

  const log = { err, requestId: req.id, path: req.path, method: req.method, userId: req.user?.id };
  if (status >= 500) logger.error(log, 'unhandled request failure');
  else logger.warn(log, 'request rejected');

  res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      requestId: req.id,
      ...(isProd ? {} : { debug: err instanceof Error ? err.stack : String(err) }),
    },
  });
};
