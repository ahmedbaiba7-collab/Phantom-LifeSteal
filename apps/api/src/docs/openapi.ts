import { env } from '../config/env';

const errorResponse = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'AUTH_INVALID_CREDENTIALS' },
        message: { type: 'string' },
        details: { type: 'object', additionalProperties: { type: 'string' } },
        requestId: { type: 'string' },
      },
    },
  },
};

const json = (schema: object) => ({ content: { 'application/json': { schema } } });

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'LifeSteal Phantom API',
    version: '1.0.0',
    description: [
      'Public and authenticated API for the LifeSteal Phantom network.',
      '',
      '**Authentication.** `POST /auth/login` returns a short-lived access token in the body and',
      'sets an HttpOnly refresh cookie. Send the access token as `Authorization: Bearer <token>`.',
      'When it expires, call `POST /auth/refresh` — the cookie is rotated on every call, and',
      'presenting a rotated token revokes the entire session family.',
      '',
      '**CSRF.** Cookie-authenticated writes require the `x-csrf-token` header, echoing the',
      '`phantom_csrf` cookie.',
      '',
      '**Rate limits.** Every response carries `RateLimit-Limit` and `RateLimit-Remaining`.',
      'Login is limited to 5 failures per 15 minutes per email and IP.',
    ].join('\n'),
    contact: { name: 'LifeSteal Phantom', url: env.WEB_ORIGIN },
  },
  servers: [{ url: `${env.API_ORIGIN}/api/v1`, description: 'Primary' }],
  tags: [
    { name: 'Auth', description: 'Registration, sign-in, tokens' },
    { name: 'Account', description: 'The signed-in player' },
    { name: 'Server', description: 'Live Minecraft status' },
    { name: 'Content', description: 'News, wiki, FAQ' },
    { name: 'Store', description: 'Catalogue and checkout' },
    { name: 'Voting', description: 'Vote links and rewards' },
    { name: 'Leaderboards', description: 'Rankings' },
    { name: 'Support', description: 'Tickets, reports, appeals' },
    { name: 'Admin', description: 'Staff operations — permission gated' },
    { name: 'Integration', description: 'In-game plugin, API-key authenticated' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
    },
    responses: {
      Unauthorized: { description: 'Missing or invalid credentials', ...json(errorResponse) },
      Forbidden: { description: 'Authenticated but not permitted', ...json(errorResponse) },
      NotFound: { description: 'No such resource', ...json(errorResponse) },
      ValidationFailed: { description: 'Input rejected by schema', ...json(errorResponse) },
      RateLimited: { description: 'Too many requests', ...json(errorResponse) },
    },
  },
  paths: {
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Create an account',
        description: 'Creates an unverified account and emails a confirmation link. Limited to 3 per hour per IP.',
        requestBody: json({
          type: 'object',
          required: ['email', 'username', 'password', 'confirmPassword', 'acceptTerms'],
          properties: {
            email: { type: 'string', format: 'email' },
            username: { type: 'string', minLength: 3, maxLength: 16 },
            password: { type: 'string', minLength: 10 },
            confirmPassword: { type: 'string' },
            acceptTerms: { type: 'boolean', enum: [true] },
            captchaToken: { type: 'string' },
          },
        }),
        responses: {
          201: { description: 'Account created' },
          409: { description: 'Email or username taken', ...json(errorResponse) },
          422: { $ref: '#/components/responses/ValidationFailed' },
          429: { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in',
        description: 'Returns an access token, or a 2FA challenge when the account has two-factor enabled.',
        requestBody: json({
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' },
            captchaToken: { type: 'string' },
          },
        }),
        responses: {
          200: { description: 'Signed in, or a challenge is required' },
          401: { $ref: '#/components/responses/Unauthorized' },
          423: { description: 'Account temporarily locked', ...json(errorResponse) },
          429: { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate the refresh token',
        description: 'Reads the HttpOnly cookie, issues a new access token and a new refresh cookie. Replaying a rotated token revokes every session on the account.',
        responses: { 200: { description: 'Rotated' }, 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/auth/logout': {
      post: { tags: ['Auth'], summary: 'Sign out of this device', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Signed out' } } },
    },
    '/me': {
      get: {
        tags: ['Account'],
        summary: 'The signed-in player',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Account, roles, stats, punishments' }, 401: { $ref: '#/components/responses/Unauthorized' } },
      },
      patch: {
        tags: ['Account'],
        summary: 'Update profile',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Updated' }, 422: { $ref: '#/components/responses/ValidationFailed' } },
      },
    },
    '/me/sessions': {
      get: { tags: ['Account'], summary: 'Active devices', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Device list' } } },
    },
    '/server/status': {
      get: {
        tags: ['Server'],
        summary: 'Live server status',
        description: 'Served from cache, refreshed every 20 seconds by a background poller.',
        responses: { 200: { description: 'Players, version, MOTD, latency, TPS' } },
      },
    },
    '/leaderboards/{board}': {
      get: {
        tags: ['Leaderboards'],
        summary: 'Ranking table',
        parameters: [
          { name: 'board', in: 'path', required: true, schema: { type: 'string', enum: ['kills', 'deaths', 'hearts', 'balance', 'playtime', 'votes', 'streak', 'kdr'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 5, maximum: 100, default: 25 } },
        ],
        responses: { 200: { description: 'Ranked players' } },
      },
    },
    '/news': {
      get: {
        tags: ['Content'],
        summary: 'Published posts',
        parameters: [
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 50, default: 20 } },
        ],
        responses: { 200: { description: 'Cursor-paginated posts' } },
      },
    },
    '/store/products': {
      get: { tags: ['Store'], summary: 'Catalogue', responses: { 200: { description: 'Active products' } } },
    },
    '/store/checkout': {
      post: {
        tags: ['Store'],
        summary: 'Create an order',
        description: 'Prices are resolved server-side from the catalogue. The idempotency key makes retries safe.',
        security: [{ bearerAuth: [] }],
        requestBody: json({
          type: 'object',
          required: ['items', 'idempotencyKey'],
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                required: ['productId'],
                properties: { productId: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 10 } },
              },
            },
            couponCode: { type: 'string' },
            giftToIgn: { type: 'string' },
            idempotencyKey: { type: 'string' },
          },
        }),
        responses: {
          201: { description: 'Order created, awaiting payment' },
          409: { description: 'Out of stock', ...json(errorResponse) },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/vote/status': {
      get: { tags: ['Voting'], summary: 'Which sites are ready to claim', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Per-site availability' } } },
    },
    '/tickets': {
      get: { tags: ['Support'], summary: 'List tickets', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Own tickets, or all for staff' } } },
      post: { tags: ['Support'], summary: 'Open a ticket', security: [{ bearerAuth: [] }], responses: { 201: { description: 'Created' }, 403: { $ref: '#/components/responses/Forbidden' } } },
    },
    '/admin/dashboard': {
      get: {
        tags: ['Admin'],
        summary: 'Operational summary',
        description: 'Requires `analytics.read`.',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Counts and revenue' }, 403: { $ref: '#/components/responses/Forbidden' } },
      },
    },
    '/admin/audit': {
      get: { tags: ['Admin'], summary: 'Audit log', description: 'Requires `audit.read`.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Recent entries' } } },
    },
    '/integration/stats': {
      post: {
        tags: ['Integration'],
        summary: 'Push player stats',
        description: 'Called by the in-game plugin every 30 seconds. Requires an API key with the `integration` scope.',
        security: [{ apiKey: [] }],
        responses: { 200: { description: 'Accepted' }, 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },
  },
} as const;
