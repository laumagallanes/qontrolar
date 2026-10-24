// QontrolAR - mejoras progresivas (la app funciona sin JavaScript).

// Confirmación para acciones destructivas.
document.addEventListener('submit', (e) => {
  const msg = e.target.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});

// Botón copiar.
document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const el = document.querySelector(btn.getAttribute('data-copy'));
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.textContent.trim());
      btn.textContent = 'Copiado';
    } catch {
      btn.textContent = 'Seleccione y copie manualmente';
    }
  });
});

// Crosshair + tooltip del gráfico de temperatura.
document.querySelectorAll('[data-chart]').forEach((fig) => {
  const svg = fig.querySelector('svg');
  const hit = fig.querySelector('.hit');
  const dataEl = fig.querySelector('.chart-data');
  if (!svg || !hit || !dataEl) return;
  const points = JSON.parse(dataEl.textContent);
  if (!points.length) return;
  const cross = fig.querySelector('.crosshair');
  const dot = fig.querySelector('.hover-dot');
  const tip = fig.querySelector('.chart-tooltip');
  const yMin = Number(hit.dataset.ymin);
  const yMax = Number(hit.dataset.ymax);
  const top = Number(hit.dataset.top);
  const ih = Number(hit.dataset.ih);
  const vbW = Number(hit.dataset.w);
  const yOf = (v) => top + (1 - (v - yMin) / (yMax - yMin)) * ih;
  const fmt = (v) => v.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' °C';
  let idx = points.length - 1;

  function nearest(x) {
    let lo = 0;
    let hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid][0] < x) lo = mid; else hi = mid;
    }
    return Math.abs(points[lo][0] - x) <= Math.abs(points[hi][0] - x) ? lo : hi;
  }

  function show(i) {
    idx = i;
    const [x, v, label] = points[i];
    const y = yOf(v);
    cross.setAttribute('x1', x);
    cross.setAttribute('x2', x);
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    cross.hidden = false;
    dot.hidden = false;
    tip.querySelector('strong').textContent = fmt(v);
    tip.querySelector('span').textContent = label;
    tip.hidden = false;
    const scale = svg.getBoundingClientRect().width / vbW;
    const left = x * scale;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(left - tw / 2, 0), svg.clientWidth - tw)}px`;
    tip.style.top = `${Math.max(y * scale - tip.offsetHeight - 12, 0)}px`;
  }

  function hide() {
    cross.hidden = true;
    dot.hidden = true;
    tip.hidden = true;
  }

  hit.addEventListener('pointermove', (e) => {
    const rect = svg.getBoundingClientRect();
    show(nearest(((e.clientX - rect.left) / rect.width) * vbW));
  });
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('focus', () => show(idx));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(Math.max(0, idx - 1));
    else if (e.key === 'ArrowRight') show(Math.min(points.length - 1, idx + 1));
    else return;
    e.preventDefault();
  });
});
