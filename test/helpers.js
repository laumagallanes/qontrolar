import { createDb, migrate } from '../src/db/index.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createNotifier } from '../src/services/notifier.js';
import { createEvolutionClient } from '../src/services/whatsapp.js';
import { generateDeviceToken, hashPassword } from '../src/lib/security.js';

export const silentLogger = { log() {}, warn() {}, error() {} };

/** Fetch falso que registra las llamadas a Evolution API. */
export function fakeFetch(handler = () => ({ status: 201, body: { key: { id: 'MSG1' } } })) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const r = await handler(url, init);
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status });
  };
  fn.calls = calls;
  return fn;
}

export async function createTestDb() {
  const db = await createDb('pglite://memory');
  await migrate(db);
  return db;
}

/** Crea organización + admin + viewer + ubicación + punto + sensor. */
export async function seedBasic(db, { min = 2, max = 8, delay = 0, offlineAfter = 15, orgName = 'Comercio Test', email = 'admin@test.local', phones = ['5493410000001'] } = {}) {
  const org = (await db.query(
    `INSERT INTO organizations (name, business_type, alert_phones) VALUES ($1, 'carniceria', $2) RETURNING *`, [orgName, phones],
  )).rows[0];
  const password = 'test-only-password-not-secret';
  const hash = await hashPassword(password);
  const admin = (await db.query(
    `INSERT INTO users (organization_id, email, name, password_hash, role) VALUES ($1, $2, 'Admin', $3, 'admin') RETURNING *`,
    [org.id, email, hash],
  )).rows[0];
  const viewerEmail = email.replace('admin', 'viewer');
  const viewer = (await db.query(
    `INSERT INTO users (organization_id, email, name, password_hash, role) VALUES ($1, $2, 'Lectura', $3, 'viewer') RETURNING *`,
    [org.id, viewerEmail, hash],
  )).rows[0];
  const location = (await db.query(
    `INSERT INTO locations (organization_id, name) VALUES ($1, 'Local') RETURNING *`, [org.id],
  )).rows[0];
  const point = (await db.query(
    `INSERT INTO monitored_points (organization_id, location_id, name, kind, min_temp, max_temp, alert_delay_minutes, offline_after_minutes)
     VALUES ($1, $2, 'Heladera 1', 'heladera', $3, $4, $5, $6) RETURNING *`,
    [org.id, location.id, min, max, delay, offlineAfter],
  )).rows[0];
  const t = generateDeviceToken();
  const device = (await db.query(
    `INSERT INTO devices (organization_id, monitored_point_id, name, token_hash, token_prefix) VALUES ($1, $2, 'ESP32', $3, $4) RETURNING *`,
    [org.id, point.id, t.hash, t.prefix],
  )).rows[0];
  return { org, admin, viewer, location, point, device, token: t.token, password, adminEmail: email, viewerEmail };
}

/** Levanta la app en un puerto efímero con WhatsApp falso. */
export async function startApp({ db, fetchImpl = fakeFetch(), evolution = { url: 'http://evolution.test', apiKey: 'test-api-key-SECRET', instance: 'qontrolar' }, clock } = {}) {
  const config = loadConfig({ DATABASE_URL: 'pglite://memory', PUBLIC_URL: 'https://monitor.example.com' });
  const whatsapp = createEvolutionClient({ ...evolution, fetchImpl, timeoutMs: 500 });
  const notifier = createNotifier({ db, whatsapp, timezone: config.timezone, logger: silentLogger });
  const app = createApp({ db, config, whatsapp, notifier, clock, logger: silentLogger });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, server, fetchImpl, notifier, whatsapp, close: () => new Promise((r) => server.close(r)) };
}

/** Cliente HTTP con cookies para el panel. */
export function browser(base) {
  let cookie = '';
  async function request(path, { method = 'GET', form, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        ...headers,
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  }
  return {
    request,
    get: (path) => request(path),
    post: (path, form) => request(path, { method: 'POST', form }),
    async login(email, password) {
      return request('/login', { method: 'POST', form: { email, password, next: '/' } });
    },
    async csrf() {
      const page = await request('/configuracion');
      const m = /name="_csrf" value="([^"]+)"/.exec(page.text);
      if (!m) throw new Error('no se encontró token CSRF');
      return m[1];
    },
    get cookie() {
      return cookie;
    },
  };
}

export function postReading(base, token, body) {
  return fetch(`${base}/api/v1/readings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Espera a que terminen tareas en segundo plano (notificaciones fire-and-forget). */
export const settle = () => new Promise((r) => setTimeout(r, 50));
