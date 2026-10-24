import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, seedBasic, startApp, browser, postReading, settle } from './helpers.js';
import { classifyTemperature, pointStatus, validateThresholds } from '../src/services/thresholds.js';
import { ingestReadings } from '../src/services/ingestion.js';

// ------------------------------------------------------------- lógica pura

test('classifyTemperature: límites inclusivos', () => {
  const p = { min_temp: 2, max_temp: 8 };
  assert.equal(classifyTemperature(2, p), 'ok');
  assert.equal(classifyTemperature(8, p), 'ok');
  assert.equal(classifyTemperature(8.01, p), 'high');
  assert.equal(classifyTemperature(1.99, p), 'low');
});

test('validateThresholds', () => {
  const ok = validateThresholds({ min_temp: '-20', max_temp: '-15', alert_delay_minutes: '10', offline_after_minutes: '15' });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.value.min_temp, -20);
  assert.ok(validateThresholds({ min_temp: '5', max_temp: '5', alert_delay_minutes: '0', offline_after_minutes: '15' }).errors.length);
  assert.ok(validateThresholds({ min_temp: '', max_temp: '5', alert_delay_minutes: '0', offline_after_minutes: '15' }).errors.length);
  assert.ok(validateThresholds({ min_temp: '1', max_temp: '5', alert_delay_minutes: '-1', offline_after_minutes: '15' }).errors.length);
  assert.ok(validateThresholds({ min_temp: '1', max_temp: '5', alert_delay_minutes: '0', offline_after_minutes: '1' }).errors.length);
});

test('pointStatus: en rango, pendiente, confirmado, offline, sin datos', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  const base = { min_temp: 2, max_temp: 8, alert_delay_minutes: 10, offline_after_minutes: 15, device_id: 'd', device_last_seen_at: now, last_reading_at: now };
  assert.equal(pointStatus({ ...base, last_temperature: 5 }, now), 'ok');
  assert.equal(pointStatus({ ...base, last_temperature: 9, out_of_range_since: new Date(now - 5 * 60000) }, now), 'pending_high');
  assert.equal(pointStatus({ ...base, last_temperature: 9, out_of_range_since: new Date(now - 11 * 60000) }, now), 'high');
  assert.equal(pointStatus({ ...base, last_temperature: 1, out_of_range_since: now, has_open_temp_alert: true }, now), 'low');
  assert.equal(pointStatus({ ...base, last_temperature: 5, device_last_seen_at: new Date(now - 16 * 60000) }, now), 'offline');
  assert.equal(pointStatus({ ...base, last_temperature: null, device_last_seen_at: null, last_reading_at: null }, now), 'no_data');
  assert.equal(pointStatus({ ...base, device_id: null, last_reading_at: null }, now), 'no_device');
});

// ------------------------------------------------------------- creación de alertas

let db;
before(async () => {
  db = await createTestDb();
});
after(async () => db.close());

const T0 = new Date('2026-10-24T10:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60000);
const reading = (temperature, min) => ({ temperature, humidity: null, recorded_at: at(min) });
const alertsOf = async (pointId) => (await db.query('SELECT * FROM alert_events WHERE monitored_point_id = $1 ORDER BY started_at', [pointId])).rows;

test('demora de alerta: excursión breve no alerta; sostenida abre UNA alerta y luego se resuelve', async () => {
  const s = await seedBasic(db, { delay: 10, email: 'admin@delay.local' });
  const ingest = (r) => ingestReadings(db, s.device, [r], { now: r.recorded_at });

  await ingest(reading(5, 0));
  // Apertura de puerta: 6 minutos fuera de rango -> sin alerta.
  await ingest(reading(9, 1));
  await ingest(reading(9.5, 7));
  await ingest(reading(6, 8));
  assert.equal((await alertsOf(s.point.id)).length, 0);

  // Excursión sostenida.
  await ingest(reading(9, 20));
  let r = await ingest(reading(10, 25));
  assert.equal(r.events.length, 0, 'todavía dentro de la demora');
  r = await ingest(reading(11.5, 30));
  assert.deepEqual(r.events.map((e) => [e.transition, e.alert.type]), [['opened', 'temp_high']]);
  r = await ingest(reading(12.4, 35));
  assert.equal(r.events.length, 0, 'sin duplicados mientras sigue abierta');

  let alerts = await alertsOf(s.point.id);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].status, 'open');
  assert.equal(alerts[0].started_at.getTime(), at(20).getTime(), 'inicio = comienzo de la excursión');
  assert.equal(alerts[0].threshold, 8);
  assert.equal(alerts[0].trigger_value, 11.5);
  assert.equal(alerts[0].peak_value, 12.4);

  r = await ingest(reading(6, 40));
  assert.deepEqual(r.events.map((e) => [e.transition, e.alert.type]), [['resolved', 'temp_high']]);
  alerts = await alertsOf(s.point.id);
  assert.equal(alerts[0].status, 'resolved');
  assert.equal(alerts[0].resolved_at.getTime(), at(40).getTime());
  const p = (await db.query('SELECT out_of_range_since FROM monitored_points WHERE id = $1', [s.point.id])).rows[0];
  assert.equal(p.out_of_range_since, null);
});

