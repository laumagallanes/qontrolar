/**
 * Simula un sensor enviando lecturas a la API, igual que lo haría un ESP32.
 *   DEVICE_TOKEN=qdev_... API_URL=http://localhost:3000 npm run simulate
 * Opcionales: BASE_TEMP (°C, por defecto 4), INTERVAL_SECONDS (por defecto 30), SPIKE=1 para forzar valores altos.
 */
const url = `${(process.env.API_URL || 'http://localhost:3000').replace(/\/+$/, '')}/api/v1/readings`;
const token = process.env.DEVICE_TOKEN;
if (!token) {
  console.error('Defina DEVICE_TOKEN con el token del sensor (se muestra al crearlo en el panel).');
  process.exit(1);
}
const base = Number(process.env.BASE_TEMP ?? 4);
const interval = Number(process.env.INTERVAL_SECONDS ?? 30) * 1000;
const spike = process.env.SPIKE === '1';

async function tick() {
  const temperature = Math.round((base + (spike ? 6 : 0) + (Math.random() - 0.5) * 0.8) * 10) / 10;
  const humidity = Math.round(55 + Math.random() * 10);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Firmware-Version': 'simulador-1.0' },
      body: JSON.stringify({ temperature, humidity }),
    });
    console.log(new Date().toISOString(), temperature, '°C ->', res.status, await res.text());
  } catch (err) {
    console.error('Error de red:', err.message);
  }
}
await tick();
setInterval(tick, interval);
