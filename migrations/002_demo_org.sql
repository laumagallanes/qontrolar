-- QontrolAR - organización de DEMOSTRACIÓN aislada.
-- Marca explícita para que el panel distinga datos ficticios de lecturas reales, para que el
-- simulador sólo escriba en esa organización y para que nunca se envíen mensajes reales.

ALTER TABLE organizations ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

-- Como máximo una organización demo por instalación (el seed es idempotente sobre ella).
CREATE UNIQUE INDEX organizations_single_demo_key ON organizations (is_demo) WHERE is_demo;
