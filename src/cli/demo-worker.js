/**
 * Simulador de la DEMO: siembra la organización demo una vez y luego escribe lecturas
 * plausibles periódicamente en sus sensores simulados (nunca en sensores reales), hasta que
 * se conecten ESP32 reales. No envía mensajes ni ejecuta la detección global de desconexión
 * (eso lo hace la app, que omite envíos para organizaciones demo).
 *
 * Sólo se ejecuta con QONTROLAR_DEMO_ENABLED=true (perfil `demo` de Docker Compose):
 *   QONTROLAR_DEMO_ENABLED=true DEMO_EMAIL=... DEMO_PASSWORD=... npm run demo:worker
 * Opcional: DEMO_INTERVAL_SECONDS (por defecto 60).
 */
import { loadConfig } from '../config.js';
import { createDb, migrate } from '../db/index.js';
import { advanceDemo, demoCredentialsFromEnv, seedDemo } from '../services/demo.js';

if (process.env.QONTROLAR_DEMO_ENABLED !== 'true') {
  console.error('[demo] Simulador desactivado: defina QONTROLAR_DEMO_ENABLED=true (sólo en el perfil demo).');
  process.exit(1);
}

let creds;
try {
  creds = demoCredentialsFromEnv(process.env);
} catch (err) {
  console.error(`[demo] ${err.message}`);
  process.exit(1);
}

const intervalSeconds = Math.max(15, Number.parseInt(process.env.DEMO_INTERVAL_SECONDS || '60', 10) || 60);
const db = await createDb(loadConfig().databaseUrl);
await migrate(db, { log: (m) => console.log(`[db] ${m}`) });

try {
  const r = await seedDemo(db, creds);
  console.log(`[demo] organización DEMO lista: usuario ${r.user}, ${r.created} fila(s) nuevas, ${r.readings} lectura(s) iniciales.`);
} catch (err) {
  console.error(`[demo] ${err.message}`);
  await db.close();
  process.exit(1);
}

let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try {
    const r = await advanceDemo(db);
    if (r.readings) console.log(`[demo] ${r.readings} lectura(s) simuladas en ${r.devices} sensor(es) demo`);
  } catch (err) {
    console.error('[demo]', err.message);
  } finally {
    running = false;
  }
}, intervalSeconds * 1000);

async function shutdown(signal) {
  console.log(`[demo] ${signal} recibido, cerrando…`);
  clearInterval(timer);
  await db.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
