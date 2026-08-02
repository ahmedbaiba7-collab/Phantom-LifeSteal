import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/rbac';
import { verifyCsrf } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { limits } from '../middleware/rateLimit';
import { createTicketSchema, ticketMessageSchema } from '../schemas';
import { hasPermission } from '../config/permissions';
import { sanitizeText } from '../lib/crypto';
import { audit } from '../services/audit.service';
import { forbidden, notFound } from '../lib/errors';
import { mailer } from '../lib/mailer';

const router = Router();

router.use(requireAuth);
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, private');
  next();
});

/** POST /tickets — opens a support ticket, bug report, player report or appeal. */
router.post('/', verifyCsrf, limits.ticket, validate(createTicketSchema), async (req, res, next) => {
  try {
    const open = await prisma.ticket.count({
      where: { userId: req.user!.id, status: { in: ['OPEN', 'PENDING', 'ANSWERED'] } },
    });
    if (open >= 5) {
      throw forbidden('TOO_MANY_OPEN_TICKETS', 'You already have 5 open tickets. Close one first.');
    }

    const reference = `T-${Date.now().toString(36).toUpperCase()}`;

    const ticket = await prisma.ticket.create({
      data: {
        reference,
        userId: req.user!.id,
        type: req.body.type,
        subject: sanitizeText(req.body.subject),
        priority: req.body.type === 'APPEAL' ? 'HIGH' : 'NORMAL',
        messages: {
          create: { authorId: req.user!.id, body: sanitizeText(req.body.body) },
        },
      },
      select: { id: true, reference: true, type: true, subject: true, status: true, createdAt: true },
    });

    await audit(req, { action: 'ticket.create', targetType: 'ticket', targetId: ticket.id });
    res.status(201).json({ data: ticket });
  } catch (err) {
    next(err);
  }
});

/** GET /tickets — own tickets, or all of them for staff. */
router.get('/', async (req, res, next) => {
  try {
    const isStaff = hasPermission(req.user!.permissions, 'ticket.read.all');

    const tickets = await prisma.ticket.findMany({
      where: isStaff ? {} : { userId: req.user!.id },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 50,
      select: {
        id: true, reference: true, type: true, subject: true, status: true,
        priority: true, createdAt: true, updatedAt: true,
        user: { select: { username: true } },
        _count: { select: { messages: true } },
      },
    });

    res.json({ data: tickets });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /tickets/:reference
 * Ownership is checked here, in the handler, rather than by hiding the route —
 * an authenticated user guessing a reference gets a 404, not someone else's ticket.
 */
router.get('/:reference', async (req, res, next) => {
  try {
    const isStaff = hasPermission(req.user!.permissions, 'ticket.read.all');

    const ticket = await prisma.ticket.findFirst({
      where: { reference: req.params.reference, ...(isStaff ? {} : { userId: req.user!.id }) },
      select: {
        id: true, reference: true, type: true, subject: true, status: true,
        priority: true, createdAt: true, closedAt: true,
        user: { select: { username: true, avatarUrl: true } },
        messages: {
          where: isStaff ? {} : { staffOnly: false },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, body: true, staffOnly: true, createdAt: true,
            author: { select: { username: true, avatarUrl: true } },
          },
        },
      },
    });

    if (!ticket) throw notFound('TICKET_NOT_FOUND', 'No ticket with that reference.');
    res.json({ data: ticket });
  } catch (err) {
    next(err);
  }
});

/** POST /tickets/:reference/messages — reply. Staff-only notes are filtered on read. */
router.post('/:reference/messages', verifyCsrf, limits.comment, validate(ticketMessageSchema), async (req, res, next) => {
  try {
    const isStaff = hasPermission(req.user!.permissions, 'ticket.reply');

    const ticket = await prisma.ticket.findFirst({
      where: { reference: req.params.reference, ...(isStaff ? {} : { userId: req.user!.id }) },
      select: { id: true, status: true, userId: true, reference: true, user: { select: { email: true, username: true } } },
    });

    if (!ticket) throw notFound('TICKET_NOT_FOUND', 'No ticket with that reference.');
    if (ticket.status === 'CLOSED') {
      throw forbidden('TICKET_CLOSED', 'This ticket is closed. Open a new one to continue.');
    }

    const message = await prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: req.user!.id,
        body: sanitizeText(req.body.body),
        staffOnly: isStaff ? req.body.staffOnly : false,
      },
      select: { id: true, body: true, createdAt: true, staffOnly: true },
    });

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: isStaff ? 'ANSWERED' : 'PENDING', updatedAt: new Date() },
    });

    if (isStaff && !message.staffOnly && ticket.userId !== req.user!.id) {
      await mailer.ticketReply(ticket.user.email, ticket.user.username, ticket.reference);
      await prisma.notification.create({
        data: {
          userId: ticket.userId,
          title: 'Staff replied to your ticket',
          body: `There is a new reply on ${ticket.reference}.`,
          href: `/support/${ticket.reference}`,
        },
      });
    }

    res.status(201).json({ data: message });
  } catch (err) {
    next(err);
  }
});

/** POST /tickets/:reference/close — the owner or staff may close. */
router.post('/:reference/close', verifyCsrf, async (req, res, next) => {
  try {
    const isStaff = hasPermission(req.user!.permissions, 'ticket.close');

    const result = await prisma.ticket.updateMany({
      where: {
        reference: req.params.reference,
        status: { not: 'CLOSED' },
        ...(isStaff ? {} : { userId: req.user!.id }),
      },
      data: { status: 'CLOSED', closedAt: new Date() },
    });

    if (result.count === 0) throw notFound('TICKET_NOT_FOUND', 'No open ticket with that reference.');

    await audit(req, { action: 'ticket.close', targetType: 'ticket', targetId: req.params.reference });
    res.json({ data: { message: 'Ticket closed.' } });
  } catch (err) {
    next(err);
  }
});

export default router;
