import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  // These hashes are generated only with the local parameters above. Never trust
  // cost factors or derived-key lengths parsed from a database row: a modified row
  // could otherwise force an expensive scrypt operation during login.
  if (typeof stored !== 'string' || stored.length > 200) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  if (N !== String(SCRYPT_PARAMS.N) || r !== String(SCRYPT_PARAMS.r) || p !== String(SCRYPT_PARAMS.p)) return false;
  if (saltB64.length !== 24 || keyB64.length !== 88) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  if (salt.length !== 16 || salt.toString('base64') !== saltB64) return false;
  if (expected.length !== KEYLEN || expected.toString('base64') !== keyB64) return false;
  const key = await scrypt(password, salt, KEYLEN, SCRYPT_PARAMS);
  return crypto.timingSafeEqual(key, expected);
}

/** Hash usado para comparar contra un hash ficticio y no revelar si un email existe. */
export const DUMMY_PASSWORD_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(KEYLEN).toString('base64');

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Token de dispositivo: alta entropía (256 bits), por eso basta SHA-256 para almacenarlo. */
export function generateDeviceToken() {
  const token = `qdev_${randomToken(32)}`;
  return { token, hash: sha256(token), prefix: token.slice(0, 12) };
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Limitador de tasa en memoria por clave (ventana fija). Suficiente para una sola instancia. */
export function createRateLimiter({ limit, windowMs }) {
  const buckets = new Map();
  return {
    hit(key, now = Date.now()) {
      let b = buckets.get(key);
      if (!b || now >= b.resetAt) {
        b = { count: 0, resetAt: now + windowMs };
        buckets.set(key, b);
      }
      b.count += 1;
      if (buckets.size > 10000) {
        for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
      }
      return { allowed: b.count <= limit, retryAfterSeconds: Math.ceil((b.resetAt - now) / 1000) };
    },
    reset(key) {
      buckets.delete(key);
    },
  };
}
