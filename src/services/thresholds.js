/**
 * Lógica pura de umbrales y estado. Sin acceso a base de datos para poder testearla aislada.
 */

/** Clasifica una temperatura contra el rango [min, max] (inclusivo). */
export function classifyTemperature(temperature, { min_temp, max_temp }) {
  if (temperature > max_temp) return 'high';
  if (temperature < min_temp) return 'low';
  return 'ok';
}

export function validateThresholds({ min_temp, max_temp, alert_delay_minutes, offline_after_minutes }) {
  const errors = [];
  const min = Number(min_temp);
  const max = Number(max_temp);
  if (min_temp === '' || min_temp === null || min_temp === undefined || !Number.isFinite(min)) errors.push('La temperatura mínima debe ser un número.');
  if (max_temp === '' || max_temp === null || max_temp === undefined || !Number.isFinite(max)) errors.push('La temperatura máxima debe ser un número.');
  if (Number.isFinite(min) && Number.isFinite(max)) {
    if (min >= max) errors.push('La mínima debe ser menor que la máxima.');
    if (min < -60 || max > 60) errors.push('El rango debe estar entre -60 °C y 60 °C.');
  }
  const delay = Number(alert_delay_minutes);
  if (!Number.isInteger(delay) || delay < 0 || delay > 240) errors.push('La demora de alerta debe ser un entero entre 0 y 240 minutos.');
  const offline = Number(offline_after_minutes);
  if (!Number.isInteger(offline) || offline < 2 || offline > 1440) errors.push('El tiempo de desconexión debe ser un entero entre 2 y 1440 minutos.');
  return {
    errors,
    value: { min_temp: min, max_temp: max, alert_delay_minutes: delay, offline_after_minutes: offline },
  };
}

/**
 * Estado actual de un punto para el tablero.
 * point: fila de monitored_points (+ device_id, device_last_seen_at opcionales)
 */
export function pointStatus(point, now = new Date()) {
  if (!point.device_id) return point.last_reading_at ? statusFromTemp(point, now) : 'no_device';
  if (!point.device_last_seen_at && !point.last_reading_at) return 'no_data';
  const lastSeen = new Date(point.device_last_seen_at || point.last_reading_at).getTime();
  if (now.getTime() - lastSeen > point.offline_after_minutes * 60000) return 'offline';
  return statusFromTemp(point, now);
}

function statusFromTemp(point, now) {
  if (point.last_temperature === null || point.last_temperature === undefined) return 'no_data';
  const cls = classifyTemperature(point.last_temperature, point);
  if (cls === 'ok') return 'ok';
  const since = point.out_of_range_since ? new Date(point.out_of_range_since).getTime() : now.getTime();
  const confirmed = point.has_open_temp_alert || now.getTime() - since >= point.alert_delay_minutes * 60000;
  return confirmed ? cls : `pending_${cls}`;
}

/** Severidad para ordenar el tablero (mayor = más urgente). */
export const STATUS_SEVERITY = {
  high: 5, low: 5, offline: 4, pending_high: 3, pending_low: 3, no_data: 2, no_device: 1, ok: 0,
};
