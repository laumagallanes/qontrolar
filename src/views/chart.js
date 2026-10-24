import { html, raw } from '../lib/html.js';

const W = 800;
const H = 260;
const PAD = { top: 16, right: 56, bottom: 28, left: 44 };

function niceStep(range) {
  const rough = range / 5;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const n = rough / pow;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * pow;
}

/**
 * Gráfico de línea (una serie: temperatura) con la banda del rango configurado.
 * SVG generado en el servidor; public/js/app.js agrega crosshair + tooltip.
 * Los cortes mayores a `gapMinutes` se dibujan como hueco (sensor sin datos).
 */
export function temperatureChart({ readings, from, to, min, max, gapMinutes, formatTime, formatTick }) {
  if (!readings.length) {
    return html`<div class="chart-empty">Sin lecturas en el período seleccionado.</div>`;
  }
  const temps = readings.map((r) => r.temperature);
  let yMin = Math.min(...temps, min);
  let yMax = Math.max(...temps, max);
  const span = Math.max(yMax - yMin, 1);
  yMin -= span * 0.08;
  yMax += span * 0.08;
  const step = niceStep(yMax - yMin);
  yMin = Math.floor(yMin / step) * step;
  yMax = Math.ceil(yMax / step) * step;

  const t0 = from.getTime();
  const t1 = to.getTime();
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (t) => PAD.left + ((t - t0) / (t1 - t0)) * iw;
  const y = (v) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * ih;
  const f = (n) => n.toFixed(1);

  // Línea con cortes en huecos de datos.
  let d = '';
  let prev = null;
  for (const r of readings) {
    const t = new Date(r.recorded_at).getTime();
    const gap = prev !== null && t - prev > gapMinutes * 60000;
    d += `${d === '' || gap ? 'M' : 'L'}${f(x(t))},${f(y(r.temperature))}`;
    prev = t;
  }

  const yTicks = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) yTicks.push(Math.round(v * 100) / 100);
  const xTicks = [];
  for (let i = 0; i <= 4; i++) xTicks.push(t0 + ((t1 - t0) * i) / 4);

  const last = readings[readings.length - 1];
  const lastT = new Date(last.recorded_at).getTime();
  const fmtV = (v) => v.toLocaleString('es-AR', { maximumFractionDigits: 1 });

  // Datos para el tooltip (máx. ~800 puntos para no inflar la página).
  const stride = Math.max(1, Math.ceil(readings.length / 800));
  const points = readings
    .filter((_, i) => i % stride === 0 || i === readings.length - 1)
    .map((r) => [Math.round(x(new Date(r.recorded_at).getTime()) * 10) / 10, r.temperature, formatTime(r.recorded_at)]);
  const json = JSON.stringify(points).replace(/</g, '\\u003c');

  return html`<figure class="chart" data-chart>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Temperatura en el período; rango configurado ${fmtV(min)} a ${fmtV(max)} °C">
    <rect class="band" x="${PAD.left}" y="${f(y(max))}" width="${iw}" height="${f(y(min) - y(max))}"></rect>
    ${yTicks.map((v) => html`<line class="grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${f(y(v))}" y2="${f(y(v))}"></line>
    <text class="tick" x="${PAD.left - 6}" y="${f(y(v) + 4)}" text-anchor="end">${fmtV(v)}</text>`)}
    ${xTicks.map((t, i) => html`<text class="tick" x="${f(x(t))}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${formatTick(new Date(t))}</text>`)}
    <text class="band-label" x="${W - PAD.right + 4}" y="${f(y(max) + 4)}">máx ${fmtV(max)}</text>
    <text class="band-label" x="${W - PAD.right + 4}" y="${f(y(min) + 4)}">mín ${fmtV(min)}</text>
    <path class="line" d="${d}"></path>
    <circle class="end-dot" cx="${f(x(lastT))}" cy="${f(y(last.temperature))}" r="4"></circle>
    <line class="crosshair" x1="0" x2="0" y1="${PAD.top}" y2="${H - PAD.bottom}" hidden></line>
    <circle class="hover-dot" r="4" cx="0" cy="0" hidden></circle>
    <rect class="hit" x="${PAD.left}" y="${PAD.top}" width="${iw}" height="${ih}" tabindex="0"
      data-ymin="${yMin}" data-ymax="${yMax}" data-top="${PAD.top}" data-ih="${ih}" data-w="${W}"></rect>
  </svg>
  <div class="chart-tooltip" hidden><strong></strong><span></span></div>
  <script type="application/json" class="chart-data">${raw(json)}</script>
  <figcaption>Banda sombreada: rango configurado para este punto. Huecos en la línea: períodos sin datos del sensor.</figcaption>
</figure>`;
}
