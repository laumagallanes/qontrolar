export const BUSINESS_TYPES = {
  restaurante: 'Restaurante',
  farmacia: 'Farmacia',
  veterinaria: 'Veterinaria',
  carniceria: 'Carnicería',
  otro: 'Otro',
};

export const POINT_KINDS = {
  heladera: 'Heladera',
  freezer: 'Freezer',
  camara: 'Cámara frigorífica',
  exhibidora: 'Exhibidora',
  otro: 'Otro',
};

export const ALERT_TYPES = {
  temp_high: 'Temperatura alta',
  temp_low: 'Temperatura baja',
  device_offline: 'Sensor sin conexión',
};

export const STATUS_LABELS = {
  ok: 'En rango',
  high: 'Alta',
  low: 'Baja',
  pending_high: 'Alta (en espera)',
  pending_low: 'Baja (en espera)',
  offline: 'Sin conexión',
  no_data: 'Sin datos',
  no_device: 'Sin sensor',
};

export function formatTemp(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;
}

export function formatNumber(value, digits = 1) {
  if (value === null || value === undefined) return '';
  return Number(value).toLocaleString('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function makeDateFormatters(timeZone) {
  const dateTime = new Intl.DateTimeFormat('es-AR', {
    timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const time = new Intl.DateTimeFormat('es-AR', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
  const short = new Intl.DateTimeFormat('es-AR', {
    timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const iso = new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const wrap = (fmt) => (d) => (d ? fmt.format(new Date(d)) : '—');
  return {
    dateTime: wrap(dateTime),
    time: wrap(time),
    short: wrap(short),
    /** "2026-10-24 14:32:05" en hora local, para CSV. */
    local: wrap(iso),
  };
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined || ms < 0) return '—';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.floor(h / 24)} días`;
}

export function timeAgo(date, now = new Date()) {
  if (!date) return 'nunca';
  const ms = now.getTime() - new Date(date).getTime();
  if (ms < 60000) return 'hace instantes';
  return `hace ${formatDuration(ms)}`;
}
