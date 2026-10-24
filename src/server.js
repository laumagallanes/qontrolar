import { createApp } from './app.js';
import { bootstrap, runBackgroundTick } from './runtime.js';

const ctx = await bootstrap();
const { config, db } = ctx;

const app = createApp({ ...ctx, clock: () => new Date() });
const server = app.listen(config.port, config.host, () => {
  console.log(`[qontrolar] escuchando en http://${config.host}:${config.port} (público: ${config.publicUrl})`);
  console.log(`[qontrolar] WhatsApp ${ctx.whatsapp.configured ? `configurado (instancia ${ctx.whatsapp.instance})` : 'NO configurado'}`);
});

let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try {
    await runBackgroundTick(ctx);
  } catch (err) {
    console.error('[background]', err.message);
  } finally {
    running = false;
  }
}, config.offlineCheckIntervalSeconds * 1000);

async function shutdown(signal) {
  console.log(`[qontrolar] ${signal} recibido, cerrando…`);
  clearInterval(timer);
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
