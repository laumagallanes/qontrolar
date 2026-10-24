import { classifyTemperature } from './thresholds.js';

/**
 * Evalúa una lectura (ya insertada) contra los umbrales del punto y abre/cierra eventos
 * de alerta. Debe llamarse dentro de una transacción con el punto bloqueado (FOR UPDATE).
 *
 * Comportamiento:
 *  - Lectura en rango: se limpia `out_of_range_since` y se resuelven alertas de temperatura abiertas.
 *  - Lectura fuera de rango: se marca el inicio de la excursión; cuando dura al menos
 *    `alert_delay_minutes` se abre UNA alerta (temp_high o temp_low). Mientras siga abierta
 *    se actualiza el valor pico; no se generan alertas duplicadas.
 *  - Si la excursión cambia de lado (alta -> baja) se resuelve la anterior y empieza una nueva.
 *
 * Devuelve { point, events } con events = [{ transition: 'opened'|'resolved', alert }].
 */
export async function evaluateReading(q, point, reading) {
  const events = [];
  const at = new Date(reading.recorded_at);
  const cls = classifyTemperature(reading.temperature, point);
  const prevCls = point.last_temperature === null || point.last_temperature === undefined
    ? 'ok'
    : classifyTemperature(point.last_temperature, point);

  let outSince = point.out_of_range_since ? new Date(point.out_of_range_since) : null;

  if (cls === 'ok') {
    outSince = null;
    events.push(...(await resolveAlerts(q, point.id, ['temp_high', 'temp_low'], at)));
  } else {
    const type = cls === 'high' ? 'temp_high' : 'temp_low';
    const opposite = cls === 'high' ? 'temp_low' : 'temp_high';
    if (prevCls !== cls || !outSince) {
      if (prevCls !== cls) events.push(...(await resolveAlerts(q, point.id, [opposite], at)));
      outSince = at;
    }
    const elapsedMs = at.getTime() - outSince.getTime();
    if (elapsedMs >= point.alert_delay_minutes * 60000) {
      const threshold = cls === 'high' ? point.max_temp : point.min_temp;
      const ins = await q.query(
        `INSERT INTO alert_events
           (organization_id, monitored_point_id, device_id, type, status, started_at, trigger_value, threshold, peak_value)
         VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, $6)
         ON CONFLICT (monitored_point_id, type) WHERE status = 'open' DO NOTHING
         RETURNING *`,
        [point.organization_id, point.id, reading.device_id ?? null, type, outSince, reading.temperature, threshold],
      );
      if (ins.rows.length) {
        events.push({ transition: 'opened', alert: ins.rows[0] });
      } else {
        const agg = cls === 'high' ? 'GREATEST' : 'LEAST';
        await q.query(
          `UPDATE alert_events SET peak_value = ${agg}(peak_value, $3)
           WHERE monitored_point_id = $1 AND type = $2 AND status = 'open'`,
          [point.id, type, reading.temperature],
        );
      }
    }
  }

  const { rows } = await q.query(
    `UPDATE monitored_points
       SET last_temperature = $2, last_humidity = $3, last_reading_at = $4, out_of_range_since = $5
     WHERE id = $1 RETURNING *`,
    [point.id, reading.temperature, reading.humidity ?? null, at, outSince],
  );
  return { point: rows[0], events };
}

export async function resolveAlerts(q, pointId, types, at = new Date()) {
  const { rows } = await q.query(
    `UPDATE alert_events SET status = 'resolved', resolved_at = GREATEST($3::timestamptz, started_at)
     WHERE monitored_point_id = $1 AND type = ANY($2::text[]) AND status = 'open'
     RETURNING *`,
    [pointId, types, at],
  );
  return rows.map((alert) => ({ transition: 'resolved', alert }));
}

/**
 * Detecta sensores que dejaron de reportar. Sólo considera dispositivos activos, asignados
 * a un punto y que reportaron al menos una vez (un sensor recién creado y aún no instalado
 * figura como "Sin datos", sin alerta).
 */
export async function checkOfflineDevices(db, now = new Date()) {
  const { rows } = await db.query(
    `INSERT INTO alert_events (organization_id, monitored_point_id, device_id, type, status, started_at, threshold)
     SELECT p.organization_id, p.id, d.id, 'device_offline', 'open', d.last_seen_at, p.offline_after_minutes
       FROM devices d
       JOIN monitored_points p ON p.id = d.monitored_point_id
      WHERE d.revoked_at IS NULL
        AND d.last_seen_at IS NOT NULL
        AND d.last_seen_at < $1::timestamptz - make_interval(mins => p.offline_after_minutes)
     ON CONFLICT (monitored_point_id, type) WHERE status = 'open' DO NOTHING
     RETURNING *`,
    [now],
  );
  return rows.map((alert) => ({ transition: 'opened', alert }));
}
