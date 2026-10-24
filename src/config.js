/**
 * Configuración leída de variables de entorno. Las credenciales (API key de Evolution,
 * contraseña de base de datos) sólo viven del lado del servidor y nunca se envían al navegador.
 */
export function loadConfig(env = process.env) {
  const int = (name, def) => {
    const v = env[name];
    if (v === undefined || v === '') return def;
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n)) throw new Error(`${name} debe ser un entero`);
    return n;
  };
  const bool = (name, def) => {
    const v = env[name];
    if (v === undefined || v === '') return def;
    return ['1', 'true', 'yes', 'si', 'sí'].includes(String(v).toLowerCase());
  };

  return {
    port: int('PORT', 3000),
    host: env.HOST || '0.0.0.0',
    databaseUrl: env.DATABASE_URL || '',
    publicUrl: (env.PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    timezone: env.APP_TIMEZONE || 'America/Argentina/Buenos_Aires',
    cookieSecure: bool('COOKIE_SECURE', false),
    trustProxy: bool('TRUST_PROXY', false),
    sessionTtlHours: int('SESSION_TTL_HOURS', 12),
    offlineCheckIntervalSeconds: int('OFFLINE_CHECK_INTERVAL_SECONDS', 60),
    ingestRateLimitPerMinute: int('INGEST_RATE_LIMIT_PER_MINUTE', 120),
    readingRetentionDays: int('READING_RETENTION_DAYS', 0), // 0 = sin purga automática
    evolution: {
      url: (env.EVOLUTION_API_URL || '').replace(/\/+$/, ''),
      apiKey: env.EVOLUTION_API_KEY || '',
      instance: env.EVOLUTION_INSTANCE || '',
      timeoutMs: int('EVOLUTION_TIMEOUT_MS', 10000),
    },
  };
}
