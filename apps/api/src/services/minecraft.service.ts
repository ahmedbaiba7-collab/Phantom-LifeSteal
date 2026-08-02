import net from 'node:net';
import { env } from '../config/env';
import { cached, redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';

export interface ServerStatus {
  online: boolean;
  players: { online: number; max: number; sample: { name: string; id: string }[] };
  version: string;
  protocol: number | null;
  motd: string;
  faviconDataUri: string | null;
  latencyMs: number | null;
  tps: number | null;
  maintenance: boolean;
  checkedAt: string;
}

/** Any recent protocol number works for a status ping; the server replies regardless. */
const PROTOCOL_VERSION = 765;

const OFFLINE: Omit<ServerStatus, 'maintenance' | 'checkedAt' | 'tps'> = {
  online: false,
  players: { online: 0, max: 0, sample: [] },
  version: 'unknown',
  protocol: null,
  motd: '',
  faviconDataUri: null,
  latencyMs: null,
};

// ---------------------------------------------------------------------------
// Minecraft Server List Ping, implemented directly rather than through a
// third-party status API. No external dependency, no rate limit that is not
// ours, and no leaking of our traffic pattern to someone else's service.
// ---------------------------------------------------------------------------

function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value;
  do {
    let temp = v & 0b0111_1111;
    v >>>= 7;
    if (v !== 0) temp |= 0b1000_0000;
    bytes.push(temp);
  } while (v !== 0);
  return Buffer.from(bytes);
}

function readVarInt(buffer: Buffer, offset: number): { value: number; size: number } {
  let value = 0;
  let size = 0;
  let byte: number;
  do {
    byte = buffer[offset + size] ?? 0;
    value |= (byte & 0b0111_1111) << (7 * size);
    size += 1;
    if (size > 5) throw new Error('VarInt too long');
  } while ((byte & 0b1000_0000) !== 0);
  return { value, size };
}

function withLength(payload: Buffer): Buffer {
  return Buffer.concat([writeVarInt(payload.length), payload]);
}

function flattenMotd(description: unknown): string {
  if (typeof description === 'string') return description;
  if (description && typeof description === 'object') {
    const node = description as { text?: string; extra?: unknown[]; translate?: string };
    let out = node.text ?? node.translate ?? '';
    if (Array.isArray(node.extra)) out += node.extra.map(flattenMotd).join('');
    return out;
  }
  return '';
}

/** Strip legacy §-codes so the MOTD can be rendered as plain text safely. */
export function stripColorCodes(input: string): string {
  return input.replace(/§[0-9a-fk-orA-FK-OR]/g, '').trim();
}

async function ping(host: string, port: number, timeoutMs = 3000): Promise<ServerStatus> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.createConnection({ host, port });
    let buffer = Buffer.alloc(0);
    let settled = false;

    const finish = (status: ServerStatus) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(status);
    };

    const offline = () =>
      finish({
        ...OFFLINE,
        tps: null,
        maintenance: false,
        checkedAt: new Date().toISOString(),
      });

    socket.setTimeout(timeoutMs);
    socket.on('timeout', offline);
    socket.on('error', (err) => {
      logger.debug({ err, host, port }, 'minecraft ping failed');
      offline();
    });

    socket.on('connect', () => {
      const hostBuf = Buffer.from(host, 'utf8');
      const handshake = withLength(
        Buffer.concat([
          writeVarInt(0x00), // packet id
          writeVarInt(PROTOCOL_VERSION),
          writeVarInt(hostBuf.length),
          hostBuf,
          Buffer.from([(port >> 8) & 0xff, port & 0xff]),
          writeVarInt(1), // next state: status
        ]),
      );
      socket.write(handshake);
      socket.write(withLength(writeVarInt(0x00))); // status request
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const packetLength = readVarInt(buffer, 0);
        if (buffer.length < packetLength.size + packetLength.value) return; // wait for more

        let offset = packetLength.size;
        const packetId = readVarInt(buffer, offset);
        offset += packetId.size;
        const jsonLength = readVarInt(buffer, offset);
        offset += jsonLength.size;

        const json = JSON.parse(buffer.subarray(offset, offset + jsonLength.value).toString('utf8'));

        finish({
          online: true,
          players: {
            online: json.players?.online ?? 0,
            max: json.players?.max ?? 0,
            sample: (json.players?.sample ?? []).slice(0, 12),
          },
          version: json.version?.name ?? 'unknown',
          protocol: json.version?.protocol ?? null,
          motd: stripColorCodes(flattenMotd(json.description)),
          faviconDataUri: typeof json.favicon === 'string' ? json.favicon : null,
          latencyMs: Date.now() - start,
          tps: null,
          maintenance: false,
          checkedAt: new Date().toISOString(),
        });
      } catch {
        // Incomplete packet — wait for the next chunk. A genuinely malformed
        // response is caught by the socket timeout.
      }
    });
  });
}

/**
 * Public read path. Never pings on request: the poller writes to Redis every
 * 20 seconds and every visitor reads the cache, so a hug of death from a
 * YouTube video costs the game server zero extra sockets.
 */
export async function getServerStatus(): Promise<ServerStatus> {
  const raw = await redis.get('mc:status').catch(() => null);
  const maintenance = (await redis.get('site:maintenance').catch(() => null)) === '1';

  if (raw) {
    const status = JSON.parse(raw) as ServerStatus;
    return { ...status, maintenance };
  }

  // Cold cache (fresh deploy): ping once and prime it.
  const status = await refreshServerStatus();
  return { ...status, maintenance };
}

export async function refreshServerStatus(): Promise<ServerStatus> {
  const status = await ping(env.MC_HOST, env.MC_PORT);

  // TPS is pushed by the plugin, which is the only thing that can actually
  // measure it; the ping protocol carries no such field.
  const tpsRaw = await redis.get('mc:tps').catch(() => null);
  status.tps = tpsRaw ? Number(tpsRaw) : null;

  await redis.set('mc:status', JSON.stringify(status), 'EX', 120).catch(() => undefined);
  return status;
}

/** Live network heart totals used by the home page ledger. Cached 60s. */
export async function getNetworkPulse() {
  return cached('mc:pulse', 60, async () => {
    const [aggregate, topHolder, active] = await Promise.all([
      prisma.playerStats.aggregate({
        _sum: { heartsStolen: true, kills: true, playtimeMinutes: true },
        _count: { _all: true },
      }),
      prisma.playerStats.findFirst({
        orderBy: { maxHearts: 'desc' },
        select: { maxHearts: true, user: { select: { username: true } } },
      }),
      prisma.playerStats.count({
        where: { lastSeenAt: { gte: new Date(Date.now() - 86_400_000) } },
      }),
    ]);

    return {
      heartsStolen: aggregate._sum.heartsStolen ?? 0,
      totalKills: aggregate._sum.kills ?? 0,
      hoursPlayed: Math.round((aggregate._sum.playtimeMinutes ?? 0) / 60),
      registered: aggregate._count._all,
      activeToday: active,
      heartKing: topHolder
        ? { username: topHolder.user.username, hearts: topHolder.maxHearts }
        : null,
    };
  });
}

/** Deterministic render URLs — no key, no per-request lookup. */
export const skin = {
  head: (uuid: string, size = 64) => `https://crafatar.com/avatars/${uuid}?size=${size}&overlay`,
  body: (uuid: string) => `https://crafatar.com/renders/body/${uuid}?scale=6&overlay`,
  cape: (uuid: string) => `https://crafatar.com/capes/${uuid}`,
};