test('temperatura baja y cambio de lado (alta -> baja) cierran y abren alertas correctas', async () => {
  const s = await seedBasic(db, { delay: 0, email: 'admin@lados.local' });
  const ingest = (r) => ingestReadings(db, s.device, [r], { now: r.recorded_at });
  let r = await ingest(reading(1.5, 0));
  assert.deepEqual(r.events.map((e) => [e.transition, e.alert.type]), [['opened', 'temp_low']]);
  r = await ingest(reading(9, 5));
  assert.deepEqual(r.events.map((e) => [e.transition, e.alert.type]), [['resolved', 'temp_low'], ['opened', 'temp_high']]);
  const alerts = await alertsOf(s.point.id);
  assert.deepEqual(alerts.map((a) => [a.type, a.status]), [['temp_low', 'resolved'], ['temp_high', 'open']]);
});

// ------------------------------------------------------------- de punta a punta por HTTP

let srv;
beforeEach(async () => {
  if (srv) await srv.close();
  srv = await startApp({ db });
});
after(async () => srv?.close());

test('E2E: admin configura umbrales vía panel, el sensor reporta fuera de rango, se crea el evento y se notifica por WhatsApp', async () => {
  const s = await seedBasic(db, { email: 'admin@e2e.local', phones: ['5493410000009'] });
  const b = browser(srv.base);
  await b.login(s.adminEmail, s.password);
  const csrf = await b.csrf();

  // Umbrales inválidos -> 422 y sin cambios.
  const bad = await b.post(`/puntos/${s.point.id}`, {
    _csrf: csrf, name: 'Freezer', location_id: s.location.id, kind: 'freezer', min_temp: '-10', max_temp: '-20', alert_delay_minutes: '0', offline_after_minutes: '15',
  });
  assert.equal(bad.status, 422);
  assert.match(bad.text, /La mínima debe ser menor que la máxima/);

  const ok = await b.post(`/puntos/${s.point.id}`, {
    _csrf: csrf, name: 'Freezer', location_id: s.location.id, kind: 'freezer', min_temp: '-25', max_temp: '-15', alert_delay_minutes: '0', offline_after_minutes: '15',
  });
  assert.equal(ok.status, 303);
  const p = (await db.query('SELECT * FROM monitored_points WHERE id = $1', [s.point.id])).rows[0];
  assert.equal(p.min_temp, -25);
  assert.equal(p.max_temp, -15);

  const res = await postReading(srv.base, s.token, { temperature: -10.5 });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.point.status, 'high');
  assert.deepEqual(body.events, [{ transition: 'opened', type: 'temp_high' }]);
  await settle();

  const alerts = await alertsOf(s.point.id);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].threshold, -15);

  const sends = srv.fetchImpl.calls.filter((c) => c.body?.number === '5493410000009');
  assert.equal(sends.length, 1);
  assert.match(sends[0].body.text, /Temperatura ALTA/);
  assert.match(sends[0].body.text, /Freezer \(Local\)/);
  const notif = (await db.query(`SELECT * FROM notifications WHERE alert_event_id = $1`, [alerts[0].id])).rows;
  assert.equal(notif.length, 1);
  assert.equal(notif[0].status, 'sent');

  // Dashboard y página del punto muestran el estado y el evento.
  const home = await b.get('/');
  assert.match(home.text, /Alertas abiertas/);
  const detail = await b.get(`/puntos/${s.point.id}`);
  assert.match(detail.text, /Temperatura alta/);
  assert.match(detail.text, /<svg/);

  // Reconocer la alerta con nota de acción correctiva.
  const ack = await b.request(`/alertas/${alerts[0].id}/reconocer`, { method: 'POST', form: { _csrf: csrf, note: 'Se cerró la puerta' } });
  assert.equal(ack.status, 303);
  const acked = (await db.query('SELECT * FROM alert_events WHERE id = $1', [alerts[0].id])).rows[0];
  assert.ok(acked.acknowledged_at);
  assert.equal(acked.ack_note, 'Se cerró la puerta');

  // Vuelve al rango -> se resuelve y se notifica normalización.
  const back = await postReading(srv.base, s.token, { temperature: -18 });
  assert.deepEqual((await back.json()).events, [{ transition: 'resolved', type: 'temp_high' }]);
  await settle();
  assert.equal(srv.fetchImpl.calls.filter((c) => c.body?.number === '5493410000009').length, 2);

  // Exportación CSV del historial (registro operativo).
  const csv = await b.get(`/puntos/${s.point.id}/export.csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text, /Registro operativo/);
  assert.match(csv.text, /-10\.5,,si/);
});

test('crear punto exige umbrales explícitos (no hay valores legales precargados)', async () => {
  const s = await seedBasic(db, { email: 'admin@nuevo.local' });
  const b = browser(srv.base);
  await b.login(s.adminEmail, s.password);
  const form = await b.get('/puntos/nuevo');
  assert.match(form.text, /name="min_temp" type="number" step="0.1" value=""/);
  assert.match(form.text, /no precarga temperaturas como requisito legal/);
  const csrf = await b.csrf();
  const missing = await b.post('/puntos', { _csrf: csrf, name: 'Nueva', location_id: s.location.id, kind: 'heladera', min_temp: '', max_temp: '', alert_delay_minutes: '10', offline_after_minutes: '15' });
  assert.equal(missing.status, 422);
  const created = await b.post('/puntos', { _csrf: csrf, name: 'Nueva', location_id: s.location.id, kind: 'heladera', min_temp: '1', max_temp: '4', alert_delay_minutes: '10', offline_after_minutes: '15' });
  assert.equal(created.status, 303);
  assert.match(created.headers.get('location'), /^\/puntos\/[0-9a-f-]{36}\?ok=created$/);
});
