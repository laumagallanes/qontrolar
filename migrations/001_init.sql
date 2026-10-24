-- QontrolAR - esquema inicial

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  business_type text NOT NULL DEFAULT 'restaurante'
    CHECK (business_type IN ('restaurante', 'farmacia', 'veterinaria', 'carniceria', 'otro')),
  -- Números de WhatsApp (formato internacional, solo dígitos) que reciben alertas.
  alert_phones text[] NOT NULL DEFAULT '{}',
  notify_on_resolve boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX locations_org_idx ON locations (organization_id);

CREATE TABLE monitored_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'heladera'
    CHECK (kind IN ('heladera', 'freezer', 'camara', 'exhibidora', 'otro')),
  min_temp double precision NOT NULL,
  max_temp double precision NOT NULL,
  -- Minutos que la temperatura debe permanecer fuera de rango antes de alertar
  -- (evita alertas por aperturas de puerta breves). 0 = inmediato.
  alert_delay_minutes integer NOT NULL DEFAULT 10 CHECK (alert_delay_minutes BETWEEN 0 AND 240),
  -- Minutos sin datos tras los cuales el dispositivo se considera desconectado.
  offline_after_minutes integer NOT NULL DEFAULT 15 CHECK (offline_after_minutes BETWEEN 2 AND 1440),
  last_temperature double precision,
  last_humidity double precision,
  last_reading_at timestamptz,
  out_of_range_since timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (min_temp < max_temp)
);
CREATE INDEX points_org_idx ON monitored_points (organization_id);
CREATE INDEX points_location_idx ON monitored_points (location_id);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  monitored_point_id uuid REFERENCES monitored_points(id) ON DELETE SET NULL,
  name text NOT NULL,
  -- Sólo se guarda el hash SHA-256 del token; el token en claro se muestra una única vez.
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  last_seen_at timestamptz,
  last_ip text,
  firmware text,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_org_idx ON devices (organization_id);
CREATE UNIQUE INDEX devices_point_active_key ON devices (monitored_point_id)
  WHERE monitored_point_id IS NOT NULL AND revoked_at IS NULL;

CREATE TABLE readings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  monitored_point_id uuid NOT NULL REFERENCES monitored_points(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  temperature double precision NOT NULL,
  humidity double precision,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX readings_point_time_idx ON readings (monitored_point_id, recorded_at DESC);

CREATE TABLE alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  monitored_point_id uuid NOT NULL REFERENCES monitored_points(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('temp_high', 'temp_low', 'device_offline')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  started_at timestamptz NOT NULL,
  resolved_at timestamptz,
  trigger_value double precision,
  threshold double precision,
  peak_value double precision,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ack_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_org_status_idx ON alert_events (organization_id, status, started_at DESC);
CREATE INDEX alerts_point_idx ON alert_events (monitored_point_id, started_at DESC);
-- Como máximo una alerta abierta por punto y tipo.
CREATE UNIQUE INDEX alerts_one_open_key ON alert_events (monitored_point_id, type) WHERE status = 'open';

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  alert_event_id uuid REFERENCES alert_events(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  kind text NOT NULL CHECK (kind IN ('alert_open', 'alert_resolved', 'test')),
  to_number text NOT NULL,
  body text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_org_idx ON notifications (organization_id, created_at DESC);
