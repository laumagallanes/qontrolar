import express from 'express';
import { createRateLimiter } from '../lib/security.js';
import { authenticateDevice, ingestReadings, IngestError, parseBearer, parseReadingsPayload } from '../services/ingestion.js';
import { classifyTemperature } from '../services/thresholds.js';

/**
 * API de ingesta para sensores (ESP32 u otros).
 *   POST /api/v1/readings   Authorization: Bearer qdev_...
 * Cada dispositivo tiene su propio token; sólo puede escribir en su punto asignado.
 */
export function apiRouter({ db, config, notifier, logger = console }) {
  const router = express.Router();
  const limiter = createRateLimiter({ limit: config.ingestRateLimitPerMinute, windowMs: 60000 });

  router.use(express.json({ limit: '32kb', type: ['application/json', 'application/*+json'] }));

  router.get('/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  router.post('/readings', async (req, res) => {
    const token = parseBearer(req.get('authorization'));
    const device = token ? await authenticateDevice(db, token) : null;
    if (!device) {
      res.set('WWW-Authenticate', 'Bearer realm="qontrolar"');
      return res.status(401).json({ ok: false, error: 'unauthorized', message: 'Token de dispositivo ausente, inválido o revocado.' });
    }
    const rl = limiter.hit(device.id);
    if (!rl.allowed) {
      res.set('Retry-After', String(rl.retryAfterSeconds));
      return res.status(429).json({ ok: false, error: 'rate_limited', message: 'Demasiadas solicitudes para este dispositivo.' });
    }
    try {
      const now = new Date();
      const readings = parseReadingsPayload(req.body, now);
      const firmware = typeof req.get('x-firmware-version') === 'string' ? req.get('x-firmware-version').slice(0, 40) : null;
      const result = await ingestReadings(db, device, readings, { now, ip: req.ip, firmware });
      if (result.events.length) {
        notifier.notifyEvents(result.events).catch((err) => logger.error?.('[notifier]', err.message));
      }
      const p = result.point;
      return res.status(201).json({
        ok: true,
        accepted: result.accepted,
        point: {
          name: p.name,
          min_temp: p.min_temp,
          max_temp: p.max_temp,
          status: p.last_temperature === null ? 'no_data' : classifyTemperature(p.last_temperature, p),
        },
        events: result.events.map((e) => ({ transition: e.transition, type: e.alert.type })),
      });
    } catch (err) {
      if (err instanceof IngestError) {
        return res.status(err.status).json({ ok: false, error: err.code, message: err.message });
      }
      throw err;
    }
  });

  // Errores de JSON malformado o tamaño excedido devuelven JSON, no HTML.
  router.use((err, _req, res, next) => {
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, error: 'invalid_json', message: 'JSON malformado.' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ ok: false, error: 'payload_too_large', message: 'Cuerpo demasiado grande.' });
    }
    if (err) {
      logger.error?.('[api]', err);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
    next();
  });

  router.use((_req, res) => res.status(404).json({ ok: false, error: 'not_found' }));
  return router;
}
