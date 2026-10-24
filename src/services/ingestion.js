import { sha256 } from '../lib/security.js';
import { evaluateReading, resolveAlerts } from './alerts.js';

export const MAX_BATCH = 100;
const MAX_FUTURE_MS = 5 * 60 * 1000;
const MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;

export class IngestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Extrae el token Bearer del header Authorization. */
export function parseBearer(header) {
  if (typeof header !== 'string') return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1] : null;
}

export async function authenticateDevice(db, token) {
  if (!token || token.length > 200 || !token.startsWith('qdev_')) return null;
  const { rows } = await db.query(
    `SELECT * FROM devices WHERE token_hash = $1 AND revoked_at IS NULL`,
    [sha256(token)],
  );
  return rows[0] || null;
}

/**
 * Valida y normaliza el cuerpo enviado por el sensor. Acepta una lectura
 *   { "temperature": 4.2, "humidity": 61, "recorded_at": "2026-10-24T14:00:00Z" }
 * o un lote { "readings": [ ... ] } (máx. 100) para reenvío tras cortes de red.
 * `recorded_at` es opcional; si falta se usa la hora del servidor.
 */
export function parseReadingsPayload(body, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new IngestError(400, 'invalid_body', 'El cuerpo debe ser un objeto JSON.');
  }
  const list = body.readings !== undefined ? body.readings : [body];
  if (!Array.isArray(list) || list.length === 0) {
    throw new IngestError(400, 'invalid_body', '"readings" debe ser una lista no vacía.');
  }
  if (list.length > MAX_BATCH) {
    throw new IngestError(413, 'batch_too_large', `Máximo ${MAX_BATCH} lecturas por solicitud.`);
  }
  const out = list.map((r, i) => {
    const where = list.length > 1 ? ` (lectura ${i})` : '';
    if (!r || typeof r !== 'object') throw new IngestError(400, 'invalid_reading', `Lectura inválida${where}.`);
    const temperature = r.temperature;
    if (typeof temperature !== 'number' || !Number.isFinite(temperature)) {
      throw new IngestError(400, 'invalid_temperature', `"temperature" debe ser numérico${where}.`);
    }
    if (temperature < -60 || temperature > 100) {
      throw new IngestError(422, 'temperature_out_of_sensor_range', `Temperatura fuera del rango físico del sensor (-60 a 100 °C)${where}.`);
    }
    let humidity = null;
    if (r.humidity !== undefined && r.humidity !== null) {
      if (typeof r.humidity !== 'number' || !Number.isFinite(r.humidity) || r.humidity < 0 || r.humidity > 100) {
        throw new IngestError(400, 'invalid_humidity', `"humidity" debe estar entre 0 y 100${where}.`);
      }
      humidity = Math.round(r.humidity * 10) / 10;
    }
    let recordedAt = now;
    if (r.recorded_at !== undefined && r.recorded_at !== null) {
      const d = typeof r.recorded_at === 'number' ? new Date(r.recorded_at * 1000) : new Date(String(r.recorded_at));
      if (Number.isNaN(d.getTime())) {
        throw new IngestError(400, 'invalid_recorded_at', `"recorded_at" debe ser ISO-8601 o epoch en segundos${where}.`);
      }
      if (d.getTime() - now.getTime() > MAX_FUTURE_MS) {
        throw new IngestError(422, 'recorded_at_in_future', `"recorded_at" está en el futuro; verifique el reloj (NTP) del dispositivo${where}.`);
      }
      if (now.getTime() - d.getTime() > MAX_PAST_MS) {
        throw new IngestError(422, 'recorded_at_too_old', `"recorded_at" tiene más de 7 días${where}.`);
      }
      recordedAt = d;
    }
    return { temperature: Math.round(temperature * 100) / 100, humidity, recorded_at: recordedAt };
  });
  out.sort((a, b) => a.recorded_at - b.recorded_at);
  return out;
}

/**
 * Persiste lecturas de un dispositivo y evalúa alertas en una única transacción.
 * Las lecturas más antiguas que la última registrada se guardan en el historial pero
 * no alteran el estado actual ni las alertas (llegadas fuera de orden / reenvíos).
 */
export async function ingestReadings(db, device, readings, { now = new Date(), ip = null, firmware = null } = {}) {
  if (!device.monitored_point_id) {
    throw new IngestError(409, 'device_not_assigned', 'El dispositivo no está asignado a ningún punto de monitoreo.');
  }
  return db.tx(async (q) => {
    const pr = await q.query('SELECT * FROM monitored_points WHERE id = $1 FOR UPDATE', [device.monitored_point_id]);
    let point = pr.rows[0];
    if (!point) throw new IngestError(409, 'device_not_assigned', 'El punto de monitoreo asignado no existe.');

    const events = [];
    for (const r of readings) {
      await q.query(
        `INSERT INTO readings (monitored_point_id, device_id, temperature, humidity, recorded_at, received_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [point.id, device.id, r.temperature, r.humidity, r.recorded_at, now],
      );
      if (point.last_reading_at && r.recorded_at <= new Date(point.last_reading_at)) continue;
      const res = await evaluateReading(q, point, { ...r, device_id: device.id });
      point = res.point;
      events.push(...res.events);
    }

    // El dispositivo volvió a reportar: se cierra una eventual alerta de desconexión.
    events.push(...(await resolveAlerts(q, point.id, ['device_offline'], now)));
    await q.query(
      `UPDATE devices SET last_seen_at = $2, last_ip = $3, firmware = COALESCE($4, firmware) WHERE id = $1`,
      [device.id, now, ip, firmware],
    );

    return { point, events, accepted: readings.length };
  });
}
