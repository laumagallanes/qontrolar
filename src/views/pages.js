import { html } from '../lib/html.js';
import {
  ALERT_TYPES, BUSINESS_TYPES, POINT_KINDS, formatDuration, formatTemp, formatNumber, timeAgo,
} from '../lib/format.js';
import {
  OPERATIONAL_DISCLAIMER, REGULATORY_SCOPE, REGULATORY_SOURCES, REGULATORY_TO_CONFIRM, REGULATORY_VERIFIED_ON,
} from '../lib/regulatory.js';
import { csrfField, errorList, layout, statusBadge } from './layout.js';

const isAdmin = (req) => req.user?.role === 'admin';

const THRESHOLD_HELP = html`<p class="help">Defina mínimo y máximo según el producto almacenado, las especificaciones del
equipo y la guía de la autoridad sanitaria que corresponda. Qontrol.ar no precarga temperaturas como requisito legal.
<a href="/referencias">Referencias</a>.</p>`;

// ---------------------------------------------------------------- login

export function loginPage(req, { error = null, next = '/', email = '' } = {}) {
  return layout(req, {
    title: 'Ingresar',
    variant: 'login',
    body: html`<section class="card narrow login-card">
  <img class="login-mark" src="/static/brand/qontrol-wordmark-login.png" alt="Qontrol.ar" width="252" height="72">
  <p class="login-product"><img src="/static/brand/qontrol-frio-icon.png" alt="" width="20" height="20"> Qontrol Frío · panel de monitoreo</p>
  <p class="login-platform">Qontrol.ar es una plataforma IoT adaptable a cada comercio; Qontrol Frío es su primer módulo activo.</p>
  <h1>Ingresar</h1>
  ${error ? html`<div class="errors" role="alert">${error}</div>` : ''}
  <form method="post" action="/login" class="form">
    <input type="hidden" name="next" value="${next}">
    <label>Email <input type="email" name="email" value="${email}" required autocomplete="username" autofocus></label>
    <label>Contraseña <input type="password" name="password" required autocomplete="current-password"></label>
    <button type="submit" class="btn primary">Ingresar</button>
  </form>
</section>`,
  });
}

// ---------------------------------------------------------------- tablero

export function dashboardPage(req, { points, openAlerts, now, fmt }) {
  const count = (pred) => points.filter(pred).length;
  const tiles = [
    ['En rango', count((p) => p.status === 'ok'), 'ok'],
    ['Fuera de rango', count((p) => ['high', 'low', 'pending_high', 'pending_low'].includes(p.status)), 'bad'],
    ['Sin conexión / sin datos', count((p) => ['offline', 'no_data', 'no_device'].includes(p.status)), 'warn'],
    ['Alertas abiertas', openAlerts.length, openAlerts.length ? 'bad' : 'ok'],
  ];
  const byLocation = new Map();
  for (const p of points) {
    if (!byLocation.has(p.location_name)) byLocation.set(p.location_name, []);
    byLocation.get(p.location_name).push(p);
  }
  return layout(req, {
    title: 'Tablero',
    current: '/',
    refreshSeconds: 60,
    body: html`<div class="page-head">
  <div><p class="eyebrow">Tablero de monitoreo</p><h1>${req.org.name}</h1></div>
  <span class="muted">${req.org.is_demo ? 'Datos simulados (DEMO)' : BUSINESS_TYPES[req.org.business_type] || ''} · actualizado ${fmt.time(now)}</span>
</div>
<section class="tiles">
  ${tiles.map(([label, value, tone]) => html`<div class="tile tile-${tone}"><div class="tile-label">${label}</div><div class="tile-value">${value}</div></div>`)}
</section>
${openAlerts.length ? html`<section class="card alert-strip">
  <h2>Alertas abiertas</h2>
  <ul class="plain">${openAlerts.slice(0, 5).map((a) => html`<li>${statusBadge(a.type === 'device_offline' ? 'offline' : a.type === 'temp_high' ? 'high' : 'low')}
    <a href="/puntos/${a.monitored_point_id}">${a.point_name}</a> <span class="muted">(${a.location_name}) · desde ${fmt.short(a.started_at)}</span></li>`)}</ul>
  <a href="/alertas?estado=abiertas">Ver todas</a>
</section>` : ''}
${points.length === 0 ? html`<section class="card empty">
  <h2>Todavía no hay puntos de monitoreo</h2>
  <p>Cree una ubicación (local, depósito) y agregue sus heladeras, freezers o cámaras.</p>
  ${isAdmin(req) ? html`<a class="btn primary" href="/ubicaciones">Crear ubicación</a>` : ''}
</section>` : ''}
${[...byLocation].map(([loc, pts]) => html`<section class="location-group">
  <h2>${loc}</h2>
  <div class="point-grid">
    ${pts.map((p) => html`<a class="point-card status-${p.status}" href="/puntos/${p.id}">
      <div class="point-head"><span class="point-name">${p.name}</span>${statusBadge(p.status)}</div>
      <div class="point-temp">${formatTemp(p.last_temperature)}${req.org.is_demo ? html` <span class="demo-tag">simulado</span>` : ''}</div>
      <div class="point-meta">
        <span>${POINT_KINDS[p.kind]} · rango ${formatNumber(p.min_temp)} a ${formatNumber(p.max_temp)} °C</span>
        <span>${p.last_reading_at ? html`Última lectura ${timeAgo(p.last_reading_at, now)}` : 'Sin lecturas'}</span>
      </div>
    </a>`)}
  </div>
</section>`)}`,
  });
}

