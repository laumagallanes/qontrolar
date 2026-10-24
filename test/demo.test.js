import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { createTestDb, seedBasic, fakeFetch, silentLogger, startApp, browser } from './helpers.js';
import {
  DEMO_DATASET, DEMO_FIRMWARE, DEMO_ORG_NAME, advanceDemo, demoCredentialsFromEnv, seedDemo,
} from '../src/services/demo.js';
import { ingestReadings } from '../src/services/ingestion.js';
import { runBackgroundTick } from '../src/runtime.js';
import { createNotifier } from '../src/services/notifier.js';
import { createEvolutionClient } from '../src/services/whatsapp.js';
import { loadConfig } from '../src/config.js';

const ROOT = path.resolve(import.meta.dirname, '..');
// Valor exclusivo de prueba; no es una credencial real.
const PASSWORD = 'test-only-demo-password-xyz';
const EMAIL = 'demo@test.local';
const NOW = new Date('2026-10-24T12:00:00Z');
const MIN = 60000;
const fixedRng = () => 0.5;

let db, real;
before(async () => {
  db = await createTestDb();
  real = await seedBasic(db, { email: 'admin@real.local', phones: ['5493410000099'] });
  await ingestReadings(db, real.device, [{ temperature: 4, humidity: null, recorded_at: NOW }], { now: NOW });
});
after(async () => db.close());

const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);
const demoOrgId = async () => (await db.query('SELECT id FROM organizations WHERE is_demo')).rows[0]?.id;

async function structureCounts(orgId) {
  return {
    orgs: await count('SELECT count(*) AS n FROM organizations WHERE is_demo'),
    users: await count('SELECT count(*) AS n FROM users WHERE organization_id = $1', [orgId]),
    locations: await count('SELECT count(*) AS n FROM locations WHERE organization_id = $1', [orgId]),
    points: await count('SELECT count(*) AS n FROM monitored_points WHERE organization_id = $1', [orgId]),
    devices: await count('SELECT count(*) AS n FROM devices WHERE organization_id = $1', [orgId]),
    readings: await count(
      'SELECT count(*) AS n FROM readings r JOIN monitored_points p ON p.id = r.monitored_point_id WHERE p.organization_id = $1', [orgId],
    ),
    alerts: await count('SELECT count(*) AS n FROM alert_events WHERE organization_id = $1', [orgId]),
  };
}

async function realSnapshot() {
  return {
    org: (await db.query('SELECT name, is_demo, alert_phones FROM organizations WHERE id = $1', [real.org.id])).rows[0],
    readings: await count('SELECT count(*) AS n FROM readings WHERE monitored_point_id = $1', [real.point.id]),
    device: (await db.query('SELECT firmware, last_seen_at FROM devices WHERE id = $1', [real.device.id])).rows[0],
    point: (await db.query('SELECT last_reading_at, last_temperature FROM monitored_points WHERE id = $1', [real.point.id])).rows[0],
  };
}

// ------------------------------------------------------------- credenciales

test('credenciales demo: se exigen desde el entorno y nunca aparecen en errores', () => {
  assert.throws(() => demoCredentialsFromEnv({}), /DEMO_EMAIL/);
  assert.throws(() => demoCredentialsFromEnv({ DEMO_EMAIL: 'no-es-email' }), /DEMO_EMAIL/);
  const short = 'corta123';
  assert.throws(() => demoCredentialsFromEnv({ DEMO_EMAIL: EMAIL, DEMO_PASSWORD: short }), (err) => {
    assert.match(err.message, /al menos 12/);
    assert.ok(!err.message.includes(short));
    return true;
  });
  assert.throws(() => demoCredentialsFromEnv({ DEMO_EMAIL: EMAIL, DEMO_PASSWORD: 'CHANGE_ME_demo_password' }), /valor de ejemplo/);
  assert.deepEqual(demoCredentialsFromEnv({ DEMO_EMAIL: ' Demo@Test.Local ', DEMO_PASSWORD: PASSWORD }), { email: EMAIL, password: PASSWORD });
  // Sin contraseña sólo se puede reutilizar un usuario demo existente.
  assert.deepEqual(demoCredentialsFromEnv({ DEMO_EMAIL: EMAIL }), { email: EMAIL, password: null });
});

