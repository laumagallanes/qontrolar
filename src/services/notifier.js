import { formatTemp, formatDuration, makeDateFormatters } from '../lib/format.js';

/**
 * Envía notificaciones de WhatsApp para eventos de alerta y registra cada intento en
 * la tabla `notifications`. Un fallo de envío nunca interrumpe la ingesta de lecturas.
 */
export function createNotifier({ db, whatsapp, timezone = 'America/Argentina/Buenos_Aires', logger = console }) {
  const fmt = makeDateFormatters(timezone);

  async function record(orgId, alertId, kind, to, body, status, error = null) {
    await db.query(
      `INSERT INTO notifications (organization_id, alert_event_id, kind, to_number, body, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [orgId, alertId, kind, to, body, status, error],
    );
  }

  async function deliver(orgId, alertId, kind, to, body) {
    if (!whatsapp.configured) {
      await record(orgId, alertId, kind, to, body, 'skipped', 'WhatsApp no configurado');
      return { to, status: 'skipped' };
    }
    try {
      await whatsapp.sendText(to, body);
      await record(orgId, alertId, kind, to, body, 'sent');
      return { to, status: 'sent' };
    } catch (err) {
      await record(orgId, alertId, kind, to, body, 'failed', err.message);
      logger.warn?.(`[whatsapp] envío fallido a ${to.slice(0, 5)}…: ${err.message}`);
      return { to, status: 'failed', error: err.message };
    }
  }

  function composeMessage(transition, alert, ctx) {
    const where = `${ctx.point_name} (${ctx.location_name})`;
    const range = `${formatTemp(ctx.min_temp)} a ${formatTemp(ctx.max_temp)}`;
    if (transition === 'opened') {
      if (alert.type === 'temp_high' || alert.type === 'temp_low') {
        const label = alert.type === 'temp_high' ? 'ALTA' : 'BAJA';
        return [
          `⚠️ Qontrol.ar – Temperatura ${label}`,
          `${where}`,
          `Actual: ${formatTemp(alert.trigger_value)} · Rango configurado: ${range}`,
          `Fuera de rango desde: ${fmt.time(alert.started_at)}`,
          'Revise el equipo y registre la acción correctiva en el panel.',
        ].join('\n');
      }
      return [
        '📡 Qontrol.ar – Sensor sin conexión',
        `${where}`,
        `Sin datos desde: ${fmt.dateTime(alert.started_at)} (límite ${alert.threshold} min)`,
        'Verifique alimentación eléctrica y Wi-Fi del sensor.',
      ].join('\n');
    }
    const duration = formatDuration(new Date(alert.resolved_at) - new Date(alert.started_at));
    if (alert.type === 'device_offline') {
      return `✅ Qontrol.ar – El sensor de ${where} volvió a reportar. Tiempo sin datos: ${duration}.`;
    }
    return `✅ Qontrol.ar – ${where} volvió al rango configurado (${range}). Duración del desvío: ${duration}. Valor extremo: ${formatTemp(alert.peak_value)}.`;
  }

  return {
    composeMessage,

    /** events: [{ transition: 'opened'|'resolved', alert }] */
    async notifyEvents(events) {
      const results = [];
      for (const { transition, alert } of events) {
        const { rows } = await db.query(
          `SELECT p.name AS point_name, p.min_temp, p.max_temp, l.name AS location_name,
                  o.alert_phones, o.notify_on_resolve, o.is_demo
             FROM monitored_points p
             JOIN locations l ON l.id = p.location_id
             JOIN organizations o ON o.id = p.organization_id
            WHERE p.id = $1`,
          [alert.monitored_point_id],
        );
        const ctx = rows[0];
        // La organización demo nunca genera mensajes reales.
        if (!ctx || ctx.is_demo || !ctx.alert_phones?.length) continue;
        if (transition === 'resolved' && !ctx.notify_on_resolve) continue;
        const body = composeMessage(transition, alert, ctx);
        const kind = transition === 'opened' ? 'alert_open' : 'alert_resolved';
        for (const to of ctx.alert_phones) {
          results.push(await deliver(alert.organization_id, alert.id, kind, to, body));
        }
      }
      return results;
    },

    async sendTest(organizationId, to, orgName) {
      const body = `✅ Qontrol.ar – Mensaje de prueba para ${orgName}. Si lo recibió, las alertas de WhatsApp están funcionando.`;
      const { rows } = await db.query('SELECT is_demo FROM organizations WHERE id = $1', [organizationId]);
      if (rows[0]?.is_demo) {
        await record(organizationId, null, 'test', to, body, 'skipped', 'Organización DEMO: sin envíos reales');
        return { to, status: 'demo' };
      }
      return deliver(organizationId, null, 'test', to, body);
    },
  };
}