// ---------------------------------------------------------------- punto

export const RANGES = { '24h': ['Últimas 24 h', 1], '7d': ['7 días', 7], '30d': ['30 días', 30] };

export function pointPage(req, { point, status, rangeKey, chart, readings, stats, alerts, locations, errors = [], values = null, fmt, now }) {
  const v = values || point;
  const recent = readings.slice(-50).reverse();
  return layout(req, {
    title: point.name,
    current: '/',
    body: html`<div class="page-head">
  <div><a href="/" class="muted">← Tablero</a><h1>${point.name}</h1>
  <span class="muted">${point.location_name} · ${POINT_KINDS[point.kind]}</span></div>
  ${statusBadge(status)}
</div>
<section class="tiles">
  <div class="tile"><div class="tile-label">Temperatura actual${req.org.is_demo ? html` <span class="demo-tag">simulado</span>` : ''}</div><div class="tile-value">${formatTemp(point.last_temperature)}</div>
    <div class="tile-sub">${point.last_reading_at ? fmt.dateTime(point.last_reading_at) : 'Sin lecturas'}</div></div>
  <div class="tile"><div class="tile-label">Rango configurado</div><div class="tile-value">${formatNumber(point.min_temp)} a ${formatNumber(point.max_temp)} °C</div>
    <div class="tile-sub">Demora de alerta ${point.alert_delay_minutes} min</div></div>
  <div class="tile"><div class="tile-label">Mín / Máx del período</div><div class="tile-value">${stats.n ? html`${formatNumber(stats.min)} / ${formatNumber(stats.max)} °C` : '—'}</div>
    <div class="tile-sub">${stats.n} lecturas</div></div>
  <div class="tile"><div class="tile-label">Sensor</div><div class="tile-value small">${point.device_name || 'Sin sensor asignado'}</div>
    <div class="tile-sub">${point.device_id ? html`Visto ${timeAgo(point.device_last_seen_at, now)}` : html`<a href="/dispositivos">Asignar sensor</a>`}</div></div>
</section>

<section class="card">
  <div class="card-head">
    <h2>Historial</h2>
    <nav class="segmented" aria-label="Período">
      ${Object.entries(RANGES).map(([k, [label]]) => html`<a href="/puntos/${point.id}?rango=${k}" ${k === rangeKey ? html`aria-current="true"` : ''}>${label}</a>`)}
    </nav>
    <a class="btn" href="/puntos/${point.id}/export.csv?rango=${rangeKey}">Exportar CSV</a>
  </div>
  ${req.org.is_demo ? html`<p class="demo-inline"><strong>DEMO:</strong> la serie proviene del simulador; no es una medición real.</p>` : ''}
  ${chart}
  <details>
    <summary>Ver tabla (últimas ${recent.length} lecturas del período)</summary>
    <div class="table-wrap"><table>
      <thead><tr><th>Fecha y hora</th><th class="num">Temperatura</th><th class="num">Humedad</th></tr></thead>
      <tbody>${recent.map((r) => html`<tr><td>${fmt.dateTime(r.recorded_at)}</td><td class="num">${formatTemp(r.temperature)}</td><td class="num">${r.humidity === null ? '—' : `${formatNumber(r.humidity, 0)} %`}</td></tr>`)}</tbody>
    </table></div>
  </details>
  <p class="help">El historial y la exportación son registros operativos internos; no reemplazan registros oficiales de inspección.</p>
</section>

<section class="card">
  <h2>Eventos de este punto</h2>
  ${alertTable(req, alerts, fmt, { showPoint: false })}
</section>

${isAdmin(req) ? html`<section class="card">
  <h2>Configuración del punto</h2>
  ${errorList(errors)}
  <form method="post" action="/puntos/${point.id}" class="form grid-2">
    ${csrfField(req)}
    <label>Nombre <input name="name" value="${v.name}" required maxlength="80"></label>
    <label>Ubicación <select name="location_id">${locations.map((l) => html`<option value="${l.id}" ${l.id === v.location_id ? html`selected` : ''}>${l.name}</option>`)}</select></label>
    <label>Tipo <select name="kind">${Object.entries(POINT_KINDS).map(([k, label]) => html`<option value="${k}" ${k === v.kind ? html`selected` : ''}>${label}</option>`)}</select></label>
    <span></span>
    <label>Temperatura mínima (°C) <input name="min_temp" type="number" step="0.1" value="${v.min_temp}" required></label>
    <label>Temperatura máxima (°C) <input name="max_temp" type="number" step="0.1" value="${v.max_temp}" required></label>
    <label>Demora antes de alertar (min) <input name="alert_delay_minutes" type="number" min="0" max="240" value="${v.alert_delay_minutes}" required></label>
    <label>Sin datos tras (min) → “sin conexión” <input name="offline_after_minutes" type="number" min="2" max="1440" value="${v.offline_after_minutes}" required></label>
    <div class="span-2">${THRESHOLD_HELP}</div>
    <button type="submit" class="btn primary">Guardar</button>
  </form>
  <form method="post" action="/puntos/${point.id}/eliminar" class="inline danger-zone" data-confirm="¿Eliminar el punto y TODO su historial? Esta acción no se puede deshacer.">
    ${csrfField(req)}<button class="btn danger" type="submit">Eliminar punto</button>
  </form>
</section>` : ''}`,
  });
}

