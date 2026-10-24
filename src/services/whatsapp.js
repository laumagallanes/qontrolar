/**
 * Adaptador WhatsApp sobre Evolution API v2 (https://doc.evolution-api.com).
 * URL, API key e instancia se leen de variables de entorno del servidor; la API key
 * nunca se devuelve al navegador ni se incluye en mensajes de error.
 */

export class WhatsAppError extends Error {
  constructor(message, { status = null, code = 'whatsapp_error' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Normaliza un número a formato internacional solo dígitos (p. ej. 5493411234567).
 * Para celulares argentinos WhatsApp usa 54 + 9 + código de área (sin 0) + número (sin 15).
 * Devuelve null si el formato no es válido.
 */
export function normalizePhone(input) {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  let digits = String(input).replace(/[\s\-().+]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

export function createEvolutionClient({ url, apiKey, instance, timeoutMs = 10000, fetchImpl = globalThis.fetch } = {}) {
  const configured = Boolean(url && apiKey && instance);

  async function call(method, path, body) {
    if (!configured) throw new WhatsAppError('WhatsApp no está configurado en el servidor.', { code: 'not_configured' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${url}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const code = err?.name === 'AbortError' ? 'timeout' : 'network_error';
      const msg = code === 'timeout'
        ? `Evolution API no respondió en ${timeoutMs} ms.`
        : 'No se pudo conectar con Evolution API.';
      throw new WhatsAppError(msg, { code });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      throw new WhatsAppError(`Evolution API respondió ${res.status}: ${sanitize(describeError(data, text), apiKey)}`, {
        status: res.status,
        code: res.status === 401 || res.status === 403 ? 'unauthorized' : 'api_error',
      });
    }
    return data;
  }

  const inst = encodeURIComponent(instance || '');

  return {
    configured,
    instance: instance || null,

    async sendText(number, text) {
      const to = normalizePhone(number);
      if (!to) throw new WhatsAppError('Número de WhatsApp inválido.', { code: 'invalid_number' });
      const data = await call('POST', `/message/sendText/${inst}`, { number: to, text });
      return { to, messageId: data?.key?.id ?? null };
    },

    /** Estado de la sesión: 'open' (vinculada), 'connecting', 'close', etc. */
    async connectionState() {
      const data = await call('GET', `/instance/connectionState/${inst}`);
      return data?.instance?.state ?? data?.state ?? 'unknown';
    },
  };
}

function describeError(data, text) {
  if (data) {
    const m = data.response?.message ?? data.message ?? data.error;
    if (m) return Array.isArray(m) ? m.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('; ') : String(m);
  }
  return (text || '').slice(0, 200) || 'sin detalle';
}

function sanitize(message, secret) {
  let out = String(message).slice(0, 300);
  if (secret) out = out.split(secret).join('[oculto]');
  return out;
}
