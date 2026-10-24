import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/**
 * Interfaz mínima de base de datos usada por toda la app:
 *   query(text, params) -> { rows }
 *   exec(sql)            -> ejecuta SQL multi-sentencia (migraciones)
 *   tx(fn)               -> ejecuta fn(q) dentro de una transacción
 *   withLock(key, fn)    -> ejecuta fn() en exclusión mutua entre procesos (no reentrante)
 *   close()
 *
 * En producción se usa PostgreSQL (driver `pg`). Para tests y desarrollo sin Docker
 * se puede usar PGlite (Postgres compilado a WASM) con DATABASE_URL=pglite://memory
 * o pglite://./ruta/a/directorio.
 */
export async function createDb(databaseUrl) {
  if (!databaseUrl) throw new Error('DATABASE_URL no está configurada');
  if (databaseUrl.startsWith('pglite:')) return createPglite(databaseUrl);
  return createPg(databaseUrl);
}

async function createPg(databaseUrl) {
  const pg = (await import('pg')).default;
  // int8 (bigint / count(*)) como número, igual que PGlite.
  pg.types.setTypeParser(20, (v) => Number(v));
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  pool.on('error', (err) => console.error('[db] error en conexión inactiva:', err.message));
  return {
    kind: 'pg',
    query: (text, params) => pool.query(text, params),
    exec: (sql) => pool.query(sql),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (t, p) => client.query(t, p) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    // Advisory lock de sesión en una conexión dedicada, retenida mientras fn() consulta vía pool.
    async withLock(key, fn) {
      const client = await pool.connect();
      let unlocked = false;
      try {
        await client.query('SELECT pg_advisory_lock($1)', [key]);
        try {
          return await fn();
        } finally {
          unlocked = await client.query('SELECT pg_advisory_unlock($1)', [key]).then(() => true, () => false);
        }
      } finally {
        // Si no se pudo desbloquear se descarta la conexión: cerrar la sesión libera el lock.
        client.release(unlocked ? undefined : true);
      }
    },
    close: () => pool.end(),
  };
}

async function createPglite(databaseUrl) {
  let PGlite;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
  } catch {
    throw new Error('PGlite no está instalado (npm install incluye devDependencies). Use PostgreSQL en producción.');
  }
  const target = databaseUrl.replace(/^pglite:(\/\/)?/, '');
  const db = target === 'memory' || target === '' ? new PGlite() : new PGlite(path.resolve(target));
  await db.waitReady;
  // PGlite es de conexión única: serializamos transacciones para evitar intercalado.
  let chain = Promise.resolve();
  let lockChain = Promise.resolve();
  return {
    kind: 'pglite',
    query: (text, params) => db.query(text, params),
    exec: (sql) => db.exec(sql),
    tx(fn) {
      const run = chain.then(() => db.transaction((t) => fn({ query: (q, p) => t.query(q, p) })));
      chain = run.catch(() => {});
      return run;
    },
    // Un único proceso por base PGlite: basta un mutex en memoria por instancia (serializa todas las claves).
    withLock(_key, fn) {
      const run = lockChain.then(() => fn());
      lockChain = run.catch(() => {});
      return run;
    },
    close: () => db.close(),
  };
}

export async function migrate(db, { log = () => {} } = {}) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await db.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    await db.tx(async (q) => {
      // Bloqueo para que dos instancias no apliquen la misma migración a la vez.
      await q.query('SELECT pg_advisory_xact_lock(727274)');
      const again = await q.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (again.rows.length) return;
      for (const stmt of splitSql(sql)) await q.query(stmt);
      await q.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    log(`migración aplicada: ${file}`);
  }
}

/** Divide un archivo SQL simple (sin funciones con $$) en sentencias. */
function splitSql(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