export function newPointPage(req, { locations, errors = [], values = {} }) {
  return layout(req, {
    title: 'Nuevo punto',
    current: '/ubicaciones',
    body: html`<section class="card">
  <h1>Nuevo punto de monitoreo</h1>
  ${errorList(errors)}
  ${locations.length === 0 ? html`<p>Primero cree una <a href="/ubicaciones">ubicación</a>.</p>` : html`
  <form method="post" action="/puntos" class="form grid-2">
    ${csrfField(req)}
    <label>Nombre <input name="name" value="${values.name || ''}" required maxlength="80" placeholder="Heladera de lácteos"></label>
    <label>Ubicación <select name="location_id">${locations.map((l) => html`<option value="${l.id}" ${l.id === values.location_id ? html`selected` : ''}>${l.name}</option>`)}</select></label>
    <label>Tipo <select name="kind">${Object.entries(POINT_KINDS).map(([k, label]) => html`<option value="${k}" ${k === values.kind ? html`selected` : ''}>${label}</option>`)}</select></label>
    <span></span>
    <label>Temperatura mínima (°C) <input name="min_temp" type="number" step="0.1" value="${values.min_temp ?? ''}" required></label>
    <label>Temperatura máxima (°C) <input name="max_temp" type="number" step="0.1" value="${values.max_temp ?? ''}" required></label>
    <label>Demora antes de alertar (min) <input name="alert_delay_minutes" type="number" min="0" max="240" value="${values.alert_delay_minutes ?? 10}" required></label>
    <label>Sin datos tras (min) → “sin conexión” <input name="offline_after_minutes" type="number" min="2" max="1440" value="${values.offline_after_minutes ?? 15}" required></label>
    <div class="span-2">${THRESHOLD_HELP}</div>
    <button type="submit" class="btn primary">Crear punto</button>
  </form>`}
</section>`,
  });
}

