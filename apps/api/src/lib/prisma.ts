import { PrismaClient } from '@prisma/client';
import { isProd } from '../config/env';
import { logger } from './logger';

/**
 * A single client for the process. Prisma pools connections itself; creating a
 * client per request exhausts Postgres in minutes under load.
 */
export const prisma = new PrismaClient({
  log: isProd
    ? [{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }]
    : [{ emit: 'event', level: 'query' }, { emit: 'event', level: 'error' }],
});

// @ts-expect-error — event typing varies with the generated client
prisma.$on('error', (e: { message: string }) => logger.error({ err: e }, 'prisma error'));
// @ts-expect-error — see above
prisma.$on('warn', (e: { message: string }) => logger.warn({ msg: e.message }, 'prisma warning'));

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
