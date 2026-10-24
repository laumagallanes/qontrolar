/**
 * Datos de DEMOSTRACIÓN aislados: una única organización marcada `is_demo`, con locales
 * ficticios de distintos rubros, y un simulador que escribe lecturas plausibles SÓLO en los
 * sensores simulados de esa organización, a través de la misma lógica de ingesta real.
 *
 * Los rangos de temperatura son ILUSTRATIVOS: no representan requisitos legales ni
 * recomendaciones para ningún producto. Cada comercio define sus umbrales reales.
 *
 * Nada de este módulo envía mensajes: la organización demo no tiene destinatarios y el
 * notificador omite cualquier envío para organizaciones demo.
 */
import { generateDeviceToken, hashPassword, verifyPassword } from '../lib/security.js';
import { ingestReadings } from './ingestion.js';

export const DEMO_ORG_NAME = 'Qontrol.ar DEMO · comercios ficticios';
/** Firmware con el que se marcan los sensores simulados; el simulador sólo escribe en éstos. */
export const DEMO_FIRMWARE = 'demo-simulador';
export const MIN_DEMO_PASSWORD_LENGTH = 12;
/** Clave del lock exclusivo entre procesos (seed:demo, demo-worker) para las operaciones demo. */
export const DEMO_LOCK_KEY = 727275;

const HOUR = 3600000;
const MIN = 60000;
/** Hueco final del escenario "sin conexión": el sensor deja de reportar 2 h antes del seed. */
const OFFLINE_GAP_MS = 2 * HOUR;
/** Escenario "excursión": cada 6 h, 35 min por encima del máximo (simula puerta abierta / carga). */
const EXCURSION_CYCLE_MS = 6 * HOUR;
const EXCURSION_LENGTH_MS = 35 * MIN;

/**
 * Locales y puntos ficticios. `scenario`: 'ok' | 'excursion' | 'offline'.
 * Rangos de EJEMPLO, explícitamente no normativos.
 */
export const DEMO_DATASET = [
  {
    name: 'Restaurante La Esquina (demo)', address: 'Dirección ficticia 100', business: 'restaurante',
    points: [
      { name: 'Heladera de cocina', kind: 'heladera', min: 1, max: 5, base: 3.2, scenario: 'excursion' },
      { name: 'Freezer de insumos', kind: 'freezer', min: -24, max: -15, base: -19.5, scenario: 'ok' },
    ],
  },
  {
    name: 'Farmacia del Parque (demo)', address: 'Dirección ficticia 200', business: 'farmacia',
    points: [
      { name: 'Heladera de medicamentos', kind: 'heladera', min: 2, max: 8, base: 5, scenario: 'ok' },
      { name: 'Depósito ambiente', kind: 'otro', min: 15, max: 25, base: 21, scenario: 'ok', humidity: 45 },
    ],
  },
  {
    name: 'Carnicería Don Ejemplo (demo)', address: 'Dirección ficticia 300', business: 'carniceria',
    points: [
      { name: 'Cámara de carnes', kind: 'camara', min: 0, max: 4, base: 2, scenario: 'ok', humidity: 85 },
      { name: 'Exhibidora de mostrador', kind: 'exhibidora', min: 0, max: 5, base: 2.8, scenario: 'ok' },
    ],
  },
  {
    name: 'Veterinaria Patitas (demo)', address: 'Dirección ficticia 400', business: 'veterinaria',
    points: [
      { name: 'Heladera de vacunas', kind: 'heladera', min: 2, max: 8, base: 4.8, scenario: 'offline' },
      { name: 'Freezer de muestras', kind: 'freezer', min: -25, max: -15, base: -20, scenario: 'ok' },
    ],
  },
];

export function findDemoSpec(locationName, pointName) {
  const loc = DEMO_DATASET.find((l) => l.name === locationName);
  return loc?.points.find((p) => p.name === pointName) || null;
}

/** Valida credenciales demo leídas del entorno del servidor. Nunca incluye la contraseña en errores. */
export function demoCredentialsFromEnv(env = process.env) {
  const email = String(env.DEMO_EMAIL || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 200) {
    throw new Error('Defina DEMO_EMAIL (email del usuario demo) en el entorno del servidor.');
  }
  // Obligatoria siempre, aunque la demo ya exista: sin ella no se arranca con una credencial vieja.
  const password = env.DEMO_PASSWORD ? String(env.DEMO_PASSWORD) : null;
  if (password === null) {
    throw new Error('Defina DEMO_PASSWORD (secreto del usuario demo) en el entorno del servidor.');
  }
  if (password.length < MIN_DEMO_PASSWORD_LENGTH) {
    throw new Error(`DEMO_PASSWORD debe tener al menos ${MIN_DEMO_PASSWORD_LENGTH} caracteres.`);
  }
  if (/change[_-]?me/i.test(password)) {
    throw new Error('DEMO_PASSWORD contiene un valor de ejemplo; defina un secreto real en el entorno del servidor.');
  }
  return { email, password };
}

