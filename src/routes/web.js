import express from 'express';
import { makeDateFormatters, BUSINESS_TYPES, POINT_KINDS } from '../lib/format.js';
import { createRateLimiter, DUMMY_PASSWORD_HASH, generateDeviceToken, verifyPassword } from '../lib/security.js';
import {
  createSession, destroySession, loadSession, requireAdmin, requireLogin, sessionCookie, verifyCsrf,
} from '../middleware/auth.js';
import * as repo from '../services/repo.js';
import { pointStatus, STATUS_SEVERITY, validateThresholds } from '../services/thresholds.js';
import { normalizePhone } from '../services/whatsapp.js';
import { temperatureChart } from '../views/chart.js';
import * as pages from '../views/pages.js';

const send = (res, page, status = 200) => res.status(status).type('html').send(String(page));
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function webRouter({ db, config, whatsapp, notifier, clock = () => new Date() }) {
  const router = express.Router();
  const fmt = makeDateFormatters(config.timezone);
  const loginLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60000 });

  router.use(express.urlencoded({ extended: false, limit: '32kb' }));
  router.use(loadSession(db));

  // ------------------------------------------------------------ login / logout

  router.get('/login', (req, res) => {
    if (req.user) return res.redirect(303, '/');
    send(res, pages.loginPage(req, { next: safeNext(req.query.next) }));
  });

  router.post('/login', async (req, res) => {
    const email = str(req.body.email, 200).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const next = safeNext(req.body.next);
    const rl = loginLimiter.hit(`${req.ip}|${email}`);
    if (!rl.allowed) {
      return send(res, pages.loginPage(req, { error: 'Demasiados intentos. Espere unos minutos.', next, email }), 429);
    }
    const { rows } = await db.query('SELECT id, password_hash FROM users WHERE lower(email) = $1', [email]);
    const user = rows[0];
    // Se verifica siempre contra un hash para no revelar por tiempo si el email existe.
    const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
    if (!user || !ok) {
      return send(res, pages.loginPage(req, { error: 'Email o contraseña incorrectos.', next, email }), 401);
    }
    loginLimiter.reset(`${req.ip}|${email}`);
    await destroySession(db, req.sessionToken);
    const token = await createSession(db, user.id, config.sessionTtlHours);
    res.set('Set-Cookie', sessionCookie(token, { secure: config.cookieSecure, maxAgeSeconds: config.sessionTtlHours * 3600 }));
    res.redirect(303, next);
  });

  router.use(requireLogin);
  router.use(verifyCsrf);

  router.post('/logout', async (req, res) => {
    await destroySession(db, req.sessionToken);
    res.set('Set-Cookie', sessionCookie('', { secure: config.cookieSecure, maxAgeSeconds: 0 }));
    res.redirect(303, '/login');
  });

  // ------------------------------------------------------------ tablero

  async function pointsWithStatus(orgId) {
    const now = clock();
    const points = await repo.listPoints(db, orgId);
    for (const p of points) p.status = pointStatus(p, now);
    return points;
  }

  router.get('/', async (req, res) => {
    const now = clock();
    const points = await pointsWithStatus(req.org.id);
    points.sort((a, b) => STATUS_SEVERITY[b.status] - STATUS_SEVERITY[a.status]);
    const openAlerts = await repo.listAlerts(db, req.org.id, { status: 'open', limit: 50 });
    send(res, pages.dashboardPage(req, { points, openAlerts, now, fmt }));
  });

  // ------------------------------------------------------------ puntos

  router.get('/puntos/nuevo', requireAdmin, async (req, res) => {
    const locations = await repo.listLocations(db, req.org.id);
    send(res, pages.newPointPage(req, { locations, values: { location_id: str(req.query.ubicacion, 40) } }));
  });

  router.post('/puntos', requireAdmin, async (req, res) => {
    const locations = await repo.listLocations(db, req.org.id);
    const { errors, value } = parsePointForm(req.body, locations);
    if (errors.length) return send(res, pages.newPointPage(req, { locations, errors, values: req.body }), 422);
    const { rows } = await db.query(
      `INSERT INTO monitored_points (organization_id, location_id, name, kind, min_temp, max_temp, alert_delay_minutes, offline_after_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [req.org.id, value.location_id, value.name, value.kind, value.min_temp, value.max_temp, value.alert_delay_minutes, value.offline_after_minutes],
    );
    res.redirect(303, `/puntos/${rows[0].id}?ok=created`);
  });

  async function renderPoint(req, res, { errors = [], values = null, status = 200 } = {}) {
    const point = await repo.getPoint(db, req.org.id, req.params.id);
    if (!point) return send(res, pages.simplePage(req, 'No encontrado', 'El punto no existe.'), 404);
    const now = clock();
    const rangeKey = pages.RANGES[req.query.rango] ? req.query.rango : '24h';
    const from = new Date(now.getTime() - pages.RANGES[rangeKey][1] * 86400000);
    const [readings, stats, alerts, locations] = await Promise.all([
      repo.getReadings(db, point.id, from, now),
      repo.readingStats(db, point.id, from, now),
      repo.listAlerts(db, req.org.id, { pointId: point.id, limit: 50 }),
      repo.listLocations(db, req.org.id),
    ]);
    const chart = temperatureChart({
      readings, from, to: now, min: point.min_temp, max: point.max_temp,
      gapMinutes: point.offline_after_minutes,
      formatTime: fmt.short,
      formatTick: rangeKey === '24h' ? fmt.time : (d) => fmt.short(d).split(',')[0],
    });
    send(res, pages.pointPage(req, {
      point, status: pointStatus(point, now), rangeKey, chart, readings, stats, alerts, locations, errors, values, fmt, now,
    }), status);
  }

  router.get('/puntos/:id', (req, res) => renderPoint(req, res));

  router.post('/puntos/:id', requireAdmin, async (req, res) => {
    const point = await repo.getPoint(db, req.org.id, req.params.id);
    if (!point) return send(res, pages.simplePage(req, 'No encontrado', 'El punto no existe.'), 404);
    const locations = await repo.listLocations(db, req.org.id);
    const { errors, value } = parsePointForm(req.body, locations);
    if (errors.length) return renderPoint(req, res, { errors, values: { ...point, ...req.body }, status: 422 });
    await db.query(
      `UPDATE monitored_points SET location_id = $3, name = $4, kind = $5, min_temp = $6, max_temp = $7,
              alert_delay_minutes = $8, offline_after_minutes = $9,
              -- Con nuevos umbrales la excursión en curso se reevalúa desde la próxima lectura.
              out_of_range_since = CASE WHEN min_temp = $6 AND max_temp = $7 THEN out_of_range_since ELSE NULL END
        WHERE organization_id = $1 AND id = $2`,
      [req.org.id, point.id, value.location_id, value.name, value.kind, value.min_temp, value.max_temp, value.alert_delay_minutes, value.offline_after_minutes],
    );
    res.redirect(303, `/puntos/${point.id}?ok=saved`);
  });

  router.post('/puntos/:id/eliminar', requireAdmin, async (req, res) => {
    if (!repo.isUuid(req.params.id)) return res.redirect(303, '/');
    await db.query('DELETE FROM monitored_points WHERE organization_id = $1 AND id = $2', [req.org.id, req.params.id]);
    res.redirect(303, '/ubicaciones?ok=deleted');
  });

  router.get('/puntos/:id/export.csv', async (req, res) => {
    const point = await repo.getPoint(db, req.org.id, req.params.id);
    if (!point) return res.status(404).send('No encontrado');
    const now = clock();
    const days = pages.RANGES[req.query.rango]?.[1] ?? 1;
    const readings = await repo.getReadings(db, point.id, new Date(now - days * 86400000), now, 100000);
    const lines = [
      ...(req.org.is_demo ? ['# DEMO - DATOS FICTICIOS GENERADOS POR SIMULADOR: no son lecturas de sensores reales'] : []),
      '# Registro operativo Qontrol.ar - no reemplaza registros oficiales de inspección',
      `# Punto: ${csvCell(point.name)} | Ubicación: ${csvCell(point.location_name)} | Rango configurado: ${point.min_temp} a ${point.max_temp} °C | Zona horaria: ${config.timezone}`,
      'fecha_hora_local,fecha_hora_utc,temperatura_c,humedad_pct,fuera_de_rango',
      ...readings.map((r) => [
        fmt.local(r.recorded_at), new Date(r.recorded_at).toISOString(), r.temperature, r.humidity ?? '',
        r.temperature > point.max_temp || r.temperature < point.min_temp ? 'si' : 'no',
      ].join(',')),
    ];
    const filename = `qontrolar-${req.org.is_demo ? 'DEMO-' : ''}${point.name.normalize('NFD').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-${req.query.rango || '24h'}.csv`;
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.type('text/csv; charset=utf-8').send('﻿' + lines.join('\r\n'));
  });

  // ------------------------------------------------------------ ubicaciones

  router.get('/ubicaciones', async (req, res) => {
    const [locations, points] = await Promise.all([repo.listLocations(db, req.org.id), repo.listPoints(db, req.org.id)]);
    send(res, pages.locationsPage(req, { locations, points }));
  });

  router.post('/ubicaciones', requireAdmin, async (req, res) => {
    const name = str(req.body.name, 80);
    const address = str(req.body.address, 160);
    if (!name) {
      const [locations, points] = await Promise.all([repo.listLocations(db, req.org.id), repo.listPoints(db, req.org.id)]);
      return send(res, pages.locationsPage(req, { locations, points, errors: ['El nombre es obligatorio.'], values: req.body }), 422);
    }
    const { rows } = await db.query(
      'INSERT INTO locations (organization_id, name, address) VALUES ($1, $2, $3) RETURNING id',
      [req.org.id, name, address],
    );
    res.redirect(303, `/puntos/nuevo?ubicacion=${rows[0].id}`);
  });

  router.get('/ubicaciones/:id', requireAdmin, async (req, res) => {
    const location = await repo.getLocation(db, req.org.id, req.params.id);
    if (!location) return send(res, pages.simplePage(req, 'No encontrado', 'La ubicación no existe.'), 404);
    send(res, pages.locationEditPage(req, { location }));
  });

  router.post('/ubicaciones/:id', requireAdmin, async (req, res) => {
    const location = await repo.getLocation(db, req.org.id, req.params.id);
    if (!location) return send(res, pages.simplePage(req, 'No encontrado', 'La ubicación no existe.'), 404);
    const name = str(req.body.name, 80);
    if (!name) return send(res, pages.locationEditPage(req, { location, errors: ['El nombre es obligatorio.'] }), 422);
    await db.query('UPDATE locations SET name = $3, address = $4 WHERE organization_id = $1 AND id = $2',
      [req.org.id, location.id, name, str(req.body.address, 160)]);
    res.redirect(303, '/ubicaciones?ok=saved');
  });

  router.post('/ubicaciones/:id/eliminar', requireAdmin, async (req, res) => {
    if (repo.isUuid(req.params.id)) {
      await db.query('DELETE FROM locations WHERE organization_id = $1 AND id = $2', [req.org.id, req.params.id]);
    }
    res.redirect(303, '/ubicaciones?ok=deleted');
  });

  // ------------------------------------------------------------ sensores

  async function renderDevices(req, res, extra = {}, status = 200) {
    const [devices, points] = await Promise.all([repo.listDevices(db, req.org.id), repo.listPoints(db, req.org.id)]);
    send(res, pages.devicesPage(req, { devices, points, fmt, now: clock(), ...extra }), status);
  }

  router.get('/dispositivos', (req, res) => renderDevices(req, res));

  router.post('/dispositivos', requireAdmin, async (req, res) => {
    const name = str(req.body.name, 80);
    const pointId = str(req.body.monitored_point_id, 40) || null;
    const errors = [];
    if (!name) errors.push('El nombre es obligatorio.');
    if (pointId) {
      const p = await repo.getPoint(db, req.org.id, pointId);
      if (!p) errors.push('Punto inválido.');
      else if (p.device_id) errors.push('Ese punto ya tiene un sensor activo.');
    }
    if (errors.length) return renderDevices(req, res, { errors, values: req.body }, 422);
    const t = generateDeviceToken();
    const { rows } = await db.query(
      `INSERT INTO devices (organization_id, monitored_point_id, name, token_hash, token_prefix)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.org.id, pointId, name, t.hash, t.prefix],
    );
    res.set('Cache-Control', 'no-store');
    send(res, pages.deviceTokenPage(req, { device: rows[0], token: t.token, publicUrl: config.publicUrl }), 201);
  });

  router.post('/dispositivos/:id/regenerar', requireAdmin, async (req, res) => {
    const device = await repo.getDevice(db, req.org.id, req.params.id);
    if (!device || device.revoked_at) return send(res, pages.simplePage(req, 'No encontrado', 'El sensor no existe o fue revocado.'), 404);
    const t = generateDeviceToken();
    await db.query('UPDATE devices SET token_hash = $3, token_prefix = $4 WHERE organization_id = $1 AND id = $2',
      [req.org.id, device.id, t.hash, t.prefix]);
    res.set('Cache-Control', 'no-store');
    send(res, pages.deviceTokenPage(req, { device, token: t.token, publicUrl: config.publicUrl }));
  });

  router.post('/dispositivos/:id/revocar', requireAdmin, async (req, res) => {
    if (repo.isUuid(req.params.id)) {
      await db.query(
        `UPDATE devices SET revoked_at = now(), monitored_point_id = NULL
          WHERE organization_id = $1 AND id = $2 AND revoked_at IS NULL`,
        [req.org.id, req.params.id],
      );
    }
    res.redirect(303, '/dispositivos?ok=revoked');
  });

  // ------------------------------------------------------------ alertas

  router.get('/alertas', async (req, res) => {
    const filter = req.query.estado === 'abiertas' ? 'abiertas' : 'todas';
    const alerts = await repo.listAlerts(db, req.org.id, { status: filter === 'abiertas' ? 'open' : null });
    send(res, pages.alertsPage(req, { alerts, filter, fmt }));
  });

  router.post('/alertas/:id/reconocer', async (req, res) => {
    if (repo.isUuid(req.params.id)) {
      await db.query(
        `UPDATE alert_events SET acknowledged_at = now(), acknowledged_by = $3, ack_note = NULLIF($4, '')
          WHERE organization_id = $1 AND id = $2 AND acknowledged_at IS NULL`,
        [req.org.id, req.params.id, req.user.id, str(req.body.note, 300)],
      );
    }
    const back = req.get('referer');
    const target = back && new URL(back, 'http://x').pathname.startsWith('/puntos/') ? new URL(back, 'http://x').pathname : '/alertas';
    res.redirect(303, `${target}?ok=ack`);
  });

  // ------------------------------------------------------------ configuración

  async function renderSettings(req, res, errors = [], status = 200) {
    const org = await repo.getOrganization(db, req.org.id);
    let connState = 'no configurado';
    if (whatsapp.configured) {
      try {
        connState = await whatsapp.connectionState();
        connState = connState === 'open' ? 'Vinculado (open)' : `No vinculado (${connState})`;
      } catch (err) {
        connState = `No disponible: ${err.message}`;
      }
    }
    const notifications = await repo.listNotifications(db, req.org.id);
    send(res, pages.settingsPage(req, {
      org, whatsapp: { configured: whatsapp.configured, instance: whatsapp.instance }, connState, notifications, errors, fmt,
    }), status);
  }

  router.get('/configuracion', (req, res) => renderSettings(req, res));

  router.post('/configuracion', requireAdmin, async (req, res) => {
    const errors = [];
    const name = str(req.body.name, 100);
    if (!name) errors.push('El nombre es obligatorio.');
    const type = BUSINESS_TYPES[req.body.business_type] ? req.body.business_type : null;
    if (!type) errors.push('Rubro inválido.');
    const rawPhones = str(req.body.alert_phones, 1000).split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    const phones = [];
    for (const p of rawPhones) {
      const n = normalizePhone(p);
      if (!n) errors.push(`Número inválido: ${p}`);
      else if (!phones.includes(n)) phones.push(n);
    }
    if (phones.length > 10) errors.push('Máximo 10 números.');
    if (errors.length) return renderSettings(req, res, errors, 422);
    await db.query(
      'UPDATE organizations SET name = $2, business_type = $3, alert_phones = $4, notify_on_resolve = $5 WHERE id = $1',
      [req.org.id, name, type, phones, req.body.notify_on_resolve === '1'],
    );
    res.redirect(303, '/configuracion?ok=saved');
  });

  router.post('/configuracion/whatsapp/prueba', requireAdmin, async (req, res) => {
    const to = normalizePhone(str(req.body.to, 30));
    if (!to) return renderSettings(req, res, ['Número de destino inválido.'], 422);
    const result = await notifier.sendTest(req.org.id, to, req.org.name);
    res.redirect(303, `/configuracion?ok=test_${result.status}`);
  });

  // ------------------------------------------------------------ referencias

  router.get('/referencias', (req, res) => send(res, pages.referencesPage(req)));

  router.use((req, res) => send(res, pages.simplePage(req, 'No encontrado', 'La página no existe.'), 404));
  return router;
}

function parsePointForm(body, locations) {
  const { errors, value } = validateThresholds(body);
  const name = str(body.name, 80);
  if (!name) errors.unshift('El nombre es obligatorio.');
  if (!locations.some((l) => l.id === body.location_id)) errors.push('Ubicación inválida.');
  const kind = POINT_KINDS[body.kind] ? body.kind : 'otro';
  return { errors, value: { ...value, name, kind, location_id: body.location_id } };
}

function safeNext(v) {
  return typeof v === 'string' && /^\/(?![/\\])/.test(v) ? v : '/';
}

/** Evita inyección de fórmulas al abrir el CSV en planillas. */
function csvCell(v) {
  const s = String(v).replace(/[\r\n,]/g, ' ');
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}
