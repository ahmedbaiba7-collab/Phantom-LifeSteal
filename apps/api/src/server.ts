import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { disconnectPrisma } from './lib/prisma';
import { redis } from './lib/redis';
import { refreshServerStatus } from './services/minecraft.service';

const app = createApp();
const server = app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT, env: env.NODE_ENV }, 'LifeSteal Phantom API listening');
});

/**
 * The status poller lives here rather than in the request path so a traffic
 * spike costs the game server zero extra sockets: thousands of visitors read
 * one cached value that one timer refreshes.
 */
const statusTimer = setInterval(() => {
  refreshServerStatus().catch((err) => logger.warn({ err }, 'status refresh failed'));
}, 20_000);
refreshServerStatus().catch(() => undefined);

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests finish,
 * then close the pools. Without this, a deploy can cut a checkout in half.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  clearInterval(statusTimer);

  const force = setTimeout(() => {
    logger.error('graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 15_000);

  server.close(async () => {
    try {
      await disconnectPrisma();
      redis.disconnect();
    } finally {
      clearTimeout(force);
      logger.info('shutdown complete');
      process.exit(0);
    }
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  // An uncaught exception leaves the process in an unknown state; log it and
  // let the orchestrator restart a clean one rather than serving from a
  // corrupted heap.
  logger.fatal({ err }, 'uncaught exception — exiting');
  process.exit(1);
});
