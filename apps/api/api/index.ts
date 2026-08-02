/**
 * Serverless entry point for Vercel.
 *
 * The same Express app that `src/server.ts` runs as a long-lived process is
 * exported here as a request handler instead. Nothing about the routes,
 * middleware or services changes — only who owns the process lifetime.
 *
 * Two consequences worth understanding before relying on this:
 *
 *  1. There is no background work. The 20-second Minecraft status poller in
 *     server.ts never runs here, so the first request after the cache expires
 *     pays for the ping itself. `minecraft.service.ts` already handles that —
 *     it fetches on demand and caches — so the behaviour is correct, just
 *     occasionally slower.
 *
 *  2. The app is built once per cold start and reused across invocations that
 *     land on the same instance. Prisma and Redis clients are module-level
 *     singletons, so they are reused too rather than reconnecting per request.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../src/app';

const app = createApp();

// Vercel terminates TLS at the edge and forwards over HTTP, so Express must be
// told to trust the proxy or every client will appear to come from Vercel's
// own address — which would make the rate limiter useless and the IP column in
// the audit log a lie.
app.set('trust proxy', 1);

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  return app(req as never, res as never);
}
