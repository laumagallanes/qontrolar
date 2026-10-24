import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { apiRouter } from './routes/api.js';
import { webRouter } from './routes/web.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

/**
 * Crea la aplicación Express. Las dependencias se inyectan para poder testear
 * con una base PGlite en memoria y un cliente de WhatsApp falso.
 */
export function createApp({ db, config, whatsapp, notifier, clock, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (config.cookieSecure) res.set('Strict-Transport-Security', 'max-age=31536000');
    if (!req.path.startsWith('/static/')) res.set('Cache-Control', 'no-store');
    next();
  });

  app.use('/static', express.static(PUBLIC_DIR, { maxAge: '1h', index: false }));
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use('/api/v1', apiRouter({ db, config, notifier, logger }));
  app.use('/', webRouter({ db, config, whatsapp, notifier, clock }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    logger.error?.('[web]', err);
    res.status(500).type('text').send('Error interno.');
  });
  return app;
}
