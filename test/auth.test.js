import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, seedBasic, startApp, browser, postReading } from './helpers.js';
import { hashPassword, verifyPassword, sha256 } from '../src/lib/security.js';

let db, ctx, other, srv;
before(async () => {
  db = await createTestDb();
  ctx = await seedBasic(db);
  other = await seedBasic(db, { orgName: 'Otra organización', email: 'admin@otra.local' });
  srv = await startApp({ db });
});
after(async () => {
  await srv.close();
  await db.close();
});

// ------------------------------------------------------------- API de sensores

test('API: sin token, token inválido o con formato erróneo -> 401', async () => {
  for (const token of [null, 'qdev_inexistente', 'otro-formato', 'x'.repeat(300)]) {
    const res = await postReading(srv.base, token, { temperature: 4 });
    assert.equal(res.status, 401, String(token).slice(0, 20));
    assert.equal(res.headers.get('www-authenticate'), 'Bearer realm="qontrolar"');
  }
  const basic = await fetch(`${srv.base}/api/v1/readings`, {
    method: 'POST', headers: { authorization: `Basic ${ctx.token}`, 'content-type': 'application/json' }, body: '{"temperature":4}',
  });
  assert.equal(basic.status, 401);
});

test('API: token sólo se guarda hasheado', async () => {
  const { rows } = await db.query('SELECT token_hash, token_prefix FROM devices WHERE id = $1', [ctx.device.id]);
  assert.equal(rows[0].token_hash, sha256(ctx.token));
  assert.notEqual(rows[0].token_hash, ctx.token);
  assert.ok(ctx.token.startsWith(rows[0].token_prefix));
});

test('API: cada token escribe sólo en su propio punto', async () => {
  const res = await postReading(srv.base, other.token, { temperature: 3.3 });
  assert.equal(res.status, 201);
  const mine = await db.query('SELECT count(*) AS n FROM readings WHERE monitored_point_id = $1', [ctx.point.id]);
  const theirs = await db.query('SELECT count(*) AS n FROM readings WHERE monitored_point_id = $1', [other.point.id]);
  assert.equal(mine.rows[0].n, 0);
  assert.equal(theirs.rows[0].n, 1);
});

test('API: token revocado deja de funcionar', async () => {
  const s = await seedBasic(db, { orgName: 'Revocada', email: 'admin@revocada.local' });
  assert.equal((await postReading(srv.base, s.token, { temperature: 4 })).status, 201);
  await db.query('UPDATE devices SET revoked_at = now() WHERE id = $1', [s.device.id]);
  assert.equal((await postReading(srv.base, s.token, { temperature: 4 })).status, 401);
});

// ------------------------------------------------------------- panel

test('contraseñas: scrypt con verificación correcta', async () => {
  const h = await hashPassword('una-clave-larga');
  assert.match(h, /^scrypt\$/);
  assert.equal(await verifyPassword('una-clave-larga', h), true);
  assert.equal(await verifyPassword('otra', h), false);
  assert.equal(await verifyPassword('x', 'basura'), false);
});

test('contraseñas: parámetros o longitudes scrypt adulterados se rechazan sin lanzar excepción', async () => {
  const h = await hashPassword('una-clave-larga');
  const parts = h.split('$');
  const variants = [];
  for (const [index, value] of [[1, '1073741824'], [2, '512'], [3, '999999'], [4, 'AA=='], [5, Buffer.from('x').toString('base64')]]) {
    const altered = [...parts];
    altered[index] = value;
    variants.push(altered.join('$'));
  }
  variants.push('scrypt$'.padEnd(1001, 'x'));
  for (const altered of variants) {
    await assert.doesNotReject(async () => {
      assert.equal(await verifyPassword('una-clave-larga', altered), false);
    });
  }
});

test('panel: sin sesión redirige a /login y los POST devuelven 401', async () => {
  const b = browser(srv.base);
  const res = await b.get('/');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login?next=%2F');
  assert.equal((await b.get('/alertas')).status, 303);
  assert.equal((await b.post('/configuracion', { name: 'x' })).status, 401);
});