test('credenciales demo: no hay contraseñas por defecto en el código ni en Compose', () => {
  for (const rel of ['src/services/demo.js', 'src/cli/seed-demo.js', 'src/cli/demo-worker.js']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(src, /DEMO_PASSWORD\s*(\|\||\?\?)\s*['"`]/, rel);
    assert.doesNotMatch(src, /password\s*[:=]\s*['"`][^'"`]{6,}['"`]/i, rel);
  }
  const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
  assert.match(compose, /DEMO_EMAIL: \$\{DEMO_EMAIL:-\}/);
  assert.match(compose, /DEMO_PASSWORD: \$\{DEMO_PASSWORD:-\}/);
});

test('seedDemo sin contraseña no crea usuario demo nuevo', async () => {
  const other = await createTestDb();
  try {
    await assert.rejects(seedDemo(other, { email: EMAIL, now: NOW }), /DEMO_PASSWORD/);
    assert.equal(Number((await other.query('SELECT count(*) AS n FROM users')).rows[0].n), 0);
  } finally {
    await other.close();
  }
});

test('seedDemo rechaza un DEMO_EMAIL que pertenece a una organización real', async () => {
  await assert.rejects(seedDemo(db, { email: real.adminEmail, password: PASSWORD, now: NOW, rng: fixedRng }), /organización real/);
  // La organización demo pudo crearse vacía, pero el usuario real no se tocó.
  const u = (await db.query('SELECT organization_id, password_hash FROM users WHERE id = $1', [real.admin.id])).rows[0];
  assert.equal(u.organization_id, real.org.id);
  assert.equal(u.password_hash, real.admin.password_hash);
});

// ------------------------------------------------------------- seed

test('seedDemo crea UNA organización demo con 4 locales de rubros distintos y 8 puntos', async () => {
  const before = await realSnapshot();
  const r = await seedDemo(db, { email: EMAIL, password: PASSWORD, now: NOW, rng: fixedRng });
  assert.equal(r.user, 'created');
  assert.equal(r.devices, 8);
  assert.ok(r.readings > 8 * 200, `historial inicial: ${r.readings}`);

  const orgs = (await db.query('SELECT * FROM organizations WHERE is_demo')).rows;
  assert.equal(orgs.length, 1);
  assert.equal(orgs[0].name, DEMO_ORG_NAME);
  assert.deepEqual(orgs[0].alert_phones, []);
  assert.equal(orgs[0].id, r.organizationId);

  const locs = (await db.query('SELECT name FROM locations WHERE organization_id = $1 ORDER BY name', [r.organizationId])).rows;
  assert.deepEqual(locs.map((l) => l.name), DEMO_DATASET.map((l) => l.name).sort());
  assert.deepEqual(new Set(DEMO_DATASET.map((l) => l.business)), new Set(['restaurante', 'farmacia', 'carniceria', 'veterinaria']));
  for (const l of locs) assert.match(l.name, /\(demo\)$/);

  const counts = await structureCounts(r.organizationId);
  assert.equal(counts.points, 8);
  assert.equal(counts.devices, 8);
  assert.equal(counts.users, 1);
  assert.equal(await count('SELECT count(*) AS n FROM devices WHERE organization_id = $1 AND firmware = $2', [r.organizationId, DEMO_FIRMWARE]), 8);

  const user = (await db.query('SELECT role, password_hash FROM users WHERE email = $1', [EMAIL])).rows[0];
  assert.equal(user.role, 'admin');
  assert.ok(!user.password_hash.includes(PASSWORD), 'la contraseña se guarda hasheada');

  assert.deepEqual(await realSnapshot(), before, 'la organización real no cambia');
});

test('segundo seed con el mismo "now" es idempotente: sin estructura ni lecturas duplicadas', async () => {
  const orgId = await demoOrgId();
  const first = await structureCounts(orgId);
  const r = await seedDemo(db, { email: EMAIL, password: PASSWORD, now: NOW, rng: fixedRng });
  assert.equal(r.user, 'existing');
  assert.equal(r.created, 0);
  assert.equal(r.readings, 0);
  assert.deepEqual(await structureCounts(orgId), first);
  const dupes = await count(
    `SELECT count(*) AS n FROM (SELECT monitored_point_id, recorded_at FROM readings GROUP BY 1, 2 HAVING count(*) > 1) d`,
  );
  assert.equal(dupes, 0);
});

// ------------------------------------------------------------- simulador

test('advanceDemo escribe lecturas recientes sólo en sensores demo; no toca la organización real', async () => {
  const orgId = await demoOrgId();
  const before = await realSnapshot();
  const later = new Date(NOW.getTime() + 30 * MIN);
  const r = await advanceDemo(db, { now: later, rng: fixedRng });
  // 7 sensores activos x 6 pasos de 5 min; el sensor "offline" no vuelve a reportar.
  assert.equal(r.readings, 7 * 6);

  const fresh = (await db.query(
    `SELECT DISTINCT d.firmware, p.organization_id
       FROM readings r JOIN monitored_points p ON p.id = r.monitored_point_id JOIN devices d ON d.id = r.device_id
      WHERE r.recorded_at > $1`,
    [NOW],
  )).rows;
  assert.deepEqual(fresh, [{ firmware: DEMO_FIRMWARE, organization_id: orgId }]);
  const newest = (await db.query('SELECT max(recorded_at) AS t FROM readings r JOIN devices d ON d.id = r.device_id WHERE d.firmware = $1', [DEMO_FIRMWARE])).rows[0].t;
  assert.equal(new Date(newest).getTime(), later.getTime());

  assert.deepEqual(await realSnapshot(), before);

  // Repetir el ciclo con el mismo instante no agrega nada.
  assert.equal((await advanceDemo(db, { now: later, rng: fixedRng })).readings, 0);
});

test('advanceDemo ignora sensores no demo aunque tengan el firmware del simulador', async () => {
  await db.query('UPDATE devices SET firmware = $2 WHERE id = $1', [real.device.id, DEMO_FIRMWARE]);
  try {
    const before = await count('SELECT count(*) AS n FROM readings WHERE device_id = $1', [real.device.id]);
    await advanceDemo(db, { now: new Date(NOW.getTime() + 60 * MIN), rng: fixedRng });
    assert.equal(await count('SELECT count(*) AS n FROM readings WHERE device_id = $1', [real.device.id]), before);
  } finally {
    await db.query('UPDATE devices SET firmware = NULL WHERE id = $1', [real.device.id]);
  }
});

test('escenario offline: la tarea de fondo abre UNA alerta de desconexión y no envía WhatsApp demo', async () => {
  const orgId = await demoOrgId();
  // Aunque alguien cargue un teléfono en la organización demo, no debe salir ningún mensaje.
  await db.query(`UPDATE organizations SET alert_phones = '{5493410000123}', notify_on_resolve = true WHERE id = $1`, [orgId]);
  const fetchImpl = fakeFetch();
  const whatsapp = createEvolutionClient({ url: 'http://evo', apiKey: 'k', instance: 'i', fetchImpl });
  const notifier = createNotifier({ db, whatsapp, logger: silentLogger });
  const config = loadConfig({ DATABASE_URL: 'x' });

  const t = new Date(NOW.getTime() + 61 * MIN);
  await advanceDemo(db, { now: t, rng: fixedRng });
  await runBackgroundTick({ db, notifier, config, now: t, logger: silentLogger });
  await runBackgroundTick({ db, notifier, config, now: new Date(t.getTime() + 5 * MIN), logger: silentLogger });

  const offline = (await db.query(
    `SELECT a.*, p.name FROM alert_events a JOIN monitored_points p ON p.id = a.monitored_point_id
      WHERE a.organization_id = $1 AND a.type = 'device_offline'`,
    [orgId],
  )).rows;
  assert.equal(offline.length, 1);
  assert.equal(offline[0].status, 'open');
  assert.equal(offline[0].name, 'Heladera de vacunas');

  // Las excursiones del escenario "excursion" también pasan por el notificador.
  const tempAlerts = (await db.query(`SELECT * FROM alert_events WHERE organization_id = $1 AND type <> 'device_offline'`, [orgId])).rows;
  assert.ok(tempAlerts.length > 0, 'el historial incluye excursiones');
  await notifier.notifyEvents(tempAlerts.map((alert) => ({ transition: alert.status === 'open' ? 'opened' : 'resolved', alert })));

  assert.deepEqual(fetchImpl.calls.filter((c) => c.body?.number === '5493410000123'), []);
  assert.equal(await count('SELECT count(*) AS n FROM notifications WHERE organization_id = $1 AND status = $2', [orgId, 'sent']), 0);

  const test = await notifier.sendTest(orgId, '5493410000123', DEMO_ORG_NAME);
  assert.equal(test.status, 'demo');
  // Sólo la organización real (su sensor dejó de reportar en NOW) recibe mensajes.
  assert.deepEqual([...new Set(fetchImpl.calls.map((c) => c.body.number))], ['5493410000099']);
});

// ------------------------------------------------------------- panel

test('login del usuario demo: el panel se rotula DEMO con datos simulados; el real no', async () => {
  const srv = await startApp({ db });
  try {
    const demo = browser(srv.base);
    const login = await demo.login(EMAIL, PASSWORD);
    assert.equal(login.status, 303);
    const dash = await demo.get('/');
    assert.equal(dash.status, 200);
    assert.match(dash.text, /<title>DEMO · /);
    assert.match(dash.text, /class="demo-banner"/);
    assert.match(dash.text, /Datos simulados \(DEMO\)/);
    assert.match(dash.text, /Farmacia del Parque \(demo\)/);
    assert.match(dash.text, /Veterinaria Patitas \(demo\)/);
    assert.doesNotMatch(dash.text, /Heladera 1/, 'no ve datos del cliente real');

    const client = browser(srv.base);
    await client.login(real.adminEmail, real.password);
    const realDash = await client.get('/');
    assert.equal(realDash.status, 200);
    assert.doesNotMatch(realDash.text, /demo-banner|DEMO · |\(demo\)/);
  } finally {
    await srv.close();
  }
});

// ------------------------------------------------------------- CLI

test('seed:demo CLI no imprime la contraseña ni tokens', async () => {
  const run = promisify(execFile);
  const { stdout, stderr } = await run(process.execPath, [path.join(ROOT, 'src/cli/seed-demo.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, DATABASE_URL: 'pglite://memory', DEMO_EMAIL: EMAIL, DEMO_PASSWORD: PASSWORD },
    timeout: 60000,
  });
  const out = stdout + stderr;
  assert.match(out, /organización DEMO lista: usuario created/);
  assert.ok(!out.includes(PASSWORD));
  assert.doesNotMatch(out, /qdev_/);

  await assert.rejects(
    run(process.execPath, [path.join(ROOT, 'src/cli/seed-demo.js')], {
      cwd: ROOT, env: { PATH: process.env.PATH, DATABASE_URL: 'pglite://memory' }, timeout: 60000,
    }),
    (err) => err.code === 1 && /DEMO_EMAIL/.test(err.stderr),
  );
});
