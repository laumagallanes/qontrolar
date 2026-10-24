import { loadConfig } from './config.js';
import { createDb, migrate } from './db/index.js';
import { createEvolutionClient } from './services/whatsapp.js';
import { createNotifier } from './services/notifier.js';
import { checkOfflineDevices } from './services/alerts.js';

/** Construye config + DB (migrada) + WhatsApp + notificador. Compartido por servidor y CLIs. */
export async function bootstrap({ env = process.env, logger = console } = {}) {
  const config = loadConfig(env);
  const db = await createDb(config.databaseUrl);
  await migrate(db, { log: (m) => logger.log(`[db] ${m}`) });
  const whatsapp = createEvolutionClient(config.evolution);
  const notifier = createNotifier({ db, whatsapp, timezone: config.timezone, logger });
  return { config, db, whatsapp, notifier };
}

/** Un ciclo del proceso de fondo: detección de sensores sin conexión y purga opcional. */
export async function runBackgroundTick({ db, notifier, config, now = new Date(), logger = console }) {
  const events = await checkOfflineDevices(db, now);
  if (events.length) {
    logger.log(`[offline] ${events.length} sensor(es) sin conexión`);
    await notifier.notifyEvents(events);
  }
  if (config.readingRetentionDays > 0) {
    await db.query(
      `DELETE FROM readings WHERE recorded_at < $1::timestamptz - make_interval(days => $2::int)`,
      [now, config.readingRetentionDays],
    );
  }
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  return events;
}