/** Temperatura simulada para un punto en el instante `t` (ms). Determinística salvo el ruido `rng`. */
export function demoTemperature(spec, t, rng = Math.random) {
  if (spec.scenario === 'excursion' && t % EXCURSION_CYCLE_MS < EXCURSION_LENGTH_MS) {
    const phase = (t % EXCURSION_CYCLE_MS) / EXCURSION_LENGTH_MS; // 0..1
    return round1(spec.max + 1 + Math.sin(phase * Math.PI) * 2.5 + rng() * 0.3);
  }
  const width = spec.max - spec.min;
  const amp = Math.min(0.8, width * 0.15);
  const daily = Math.sin((2 * Math.PI * t) / (24 * HOUR)) * amp;
  const compressor = Math.sin((2 * Math.PI * t) / (47 * MIN)) * amp * 0.35;
  const noise = (rng() - 0.5) * Math.min(0.3, width * 0.05);
  const v = spec.base + daily + compressor + noise;
  // Fuera de la excursión los escenarios se mantienen dentro del rango ilustrativo.
  return round1(Math.min(spec.max - 0.2, Math.max(spec.min + 0.2, v)));
}

function demoHumidity(spec, rng) {
  return Math.round((spec.humidity ?? 60) + (rng() - 0.5) * 8);
}

const round1 = (v) => Math.round(v * 10) / 10;

async function ensureDemoOrg(db) {
  await db.query(
    `INSERT INTO organizations (name, business_type, alert_phones, notify_on_resolve, is_demo)
     VALUES ($1, 'otro', '{}', false, true)
     ON CONFLICT (is_demo) WHERE is_demo DO NOTHING`,
    [DEMO_ORG_NAME],
  );
  return (await db.query('SELECT * FROM organizations WHERE is_demo')).rows[0];
}

async function ensureDemoUser(db, org, { email, password }) {
  const { rows } = await db.query('SELECT id, organization_id, password_hash FROM users WHERE lower(email) = $1', [email]);
  const user = rows[0];
  if (user) {
    if (user.organization_id !== org.id) {
      // Nunca se toca un usuario de un cliente real.
      throw new Error('DEMO_EMAIL ya pertenece a una organización real; use un email exclusivo para la demo.');
    }
    if (password && !(await verifyPassword(password, user.password_hash))) {
      await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(password)]);
      await db.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
      return 'password_rotated';
    }
    return 'existing';
  }
  if (!password) {
    throw new Error('Defina DEMO_PASSWORD en el entorno del servidor para crear el usuario demo.');
  }
  await db.query(
    `INSERT INTO users (organization_id, email, name, password_hash, role) VALUES ($1, $2, 'Usuario demo', $3, 'admin')`,
    [org.id, email, await hashPassword(password)],
  );
  return 'created';
}

