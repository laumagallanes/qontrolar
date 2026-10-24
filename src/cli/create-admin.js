/**
 * Crea una organización y su usuario administrador.
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... ORG_NAME="Mi comercio" BUSINESS_TYPE=restaurante npm run create-admin
 * Si faltan variables se piden por consola (la contraseña no se pasa como argumento
 * para que no quede en el historial del shell).
 */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { bootstrap } from '../runtime.js';
import { hashPassword } from '../lib/security.js';
import { BUSINESS_TYPES } from '../lib/format.js';

const rl = readline.createInterface({ input: stdin, output: stdout });
const ask = async (envName, question, def = '') => process.env[envName] || (await rl.question(question)).trim() || def;

const orgName = await ask('ORG_NAME', 'Nombre del comercio: ');
const businessType = await ask('BUSINESS_TYPE', `Rubro (${Object.keys(BUSINESS_TYPES).join('/')}) [restaurante]: `, 'restaurante');
const name = await ask('ADMIN_NAME', 'Nombre del administrador: ', 'Administrador');
const email = (await ask('ADMIN_EMAIL', 'Email: ')).toLowerCase();
const password = await ask('ADMIN_PASSWORD', 'Contraseña (mín. 10 caracteres): ');
rl.close();

if (!orgName || !email.includes('@')) throw new Error('Nombre de comercio y email válidos son obligatorios.');
if (!BUSINESS_TYPES[businessType]) throw new Error(`Rubro inválido: ${businessType}`);
if (password.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres.');

const { db } = await bootstrap();
try {
  const exists = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
  if (exists.rows.length) throw new Error(`Ya existe un usuario con email ${email}`);
  await db.tx(async (q) => {
    const org = await q.query('INSERT INTO organizations (name, business_type) VALUES ($1, $2) RETURNING id', [orgName, businessType]);
    await q.query(
      `INSERT INTO users (organization_id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, 'admin')`,
      [org.rows[0].id, email, name, await hashPassword(password)],
    );
  });
  console.log(`Administrador ${email} creado para "${orgName}".`);
} finally {
  await db.close();
}