test('panel: login incorrecto -> 401; correcto -> cookie HttpOnly y acceso', async () => {
  const b = browser(srv.base);
  const bad = await b.login(ctx.adminEmail, 'incorrecta');
  assert.equal(bad.status, 401);
  assert.match(bad.text, /Email o contraseña incorrectos/);
  const unknown = await b.login('nadie@test.local', 'x');
  assert.equal(unknown.status, 401);

  const ok = await b.login(ctx.adminEmail.toUpperCase(), ctx.password);
  assert.equal(ok.status, 303);
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const home = await b.get('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /Comercio Test/);
  assert.match(home.text, /Heladera 1/);
});

test('panel: redirección post-login sólo a rutas locales', async () => {
  const b = browser(srv.base);
  const res = await b.request('/login', { method: 'POST', form: { email: ctx.adminEmail, password: ctx.password, next: '//evil.example' } });
  assert.equal(res.headers.get('location'), '/');
});

test('panel: POST sin token CSRF válido -> 403', async () => {
  const b = browser(srv.base);
  await b.login(ctx.adminEmail, ctx.password);
  const res = await b.post('/configuracion', { name: 'Hackeado', business_type: 'farmacia', alert_phones: '' });
  assert.equal(res.status, 403);
  const res2 = await b.post('/configuracion', { _csrf: 'falso', name: 'Hackeado', business_type: 'farmacia', alert_phones: '' });
  assert.equal(res2.status, 403);
  const org = (await db.query('SELECT name FROM organizations WHERE id = $1', [ctx.org.id])).rows[0];
  assert.equal(org.name, 'Comercio Test');
});

test('panel: rol viewer no puede modificar umbrales (403)', async () => {
  const b = browser(srv.base);
  await b.login(ctx.viewerEmail, ctx.password);
  const csrf = await b.csrf();
  const page = await b.get(`/puntos/${ctx.point.id}`);
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, /Configuración del punto/);
  const res = await b.post(`/puntos/${ctx.point.id}`, {
    _csrf: csrf, name: 'X', location_id: ctx.location.id, kind: 'heladera', min_temp: '-50', max_temp: '50', alert_delay_minutes: '0', offline_after_minutes: '15',
  });
  assert.equal(res.status, 403);
  const p = (await db.query('SELECT min_temp FROM monitored_points WHERE id = $1', [ctx.point.id])).rows[0];
  assert.equal(p.min_temp, 2);
});

test('panel: un usuario no puede ver ni modificar datos de otra organización', async () => {
  const b = browser(srv.base);
  await b.login(ctx.adminEmail, ctx.password);
  const csrf = await b.csrf();
  assert.equal((await b.get(`/puntos/${other.point.id}`)).status, 404);
  assert.equal((await b.get(`/puntos/${other.point.id}/export.csv`)).status, 404);
  const res = await b.post(`/puntos/${other.point.id}`, {
    _csrf: csrf, name: 'X', location_id: ctx.location.id, kind: 'heladera', min_temp: '0', max_temp: '1', alert_delay_minutes: '0', offline_after_minutes: '15',
  });
  assert.equal(res.status, 404);
  await b.post(`/puntos/${other.point.id}/eliminar`, { _csrf: csrf });
  const still = await db.query('SELECT 1 FROM monitored_points WHERE id = $1', [other.point.id]);
  assert.equal(still.rows.length, 1);
  const home = await b.get('/');
  assert.doesNotMatch(home.text, /Otra organización/);
});

test('panel: logout invalida la sesión en el servidor', async () => {
  const b = browser(srv.base);
  await b.login(ctx.adminEmail, ctx.password);
  const sessionCookie = b.cookie;
  const csrf = await b.csrf();
  assert.equal((await b.post('/logout', { _csrf: csrf })).status, 303);
  const res = await fetch(`${srv.base}/`, { headers: { cookie: sessionCookie }, redirect: 'manual' });
  assert.equal(res.status, 303);
});

test('panel: cabeceras de seguridad y escape de HTML', async () => {
  const b = browser(srv.base);
  await b.login(ctx.adminEmail, ctx.password);
  const csrf = await b.csrf();
  await b.post('/ubicaciones', { _csrf: csrf, name: '<script>alert(1)</script>', address: '' });
  const page = await b.get('/ubicaciones');
  assert.doesNotMatch(page.text, /<script>alert\(1\)<\/script>/);
  assert.match(page.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
});
