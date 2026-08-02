import express, { type Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { applySecurity } from './middleware/security';
import { errorHandler, notFoundHandler } from './middleware/error';
import routes from './routes';
import { openApiDocument } from './docs/openapi';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';

export function createApp(): Express {
  const app = express();

  applySecurity(app);

  /**
   * Liveness and readiness. Kept outside the API prefix and outside rate
   * limiting so an orchestrator probe never trips a limiter and never depends
   * on the same code path as user traffic.
   */
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  app.get('/health/ready', async (_req, res) => {
    const checks = { database: false, redis: false };
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch {
      /* reported as false */
    }
    try {
      checks.redis = (await redis.ping()) === 'PONG';
    } catch {
      /* reported as false */
    }

    const ready = checks.database && checks.redis;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'degraded', checks });
  });

  app.use('/api/v1', routes);

  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: 'LifeSteal Phantom API',
      swaggerOptions: { persistAuthorization: true },
    }),
  );
  app.get('/api/openapi.json', (_req, res) => res.json(openApiDocument));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