async function ensureDemoStructure(db, org) {
  let created = 0;
  for (const locSpec of DEMO_DATASET) {
    let loc = (await db.query('SELECT * FROM locations WHERE organization_id = $1 AND name = $2', [org.id, locSpec.name])).rows[0];
    if (!loc) {
      loc = (await db.query(
        'INSERT INTO locations (organization_id, name, address) VALUES ($1, $2, $3) RETURNING *', [org.id, locSpec.name, locSpec.address],
      )).rows[0];
      created++;
    }
    for (const s of locSpec.points) {
      let point = (await db.query(
        'SELECT * FROM monitored_points WHERE organization_id = $1 AND location_id = $2 AND name = $3', [org.id, loc.id, s.name],
      )).rows[0];
      if (!point) {
        point = (await db.query(
          `INSERT INTO monitored_points (organization_id, location_id, name, kind, min_temp, max_temp, alert_delay_minutes, offline_after_minutes)
           VALUES ($1, $2, $3, $4, $5, $6, 10, 15) RETURNING *`,
          [org.id, loc.id, s.name, s.kind, s.min, s.max],
        )).rows[0];
        created++;
      }
      const dev = await db.query('SELECT 1 FROM devices WHERE monitored_point_id = $1 AND revoked_at IS NULL', [point.id]);
      if (!dev.rows.length) {
        // El token en claro se descarta: los sensores simulados no usan la API HTTP.
        const t = generateDeviceToken();
        await db.query(
          `INSERT INTO devices (organization_id, monitored_point_id, name, token_hash, token_prefix, firmware)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [org.id, point.id, `Sensor simulado · ${s.name}`, t.hash, t.prefix, DEMO_FIRMWARE],
        );
        created++;
      }
    }
  }
  return created;
}

/** Rechaza un DEMO_EMAIL de un usuario real antes de crear nada (ni siquiera la organización demo). */
async function assertEmailNotReal(db, email) {
  const { rows } = await db.query(
    'SELECT o.is_demo FROM users u JOIN organizations o ON o.id = u.organization_id WHERE lower(u.email) = $1', [email],
  );
  if (rows.length && !rows[0].is_demo) {
    throw new Error('DEMO_EMAIL ya pertenece a una organización real; use un email exclusivo para la demo.');
  }
}

/**
 * Crea (o completa) la organización demo, su usuario y su estructura, y escribe el
 * historial inicial. Idempotente: ejecutarlo varias veces no duplica filas. Se ejecuta
 * con el lock demo, así que llamadas concurrentes (incluso desde otros procesos) se serializan.
 */
export async function seedDemo(db, { email, password = null, now = new Date(), backfillHours = 24, stepMinutes = 5, rng = Math.random } = {}) {
  if (!email) throw new Error('Falta el email del usuario demo.');
  return db.withLock(DEMO_LOCK_KEY, async () => {
    const normalized = email.toLowerCase();
    await assertEmailNotReal(db, normalized);
    const org = await ensureDemoOrg(db);
    const user = await ensureDemoUser(db, org, { email: normalized, password });
    const created = await ensureDemoStructure(db, org);
    // Ya dentro del lock: se usa la variante sin lock (el lock no es reentrante).
    const advanced = await advanceDemoUnlocked(db, { now, backfillHours, stepMinutes, rng });
    return { organizationId: org.id, user, created, ...advanced };
  });
}

/**
 * Un ciclo del simulador: completa lecturas hasta `now` en cada sensor simulado de la
 * organización demo. Nunca toca otras organizaciones ni sensores reales.
 *  - 'ok' / 'excursion': lecturas cada `stepMinutes` hasta ahora.
 *  - 'offline': sólo se escribe el historial inicial y luego deja de reportar (la tarea de
 *    fondo de la app abre la alerta de desconexión).
 * Se ejecuta con el lock demo: dos ciclos concurrentes no escriben el mismo punto/instante.
 */
export function advanceDemo(db, opts = {}) {
  return db.withLock(DEMO_LOCK_KEY, () => advanceDemoUnlocked(db, opts));
}

async function advanceDemoUnlocked(db, { now = new Date(), backfillHours = 24, stepMinutes = 5, rng = Math.random } = {}) {
  const { rows: devices } = await db.query(
    `SELECT d.*, p.name AS point_name, l.name AS location_name, p.last_reading_at
       FROM devices d
       JOIN organizations o ON o.id = d.organization_id
       JOIN monitored_points p ON p.id = d.monitored_point_id AND p.organization_id = o.id
       JOIN locations l ON l.id = p.location_id
      WHERE o.is_demo AND d.revoked_at IS NULL AND d.firmware = $1
      ORDER BY l.name, p.name`,
    [DEMO_FIRMWARE],
  );
  const stepMs = stepMinutes * MIN;
  const earliest = now.getTime() - backfillHours * HOUR;
  let readings = 0;
  let events = 0;
  for (const device of devices) {
    const spec = findDemoSpec(device.location_name, device.point_name);
    if (!spec) continue;
    const last = device.last_reading_at ? new Date(device.last_reading_at).getTime() : null;
    let until = now.getTime();
    if (spec.scenario === 'offline') {
      if (last !== null) continue;
      until -= OFFLINE_GAP_MS;
    }
    const from = last === null ? earliest : Math.max(last + stepMs, earliest);
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      const recordedNow = batch[batch.length - 1].recorded_at;
      const res = await ingestReadings(db, device, batch, { now: recordedNow, firmware: DEMO_FIRMWARE });
      readings += batch.length;
      events += res.events.length;
      batch = [];
    };
    for (let t = from; t <= until; t += stepMs) {
      batch.push({ temperature: demoTemperature(spec, t, rng), humidity: demoHumidity(spec, rng), recorded_at: new Date(t) });
      if (batch.length === 50) await flush();
    }
    await flush();
  }
  return { devices: devices.length, readings, events };
}
