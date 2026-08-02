import pino from 'pino';
import { env, isProd } from '../config/env';

/**
 * Structured JSON logs in production (machine-parsable, shippable to Loki or
 * CloudWatch); pretty output in development. Secrets are redacted at the logger
 * so no call site can accidentally leak a token into stdout.
 */
export const logger = pino({
  level: isProd ? 'info' : 'debug',
  base: { service: 'phantom-api', env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      'req.body.token',
      'req.body.code',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      'refreshToken',
      'secretEnc',
    ],
    censor: '[redacted]',
  },
  transport: isProd
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
