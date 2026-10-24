import { randomToken, safeEqual, sha256 } from '../lib/security.js';

export const SESSION_COOKIE = 'qsid';

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = '';
    }
  }
  return out;
}

export function sessionCookie(value, { secure, maxAgeSeconds }) {
  const attrs = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export async function createSession(db, userId, ttlHours) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4::int))`,
    [sha256(token), userId, csrf, ttlHours],
  );
  return token;
}

export async function destroySession(db, token) {
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

/** Carga req.user / req.org / req.csrfToken si hay una sesión válida. */
export function loadSession(db) {
  return async (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    req.sessionToken = token || null;
    if (!token || token.length > 100) return next();
    const { rows } = await db.query(
      `SELECT s.csrf_token, u.id, u.email, u.name, u.role, u.organization_id,
              o.name AS org_name, o.business_type, o.is_demo
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN organizations o ON o.id = u.organization_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)],
    );
    if (rows[0]) {
      const r = rows[0];
      req.user = { id: r.id, email: r.email, name: r.name, role: r.role, organization_id: r.organization_id };
      req.org = { id: r.organization_id, name: r.org_name, business_type: r.business_type, is_demo: r.is_demo === true };
      req.csrfToken = r.csrf_token;
    }
    next();
  };
}

export function requireLogin(req, res, next) {
  if (req.user) return next();
  if (req.method === 'GET') {
    const nextUrl = req.originalUrl.startsWith('/') && !req.originalUrl.startsWith('//') ? req.originalUrl : '/';
    return res.redirect(303, `/login?next=${encodeURIComponent(nextUrl)}`);
  }
  return res.status(401).send('Sesión expirada. Vuelva a iniciar sesión.');
}

export function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  return res.status(403).send('Acceso denegado: se requiere rol administrador.');
}

/** Valida el token CSRF en toda petición que modifica estado (formularios del panel). */
export function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = req.body?._csrf;
  if (!req.csrfToken || typeof sent !== 'string' || !safeEqual(sent, req.csrfToken)) {
    return res.status(403).send('Token CSRF inválido. Recargue la página e intente nuevamente.');
  }
  next();
}
