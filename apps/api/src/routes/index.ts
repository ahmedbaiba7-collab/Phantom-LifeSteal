import { Router } from 'express';
import authRoutes from './auth.routes';
import meRoutes from './me.routes';
import publicRoutes from './public.routes';
import storeRoutes from './store.routes';
import supportRoutes from './support.routes';
import voteRoutes from './vote.routes';
import adminRoutes from './admin.routes';
import integrationRoutes from './integration.routes';
import { coinRoutes } from './coins.routes';
import { limits } from '../middleware/rateLimit';
import { issueCsrfToken } from '../middleware/csrf';
import { maintenanceGate } from '../middleware/maintenance';
import { optionalAuth } from '../middleware/auth';

const router = Router();

// A general ceiling applies to everything; specific routes tighten it further.
router.use(limits.global);
router.use(issueCsrfToken);
router.use(optionalAuth, maintenanceGate);

router.use('/auth', authRoutes);
router.use('/me', meRoutes);
router.use('/store', storeRoutes);
router.use('/tickets', supportRoutes);
router.use('/vote', voteRoutes);
router.use('/coins', coinRoutes);
router.use('/admin', adminRoutes);
router.use('/integration', integrationRoutes);
router.use('/', publicRoutes); // mounted last so it never shadows a specific prefix

export default router;
