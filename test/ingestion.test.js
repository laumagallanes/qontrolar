import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, seedBasic, startApp, postReading } from './helpers.js';
import { parseReadingsPayload, IngestError, parseBearer } from '../src/services/ingestion.js';

let db, ctx, srv;
before(async () => {
  db = await createTestDb();
  ctx = await seedBasic(db);
  srv = await startApp({ db });
});
after(async () => {
  await srv.close();
  await db.close();
});

test('lectura válida se persiste y actualiza estado y last_seen del sensor', async () => {
  const res = await postReading(srv.base, ctx.token, { temperature: 4.25, humidity: 61.4 });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.accepted, 1);
  assert.equal(body.point.status, 'ok');

  const r = await db.query('SELECT * FROM readings WHERE monitored_point_id = $1', [ctx.point.id]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].temperature, 4.25);
  assert.equal(r.rows[0].humidity, 61.4);
  assert.equal(r.rows[0].device_id, ctx.device.id);

  const p = (await db.query('SELECT * FROM monitored_points WHERE id = $1', [ctx.point.id])).rows[0];
  assert.equal(p.last_temperature, 4.25);
  const d = (await db.query('SELECT * FROM devices WHERE id = $1', [ctx.device.id])).rows[0];
  assert.ok(d.last_seen_at);
});

test('lote de lecturas con recorded_at (reenvío tras corte de red) se guarda completo', async () => {
  const now = Date.now();
  const readings = [3, 2, 1].map((m) => ({ temperature: 5 + m / 10, recorded_at: new Date(now - m * 60000).toISOString() }));
  const res = await postReading(srv.base, ctx.token, { readings });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).accepted, 3);
  const { rows } = await db.query('SELECT count(*) AS n FROM readings WHERE monitored_point_id = $1', [ctx.point.id]);
  assert.equal(rows[0].n, 4);
});

test('lectura antigua llega fuera de orden: se guarda en el historial pero no pisa el estado actual', async () => {
  const before = (await db.query('SELECT last_temperature FROM monitored_points WHERE id = $1', [ctx.point.id])).rows[0];
  const res = await postReading(srv.base, ctx.token, { temperature: 30, recorded_at: new Date(Date.now() - 3600000).toISOString() });
  assert.equal(res.status, 201);
  const after = (await db.query('SELECT last_temperature FROM monitored_points WHERE id = $1', [ctx.point.id])).rows[0];
  assert.equal(after.last_temperature, before.last_temperature);
  const open = await db.query(`SELECT * FROM alert_events WHERE monitored_point_id = $1 AND status = 'open'`, [ctx.point.id]);
  assert.equal(open.rows.length, 0);
});

test('validación del cuerpo', async () => {
  const cases = [
    [{ temperature: 'cuatro' }, 400, 'invalid_temperature'],
    [{}, 400, 'invalid_temperature'],
    [{ temperature: 150 }, 422, 'temperature_out_of_sensor_range'],
    [{ temperature: 4, humidity: 120 }, 400, 'invalid_humidity'],
    [{ temperature: 4, recorded_at: 'ayer' }, 400, 'invalid_recorded_at'],
    [{ temperature: 4, recorded_at: new Date(Date.now() + 3600000).toISOString() }, 422, 'recorded_at_in_future'],
    [{ temperature: 4, recorded_at: new Date(Date.now() - 8 * 86400000).toISOString() }, 422, 'recorded_at_too_old'],
    [{ readings: [] }, 400, 'invalid_body'],
    [{ readings: Array.from({ length: 101 }, () => ({ temperature: 1 })) }, 413, 'batch_too_large'],
  ];
  for (const [body, status, code] of cases) {
    const res = await postReading(srv.base, ctx.token, body);
    assert.equal(res.status, status, JSON.stringify(body).slice(0, 80));
    assert.equal((await res.json()).error, code);
  }
  const bad = await postReading(srv.base, ctx.token, '{"temperature": ');
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'invalid_json');
});

test('parseReadingsPayload acepta epoch en segundos y ordena por tiempo', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  const out = parseReadingsPayload({ readings: [
    { temperature: 1, recorded_at: now.getTime() / 1000 - 60 },
    { temperature: 2, recorded_at: now.getTime() / 1000 - 120 },
  ] }, now);
  assert.deepEqual(out.map((r) => r.temperature), [2, 1]);
  assert.throws(() => parseReadingsPayload([1, 2], now), IngestError);
});

test('parseBearer', () => {
  assert.equal(parseBearer('Bearer abc'), 'abc');
  assert.equal(parseBearer('bearer   abc '), 'abc');
  assert.equal(parseBearer('Basic abc'), null);
  assert.equal(parseBearer(undefined), null);
});

test('sensor no asignado a un punto recibe 409', async () => {
  await db.query('UPDATE devices SET monitored_point_id = NULL WHERE id = $1', [ctx.device.id]);
  const res = await postReading(srv.base, ctx.token, { temperature: 4 });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'device_not_assigned');
  await db.query('UPDATE devices SET monitored_point_id = $2 WHERE id = $1', [ctx.device.id, ctx.point.id]);
});
