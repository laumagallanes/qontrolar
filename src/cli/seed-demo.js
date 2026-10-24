/**
 * Carga (una vez) la organización de DEMOSTRACIÓN aislada: locales ficticios de restaurante,
 * farmacia, carnicería y veterinaria, con sensores simulados y 24 h de historial que pasan por
 * la lógica real de ingesta. Idempotente: si la demo ya existe sólo completa lo que falte.
 *
 *   DEMO_EMAIL=demo@example.com DEMO_PASSWORD=... npm run seed:demo
 *
 * Las credenciales se leen del entorno del servidor y nunca se imprimen. No toca otras
 * organizaciones. Los rangos de temperatura son ilustrativos, NO requisitos legales.
 */
import { loadConfig } from '../config.js';
import { createDb, migrate } from '../db/index.js';
import { demoCredentialsFromEnv, seedDemo } from '../services/demo.js';

let creds;
try {
  creds = demoCredentialsFromEnv(process.env);
} catch (err) {
  console.error(`[demo] ${err.message}`);
  process.exit(1);
}

const db = await createDb(loadConfig().databaseUrl);
try {
  await migrate(db, { log: (m) => console.log(`[db] ${m}`) });
  const r = await seedDemo(db, creds);
  console.log(`[demo] organización DEMO lista: usuario ${r.user}, ${r.created} fila(s) de estructura nuevas, ${r.readings} lectura(s) simuladas.`);
  console.log('[demo] Datos ficticios; los rangos son ilustrativos, no requisitos legales.');
} catch (err) {
  console.error(`[demo] ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
