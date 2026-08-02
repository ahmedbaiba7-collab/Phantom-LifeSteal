import type { CoinReason, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, notFound } from '../lib/errors';
import { audit } from './audit.service';

/**
 * Every coin movement goes through this module. Nothing else in the codebase
 * is allowed to write `user.coins` directly.
 *
 * Two rules make the ledger trustworthy:
 *
 *  1. The balance update and the ledger row happen in one transaction. There
 *     is no window where a player has been charged but no record exists.
 *  2. The row is locked with SELECT ... FOR UPDATE before it is read. Two
 *     concurrent purchases cannot both read the same starting balance and
 *     both decide the player can afford the item — the classic double-spend
 *     that shows up the first time someone scripts the Confirm button.
 */

interface MovementInput {
  userId: string;
  amount: number;
  reason: CoinReason;
  description: string;
  referenceId?: string;
  actorId?: string;
  /** Reject the movement if it would push the balance below zero. */
  allowNegative?: boolean;
}

/** Locks the wallet row and returns the current balance. Transaction-scoped. */
async function lockBalance(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ coins: number }[]>`
    SELECT coins FROM users WHERE id = ${userId} FOR UPDATE
  `;
  if (rows.length === 0) throw notFound('USER_NOT_FOUND', 'That account no longer exists.');
  return rows[0].coins;
}

/**
 * Applies a single credit or debit. Pass an existing transaction client when
 * the movement is part of a larger unit of work (a purchase, a refund); pass
 * nothing and one is opened for you.
 */
export async function move(
  input: MovementInput,
  tx?: Prisma.TransactionClient,
): Promise<{ balance: number; transactionId: string }> {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw badRequest('INVALID_AMOUNT', 'Coin amounts must be whole numbers other than zero.');
  }

  const run = async (client: Prisma.TransactionClient) => {
    const current = await lockBalance(client, input.userId);
    const next = current + input.amount;

    if (next < 0 && !input.allowNegative) {
      throw conflict(
        'INSUFFICIENT_COINS',
        `That costs ${Math.abs(input.amount)} coins and you have ${current}.`,
      );
    }

    await client.user.update({ where: { id: input.userId }, data: { coins: next } });

    const record = await client.coinTransaction.create({
      data: {
        userId: input.userId,
        amount: input.amount,
        balanceAfter: next,
        reason: input.reason,
        description: input.description.slice(0, 200),
        referenceId: input.referenceId,
        actorId: input.actorId,
      },
      select: { id: true },
    });

    return { balance: next, transactionId: record.id };
  };

  return tx ? run(tx) : prisma.$transaction(run);
}

/**
 * Buys a coin-shop item. The whole thing is one transaction: stock check,
 * debit, ledger row, purchase record, and the delivery row the plugin polls.
 * If any step throws, the player keeps their coins.
 */
export async function purchase(params: {
  userId: string;
  productId: string;
  quantity: number;
  idempotencyKey: string;
}): Promise<{ balance: number; purchaseId: string; alreadyProcessed: boolean }> {
  const { userId, productId, quantity, idempotencyKey } = params;

  // A retried request must not charge twice. Checked before the transaction
  // for the common case, and enforced by a unique index for the racing one.
  const existing = await prisma.coinPurchase.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    select: { id: true },
  });
  if (existing) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { coins: true },
    });
    return { balance: user.coins, purchaseId: existing.id, alreadyProcessed: true };
  }

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        coinPrice: true,
        active: true,
        stock: true,
        type: true,
        commands: true,
      },
    });

    if (!product || !product.active) {
      throw notFound('PRODUCT_NOT_FOUND', 'That item is no longer in the shop.');
    }
    if (product.coinPrice === null) {
      throw badRequest('NOT_COIN_PRODUCT', 'That item is not sold for coins.');
    }
    if (product.stock !== null && product.stock < quantity) {
      throw conflict(
        'OUT_OF_STOCK',
        product.stock === 0 ? 'That item just sold out.' : `Only ${product.stock} left.`,
      );
    }

    // Price is read from the database, never from the request body.
    const cost = product.coinPrice * quantity;

    const { balance } = await move(
      {
        userId,
        amount: -cost,
        reason: 'SHOP_PURCHASE',
        description: `${quantity}× ${product.name}`,
        referenceId: product.id,
      },
      tx,
    );

    if (product.stock !== null) {
      await tx.product.update({
        where: { id: product.id },
        data: { stock: { decrement: quantity } },
      });
    }

    const record = await tx.coinPurchase.create({
      data: { userId, productId: product.id, quantity, coinsSpent: cost, idempotencyKey },
      select: { id: true },
    });

    // Queued rather than pushed: if the Minecraft server is down or
    // restarting, the item is waiting the next time the player joins. One row
    // per command per unit, so a partial failure retries only what failed.
    const account = await tx.minecraftAccount.findFirst({
      where: { userId, verifiedAt: { not: null } },
      select: { uuid: true, ign: true },
    });

    const rows = [];
    for (let unit = 0; unit < quantity; unit++) {
      for (const template of product.commands) {
        rows.push({
          coinPurchaseId: record.id,
          targetUuid: account?.uuid ?? null,
          command: template.replace(/%player%/g, account?.ign ?? ''),
        });
      }
    }
    if (rows.length > 0) await tx.delivery.createMany({ data: rows });

    return { balance, purchaseId: record.id, alreadyProcessed: false };
  });
}

/** Staff-initiated adjustment. Always audited, always attributed. */
export async function adjust(params: {
  userId: string;
  amount: number;
  reason: string;
  actorId: string;
  ip?: string;
}): Promise<number> {
  const { balance, transactionId } = await move({
    userId: params.userId,
    amount: params.amount,
    reason: params.amount > 0 ? 'ADMIN_GRANT' : 'ADMIN_REVOKE',
    description: params.reason,
    actorId: params.actorId,
    // Staff can take a balance negative on purpose — clawing back a duped
    // payout should not be blocked because the player already spent it.
    allowNegative: true,
  });

  await audit({
    actorId: params.actorId,
    action: params.amount > 0 ? 'coins.grant' : 'coins.revoke',
    targetType: 'user',
    targetId: params.userId,
    metadata: { amount: params.amount, reason: params.reason, transactionId, balance },
    ip: params.ip,
  });

  return balance;
}

/**
 * Recomputes a wallet from its ledger. Run this if the cached total is ever
 * suspected of drifting; it returns both figures so the caller can decide
 * whether a correction is warranted rather than silently overwriting.
 */
export async function reconcile(userId: string): Promise<{
  cached: number;
  ledger: number;
  drift: number;
}> {
  const [user, sum] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { coins: true } }),
    prisma.coinTransaction.aggregate({ where: { userId }, _sum: { amount: true } }),
  ]);

  const ledger = sum._sum.amount ?? 0;
  return { cached: user.coins, ledger, drift: user.coins - ledger };
}
