import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, seedBasic, fakeFetch, silentLogger } from './helpers.js';
import { checkOfflineDevices } from '../src/services/alerts.js';
import { ingestReadings } from '../src/services/ingestion.js';
import { runBackgroundTick } from '../src/runtime.js';
import { createNotifier } from '../src/services/notifier.js';
import { createEvolutionClient } from '../src/services/whatsapp.js';
import { loadConfig } from '../src/config.js';

let db;
before(async () => {
  db = await createTestDb();
});
after(async () => db.close());

const T0 = new Date('2026-10-24T10:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60000);
const openOffline = async (pointId) =>
  (await db.query(`SELECT * FROM alert_events WHERE monitored_point_id = $1 AND type = 'device_offline' AND status = 'open'`, [pointId])).rows;

test('sensor nunca visto no genera alerta de desconexión', async () => {
  const s = await seedBasic(db, { email: 'admin@nunca.local' });
  const events = await checkOfflineDevices(db, at(600));
  assert.equal(events.filter((e) => e.alert.monitored_point_id === s.point.id).length, 0);
});

test('sin datos más allá de offline_after_minutes abre UNA alerta; nueva lectura la resuelve', async () => {
  const s = await seedBasic(db, { email: 'admin@offline.local', offlineAfter: 15 });
  await ingestReadings(db, s.device, [{ temperature: 4, humidity: null, recorded_at: at(0) }], { now: at(0) });

  // 14 min: todavía en línea.
  let events = await checkOfflineDevices(db, at(14));
  assert.equal(events.filter((e) => e.alert.monitored_point_id === s.point.id).length, 0);

  // 16 min: desconectado.
  events = await checkOfflineDevices(db, at(16));
  const mine = events.filter((e) => e.alert.monitored_point_id === s.point.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].alert.type, 'device_offline');
  assert.equal(mine[0].alert.started_at.getTime(), at(0).getTime(), 'inicio = última vez visto');
  assert.equal(mine[0].alert.threshold, 15);

  // Idempotente: chequeos repetidos no duplican.
  await checkOfflineDevices(db, at(30));
  await checkOfflineDevices(db, at(60));
  assert.equal((await openOffline(s.point.id)).length, 1);

  // Vuelve a reportar.
  const r = await ingestReadings(db, s.device, [{ temperature: 4.1, humidity: null, recorded_at: at(70) }], { now: at(70) });
  assert.deepEqual(r.events.map((e) => [e.transition, e.alert.type]), [['resolved', 'device_offline']]);
  assert.equal((await openOffline(s.point.id)).length, 0);
});

test('sensor revocado o sin punto no genera alerta de desconexión', async () => {
  const s = await seedBasic(db, { email: 'admin@revocado.local' });
  await ingestReadings(db, s.device, [{ temperature: 4, humidity: null, recorded_at: at(0) }], { now: at(0) });
  await db.query('UPDATE devices SET revoked_at = now() WHERE id = $1', [s.device.id]);
  const events = await checkOfflineDevices(db, at(120));
  assert.equal(events.filter((e) => e.alert.monitored_point_id === s.point.id).length, 0);
});

test('tarea de fondo detecta desconexión y notifica por WhatsApp', async () => {
  const s = await seedBasic(db, { email: 'admin@tick.local', phones: ['5493410000077'] });
  await ingestReadings(db, s.device, [{ temperature: 4, humidity: null, recorded_at: at(0) }], { now: at(0) });
  const fetchImpl = fakeFetch();
  const whatsapp = createEvolutionClient({ url: 'http://evo', apiKey: 'k', instance: 'i', fetchImpl });
  const notifier = createNotifier({ db, whatsapp, logger: silentLogger });
  const config = loadConfig({ DATABASE_URL: 'x' });
  await runBackgroundTick({ db, notifier, config, now: at(30), logger: silentLogger });
  const sent = fetchImpl.calls.filter((c) => c.body.number === '5493410000077');
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.text, /Sensor sin conexión/);
  assert.match(sent[0].body.text, /Heladera 1 \(Local\)/);
});