// ---------------------------------------------------------------- ubicaciones

export function locationsPage(req, { locations, points, errors = [], values = {} }) {
  return layout(req, {
    title: 'Ubicaciones',
    current: '/ubicaciones',
    body: html`<div class="page-head"><h1>Ubicaciones y puntos</h1>
  ${isAdmin(req) && locations.length ? html`<a class="btn primary" href="/puntos/nuevo">Nuevo punto</a>` : ''}</div>
${locations.map((l) => html`<section class="card">
  <div class="card-head"><h2>${l.name}</h2><span class="muted">${l.address}</span>
  ${isAdmin(req) ? html`<a class="btn" href="/ubicaciones/${l.id}">Editar</a>` : ''}</div>
  ${points.filter((p) => p.location_id === l.id).length ? html`<div class="table-wrap"><table>
    <thead><tr><th>Punto</th><th>Tipo</th><th class="num">Rango</th><th>Sensor</th></tr></thead>
    <tbody>${points.filter((p) => p.location_id === l.id).map((p) => html`<tr>
      <td><a href="/puntos/${p.id}">${p.name}</a></td><td>${POINT_KINDS[p.kind]}</td>
      <td class="num">${formatNumber(p.min_temp)} a ${formatNumber(p.max_temp)} °C</td><td>${p.device_name || '—'}</td></tr>`)}</tbody>
  </table></div>` : html`<p class="muted">Sin puntos de monitoreo.</p>`}
</section>`)}
${isAdmin(req) ? html`<section class="card">
  <h2>Nueva ubicación</h2>
  ${errorList(errors)}
  <form method="post" action="/ubicaciones" class="form grid-2">
    ${csrfField(req)}
    <label>Nombre <input name="name" value="${values.name || ''}" required maxlength="80" placeholder="Local Centro"></label>
    <label>Dirección <input name="address" value="${values.address || ''}" maxlength="160"></label>
    <button type="submit" class="btn primary">Crear ubicación</button>
  </form>
</section>` : ''}`,
  });
}

export function locationEditPage(req, { location, errors = [] }) {
  return layout(req, {
    title: location.name,
    current: '/ubicaciones',
    body: html`<section class="card">
  <a href="/ubicaciones" class="muted">← Ubicaciones</a>
  <h1>Editar ubicación</h1>
  ${errorList(errors)}
  <form method="post" action="/ubicaciones/${location.id}" class="form grid-2">
    ${csrfField(req)}
    <label>Nombre <input name="name" value="${location.name}" required maxlength="80"></label>
    <label>Dirección <input name="address" value="${location.address}" maxlength="160"></label>
    <button type="submit" class="btn primary">Guardar</button>
  </form>
  <form method="post" action="/ubicaciones/${location.id}/eliminar" class="inline danger-zone" data-confirm="¿Eliminar la ubicación, sus puntos y todo su historial?">
    ${csrfField(req)}<button class="btn danger" type="submit">Eliminar ubicación</button>
  </form>
</section>`,
  });
}

// ---------------------------------------------------------------- sensores

