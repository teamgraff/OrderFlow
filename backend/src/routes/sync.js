import { Router } from 'express';
import { syncEnabled } from '../sync/scheduler.js';
import { syncConfigured } from '../sync/teamgraffClient.js';
import { isRunning, reprocessOrder, retryIssue, runSync, syncOverview } from '../sync/syncRun.js';

const router = Router();

const requireConfigured = (req, res, next) =>
  syncConfigured() ? next() : res.status(503).json({ error: 'La sincronización con Teamgraff no está configurada en el servidor.' });

router.get('/', (req, res) => {
  res.json({ enabled: syncEnabled(), configured: syncConfigured(), ...syncOverview() });
});

// "Sincronizar ahora": no espera a que termine (puede tardar varios segundos).
router.post('/run', requireConfigured, (req, res) => {
  if (isRunning()) return res.status(202).json({ started: false, message: 'Ya hay una sincronización en curso.' });
  runSync().catch((err) => console.error('❌ [sync]', err.message));
  res.status(202).json({ started: true });
});

router.post('/issues/:id/retry', requireConfigured, async (req, res, next) => {
  try {
    res.json(await retryIssue(Number(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/orders/:id/reprocess', requireConfigured, async (req, res, next) => {
  try {
    res.json(await reprocessOrder(Number(req.params.id)));
  } catch (err) { next(err); }
});

export default router;
