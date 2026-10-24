/**
 * Consultas de lectura/escritura del panel. Toda consulta filtra por organization_id para
 * que un usuario nunca acceda a datos de otra organización.
 */

const POINT_SELECT = `
  SELECT p.*, l.name AS location_name,
         d.id AS device_id, d.name AS device_name, d.last_seen_at AS device_last_seen_at,
         EXISTS (SELECT 1 FROM alert_events a WHERE a.monitored_point_id = p.id AND a.status = 'open'
                 AND a.type IN ('temp_high', 'temp_low')) AS has_open_temp_alert
    FROM monitored_points p
    JOIN locations l ON l.id = p.location_id
    LEFT JOIN devices d ON d.monitored_point_id = p.id AND d.revoked_at IS NULL`;

export async function listPoints(db, orgId) {
  const { rows } = await db.query(`${POINT_SELECT} WHERE p.organization_id = $1 ORDER BY l.name, p.name`, [orgId]);
  return rows;
}

export async function getPoint(db, orgId, pointId) {
  if (!isUuid(pointId)) return null;
  const { rows } = await db.query(`${POINT_SELECT} WHERE p.organization_id = $1 AND p.id = $2`, [orgId, pointId]);
  return rows[0] || null;
}

export async function listLocations(db, orgId) {
  const { rows } = await db.query(
    `SELECT l.*, (SELECT count(*) FROM monitored_points p WHERE p.location_id = l.id) AS point_count
       FROM locations l WHERE l.organization_id = $1 ORDER BY l.name`,
    [orgId],
  );
  return rows;
}

export async function getLocation(db, orgId, id) {
  if (!isUuid(id)) return null;
  const { rows } = await db.query('SELECT * FROM locations WHERE organization_id = $1 AND id = $2', [orgId, id]);
  return rows[0] || null;
}

export async function listDevices(db, orgId) {
  const { rows } = await db.query(
    `SELECT d.*, p.name AS point_name, l.name AS location_name, p.offline_after_minutes
       FROM devices d
       LEFT JOIN monitored_points p ON p.id = d.monitored_point_id
       LEFT JOIN locations l ON l.id = p.location_id
      WHERE d.organization_id = $1
      ORDER BY d.revoked_at IS NOT NULL, d.name`,
    [orgId],
  );
  return rows;
}

export async function getDevice(db, orgId, id) {
  if (!isUuid(id)) return null;
  const { rows } = await db.query('SELECT * FROM devices WHERE organization_id = $1 AND id = $2', [orgId, id]);
  return rows[0] || null;
}

export async function listAlerts(db, orgId, { status = null, pointId = null, limit = 200 } = {}) {
  const params = [orgId];
  let where = 'a.organization_id = $1';
  if (status) {
    params.push(status);
    where += ` AND a.status = $${params.length}`;
  }
  if (pointId) {
    params.push(pointId);
    where += ` AND a.monitored_point_id = $${params.length}`;
  }
  params.push(limit);
  const { rows } = await db.query(
    `SELECT a.*, p.name AS point_name, l.name AS location_name, u.name AS ack_by_name
       FROM alert_events a
       JOIN monitored_points p ON p.id = a.monitored_point_id
       JOIN locations l ON l.id = p.location_id
       LEFT JOIN users u ON u.id = a.acknowledged_by
      WHERE ${where}
      ORDER BY a.status = 'open' DESC, a.started_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function getReadings(db, pointId, from, to = new Date(), limit = 5000) {
  const { rows } = await db.query(
    `SELECT temperature, humidity, recorded_at FROM readings
      WHERE monitored_point_id = $1 AND recorded_at >= $2 AND recorded_at <= $3
      ORDER BY recorded_at ASC LIMIT $4`,
    [pointId, from, to, limit],
  );
  return rows;
}

export async function readingStats(db, pointId, from, to = new Date()) {
  const { rows } = await db.query(
    `SELECT count(*) AS n, min(temperature) AS min, max(temperature) AS max, avg(temperature) AS avg
       FROM readings WHERE monitored_point_id = $1 AND recorded_at >= $2 AND recorded_at <= $3`,
    [pointId, from, to],
  );
  return rows[0];
}

export async function getOrganization(db, orgId) {
  const { rows } = await db.query('SELECT * FROM organizations WHERE id = $1', [orgId]);
  return rows[0];
}

export async function listNotifications(db, orgId, limit = 20) {
  const { rows } = await db.query(
    'SELECT * FROM notifications WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2',
    [orgId, limit],
  );
  return rows;
}

export function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