export function devicesPage(req, { devices, points, errors = [], values = {}, fmt, now }) {
  const freePoints = points.filter((p) => !p.device_id);
  return layout(req, {
    title: 'Sensores',
    current: '/dispositivos',
    body: html`<div class="page-head"><h1>Sensores</h1></div>
<section class="card">
  ${devices.length ? html`<div class="table-wrap"><table>
    <thead><tr><th>Nombre</th><th>Punto</th><th>Token</th><th>Última conexión</th><th>Estado</th>${isAdmin(req) ? html`<th></th>` : ''}</tr></thead>
    <tbody>${devices.map((d) => {
      const online = d.last_seen_at && now - new Date(d.last_seen_at) <= (d.offline_after_minutes || 15) * 60000;
      const st = d.revoked_at ? 'revoked' : !d.monitored_point_id ? 'no_device' : !d.last_seen_at ? 'no_data' : online ? 'ok' : 'offline';
      return html`<tr>
      <td>${d.name}${d.firmware ? html`<div class="muted small">fw ${d.firmware}</div>` : ''}</td>
      <td>${d.point_name ? html`${d.point_name} <span class="muted">(${d.location_name})</span>` : '—'}</td>
      <td><code>${d.token_prefix}…</code></td>
      <td>${d.last_seen_at ? html`${fmt.short(d.last_seen_at)}<div class="muted small">${timeAgo(d.last_seen_at, now)}</div>` : 'nunca'}</td>
      <td>${st === 'revoked' ? html`<span class="badge badge-no_device">Revocado</span>` : st === 'ok' ? html`<span class="badge badge-ok"><span aria-hidden="true">✓</span> En línea</span>` : st === 'no_device' ? html`<span class="badge badge-no_device">Sin asignar</span>` : statusBadge(st)}</td>
      ${isAdmin(req) ? html`<td class="actions">${d.revoked_at ? '' : html`
        <form method="post" action="/dispositivos/${d.id}/regenerar" class="inline" data-confirm="El token actual dejará de funcionar. ¿Continuar?">${csrfField(req)}<button class="btn small" type="submit">Nuevo token</button></form>
        <form method="post" action="/dispositivos/${d.id}/revocar" class="inline" data-confirm="¿Revocar este sensor? No podrá enviar más datos.">${csrfField(req)}<button class="btn small danger" type="submit">Revocar</button></form>`}</td>` : ''}
    </tr>`;
    })}</tbody>
  </table></div>` : html`<p class="muted">No hay sensores registrados.</p>`}
</section>
${isAdmin(req) ? html`<section class="card">
  <h2>Registrar sensor</h2>
  ${errorList(errors)}
  <form method="post" action="/dispositivos" class="form grid-2">
    ${csrfField(req)}
    <label>Nombre <input name="name" value="${values.name || ''}" required maxlength="80" placeholder="ESP32 heladera 1"></label>
    <label>Punto de monitoreo <select name="monitored_point_id">
      <option value="">— Sin asignar —</option>
      ${freePoints.map((p) => html`<option value="${p.id}" ${p.id === values.monitored_point_id ? html`selected` : ''}>${p.location_name} · ${p.name}</option>`)}
    </select></label>
    <button type="submit" class="btn primary">Crear y generar token</button>
  </form>
  <p class="help">Cada sensor recibe su propio token. Se muestra una sola vez; Qontrol.ar guarda sólo un hash.
  Ver <code>docs/esp32.md</code> para el formato de envío.</p>
</section>` : ''}`,
  });
}

export function deviceTokenPage(req, { device, token, publicUrl }) {
  const curl = `curl -X POST ${publicUrl}/api/v1/readings \\\n  -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"temperature": 4.2, "humidity": 60}'`;
  return layout(req, {
    title: 'Token del sensor',
    current: '/dispositivos',
    body: html`<section class="card">
  <h1>Token de “${device.name}”</h1>
  <div class="errors" role="alert">Copie este token ahora: no se volverá a mostrar.</div>
  <pre class="token" id="device-token">${token}</pre>
  <button type="button" class="btn" data-copy="#device-token">Copiar</button>
  <h2>Prueba rápida</h2>
  <pre class="code">${curl}</pre>
  <a class="btn primary" href="/dispositivos">Volver a sensores</a>
</section>`,
  });
}

