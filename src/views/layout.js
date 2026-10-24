import { html } from '../lib/html.js';
import { OPERATIONAL_DISCLAIMER } from '../lib/regulatory.js';
import { STATUS_LABELS } from '../lib/format.js';

const NAV = [
  ['/', 'Tablero'],
  ['/ubicaciones', 'Ubicaciones'],
  ['/dispositivos', 'Sensores'],
  ['/alertas', 'Alertas'],
  ['/configuracion', 'Configuración'],
  ['/referencias', 'Referencias'],
];

/** Mensajes flash por código (evita reflejar texto arbitrario desde la URL). */
export const FLASH = {
  saved: 'Cambios guardados.',
  created: 'Creado correctamente.',
  deleted: 'Eliminado.',
  ack: 'Alerta reconocida.',
  revoked: 'Token revocado. El sensor ya no puede enviar datos.',
  test_sent: 'Mensaje de prueba enviado.',
  test_skipped: 'WhatsApp no está configurado en el servidor (EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE).',
  test_failed: 'No se pudo enviar el mensaje de prueba. Revise el registro de envíos.',
  test_demo: 'Organización DEMO: no se envían mensajes reales. El intento quedó registrado como omitido.',
};

/** Aviso persistente para organizaciones demo: los valores mostrados no provienen de sensores reales. */
export const DEMO_NOTICE = 'Datos ficticios generados por un simulador. No son lecturas de sensores reales ni se envían alertas.';

export function layout(req, { title, body, current = '', refreshSeconds = 0, variant = '' }) {
  const user = req.user;
  const demo = req.org?.is_demo === true;
  const flash = FLASH[req.query?.ok] ? html`<div class="flash" role="status">${FLASH[req.query.ok]}</div>` : '';
  return html`<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#171e28">
${refreshSeconds ? html`<meta http-equiv="refresh" content="${refreshSeconds}">` : ''}
<title>${demo ? 'DEMO · ' : ''}${title} · Qontrol.ar</title>
<link rel="icon" type="image/png" sizes="32x32" href="/static/brand/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/static/brand/favicon-192.png">
<link rel="apple-touch-icon" href="/static/brand/apple-touch-icon.png">
<link rel="stylesheet" href="/static/css/app.css">
</head>
<body class="${variant ? `page-${variant}` : ''}${demo ? ' is-demo' : ''}">
<a class="skip-link" href="#main">Saltar al contenido</a>
<header class="topbar">
  <a class="brand" href="/"><img src="/static/brand/qontrol-wordmark-topbar.png" alt="Qontrol.ar" width="126" height="36"></a>
  <span class="product" title="Monitoreo de cadena de frío">
    <img src="/static/brand/qontrol-frio-icon.png" alt="" width="20" height="20"><span>Qontrol Frío</span>
  </span>
  ${demo ? html`<span class="demo-pill" title="${DEMO_NOTICE}">DEMO</span>` : ''}
  ${user ? html`
  <input type="checkbox" id="nav-toggle" class="nav-toggle" aria-controls="main-nav">
  <label for="nav-toggle" class="nav-burger"><span aria-hidden="true">☰</span><span class="sr-only">Menú</span></label>
  <nav class="nav" id="main-nav" aria-label="Principal">
    ${NAV.map(([href, label]) => html`<a href="${href}" ${current === href ? html`aria-current="page"` : ''}>${label}</a>`)}
    <form method="post" action="/logout" class="logout">
      <input type="hidden" name="_csrf" value="${req.csrfToken}">
      <button type="submit" class="link">Salir (${user.name})</button>
    </form>
  </nav>` : ''}
</header>
${demo ? html`<div class="demo-banner" role="note"><strong>DEMO</strong> <span>${DEMO_NOTICE}</span></div>` : ''}
<main class="container" id="main">
${flash}
${body}
</main>
<footer class="footer">
  <p>${OPERATIONAL_DISCLAIMER} <a href="/referencias">Ver referencias regulatorias</a>.</p>
  <p class="footer-brand">Qontrol.ar · Qontrol Frío</p>
</footer>
<script src="/static/js/app.js" defer></script>
</body>
</html>`;
}

export function statusBadge(status) {
  const icon = { ok: '✓', high: '▲', low: '▼', pending_high: '△', pending_low: '▽', offline: '⨯', no_data: '…', no_device: '–' }[status] || '?';
  return html`<span class="badge badge-${status}"><span aria-hidden="true">${icon}</span> ${STATUS_LABELS[status] || status}</span>`;
}

export function csrfField(req) {
  return html`<input type="hidden" name="_csrf" value="${req.csrfToken}">`;
}

export function errorList(errors) {
  if (!errors?.length) return '';
  return html`<div class="errors" role="alert"><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>`;
}