// ---------------------------------------------------------------- alertas

function alertTable(req, alerts, fmt, { showPoint = true } = {}) {
  if (!alerts.length) return html`<p class="muted">Sin eventos registrados.</p>`;
  return html`<div class="table-wrap"><table>
  <thead><tr><th>Evento</th>${showPoint ? html`<th>Punto</th>` : ''}<th>Inicio</th><th>Fin / duración</th><th class="num">Valor</th><th>Reconocimiento</th></tr></thead>
  <tbody>${alerts.map((a) => html`<tr class="${a.status === 'open' ? 'row-open' : ''}">
    <td>${statusBadge(a.type === 'device_offline' ? 'offline' : a.type === 'temp_high' ? 'high' : 'low')}
      <div class="small">${ALERT_TYPES[a.type]}${a.status === 'open' ? html` · <strong>abierta</strong>` : ''}</div></td>
    ${showPoint ? html`<td><a href="/puntos/${a.monitored_point_id}">${a.point_name}</a><div class="muted small">${a.location_name}</div></td>` : ''}
    <td>${fmt.short(a.started_at)}</td>
    <td>${a.resolved_at ? html`${fmt.short(a.resolved_at)}<div class="muted small">${formatDuration(new Date(a.resolved_at) - new Date(a.started_at))}</div>` : html`<span class="muted">en curso</span>`}</td>
    <td class="num">${a.type === 'device_offline' ? html`<span class="muted">límite ${a.threshold} min</span>` : html`${formatTemp(a.peak_value ?? a.trigger_value)}<div class="muted small">límite ${formatTemp(a.threshold)}</div>`}</td>
    <td>${a.acknowledged_at ? html`${a.ack_by_name || 'usuario'} · ${fmt.short(a.acknowledged_at)}${a.ack_note ? html`<div class="small">${a.ack_note}</div>` : ''}` : html`
      <form method="post" action="/alertas/${a.id}/reconocer" class="ack-form">${csrfField(req)}
        <input name="note" maxlength="300" placeholder="Acción correctiva (opcional)" aria-label="Acción correctiva">
        <button class="btn small" type="submit">Reconocer</button></form>`}</td>
  </tr>`)}</tbody>
</table></div>`;
}

export function alertsPage(req, { alerts, filter, fmt }) {
  return layout(req, {
    title: 'Alertas',
    current: '/alertas',
    body: html`<div class="page-head"><h1>Registro de eventos</h1>
  <nav class="segmented" aria-label="Filtro">
    <a href="/alertas?estado=abiertas" ${filter === 'abiertas' ? html`aria-current="true"` : ''}>Abiertas</a>
    <a href="/alertas" ${filter === 'todas' ? html`aria-current="true"` : ''}>Todas</a>
  </nav></div>
<section class="card">${alertTable(req, alerts, fmt)}</section>
<p class="help">Registro operativo de excursiones de temperatura y desconexiones, con la acción correctiva anotada por el personal.</p>`,
  });
}

// ---------------------------------------------------------------- configuración

export function settingsPage(req, { org, whatsapp, connState, notifications, errors = [], fmt }) {
  return layout(req, {
    title: 'Configuración',
    current: '/configuracion',
    body: html`<h1>Configuración</h1>
<section class="card">
  <h2>Organización y destinatarios de alertas</h2>
  ${errorList(errors)}
  ${isAdmin(req) ? html`<form method="post" action="/configuracion" class="form grid-2">
    ${csrfField(req)}
    <label>Nombre del comercio <input name="name" value="${org.name}" required maxlength="100"></label>
    <label>Rubro <select name="business_type">${Object.entries(BUSINESS_TYPES).map(([k, l]) => html`<option value="${k}" ${k === org.business_type ? html`selected` : ''}>${l}</option>`)}</select></label>
    <label class="span-2">Números de WhatsApp para alertas (uno por línea, formato internacional, ej. 5493411234567)
      <textarea name="alert_phones" rows="3">${org.alert_phones.join('\n')}</textarea></label>
    <label class="check span-2"><input type="checkbox" name="notify_on_resolve" value="1" ${org.notify_on_resolve ? html`checked` : ''}> Avisar también cuando la alerta se normaliza</label>
    <button type="submit" class="btn primary">Guardar</button>
  </form>` : html`<p>${org.name} · ${BUSINESS_TYPES[org.business_type]}</p>`}
</section>
<section class="card">
  <h2>WhatsApp (Evolution API)</h2>
  <dl class="kv">
    <dt>Configurado en el servidor</dt><dd>${whatsapp.configured ? 'Sí' : 'No — defina EVOLUTION_API_URL, EVOLUTION_API_KEY y EVOLUTION_INSTANCE'}</dd>
    ${whatsapp.configured ? html`<dt>Instancia</dt><dd><code>${whatsapp.instance}</code></dd>
    <dt>Estado de la sesión</dt><dd>${connState}</dd>` : ''}
  </dl>
  <p class="help">Las credenciales se leen de variables de entorno del servidor y nunca se envían al navegador. La API sólo debe administrarse por una red privada; consultá la documentación del repositorio antes de vincular un número.</p>
  ${isAdmin(req) ? html`<form method="post" action="/configuracion/whatsapp/prueba" class="form inline-form">
    ${csrfField(req)}
    <label>Enviar mensaje de prueba a <input name="to" value="${org.alert_phones[0] || ''}" required placeholder="5493411234567"></label>
    <button type="submit" class="btn">Enviar prueba</button>
  </form>` : ''}
  <h3>Últimos envíos</h3>
  ${notifications.length ? html`<div class="table-wrap"><table>
    <thead><tr><th>Fecha</th><th>Tipo</th><th>Destino</th><th>Resultado</th></tr></thead>
    <tbody>${notifications.map((n) => html`<tr><td>${fmt.short(n.created_at)}</td>
      <td>${{ alert_open: 'Alerta', alert_resolved: 'Normalización', test: 'Prueba' }[n.kind]}</td>
      <td>${n.to_number}</td>
      <td>${{ sent: 'Enviado', failed: 'Falló', skipped: 'Omitido' }[n.status]}${n.error ? html`<div class="muted small">${n.error}</div>` : ''}</td></tr>`)}</tbody>
  </table></div>` : html`<p class="muted">Sin envíos.</p>`}
</section>`,
  });
}

// ---------------------------------------------------------------- referencias

export function referencesPage(req) {
  return layout(req, {
    title: 'Referencias regulatorias',
    current: '/referencias',
    body: html`<h1>Referencias regulatorias</h1>
<section class="card notice">
  <p><strong>Nota informativa, no asesoramiento legal.</strong> ${OPERATIONAL_DISCLAIMER}</p>
  <p>Los umbrales de cada punto los define el comercio según el producto, el equipo y la guía de la autoridad competente.
  Para cámaras frigoríficas, el CAA prevé medición verificable, ubicación del sensor en el punto más caliente,
  alarma accionable desde el interior para seguridad del personal, termómetros de máxima y mínima y plan de contingencia.
  Una alerta de WhatsApp no reemplaza esos elementos. No extrapole estos requisitos a toda heladera o exhibidora.</p>
  <p class="muted">Enlaces verificados el ${REGULATORY_VERIFIED_ON}. ${REGULATORY_SCOPE}</p>
</section>
<section class="card">
  <h2>Fuentes oficiales</h2>
  <ul class="refs">${REGULATORY_SOURCES.map((s) => html`<li>
    <a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.title}</a>
    <div class="muted small">${s.authority}</div><p>${s.note}</p></li>`)}</ul>
</section>
<section class="card">
  <h2>A confirmar con un profesional o la autoridad</h2>
  <ul>${REGULATORY_TO_CONFIRM.map((t) => html`<li>${t}</li>`)}</ul>
</section>`,
  });
}

export function simplePage(req, title, message) {
  return layout(req, { title, body: html`<section class="card narrow"><h1>${title}</h1><p>${message}</p><a href="/">Volver al tablero</a></section>` });
}
