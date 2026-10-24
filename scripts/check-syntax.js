/**
 * Verifica la sintaxis de todos los .js del proyecto con `node --check`
 * y que ningún archivo versionable contenga secretos reales evidentes.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIRS = ['src', 'scripts', 'test', 'public/js'];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(path.join(ROOT, d)));
let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`✗ ${path.relative(ROOT, f)}\n${err.stderr?.toString()}`);
  }
}

// .env.example sólo debe contener placeholders.
const envExample = path.join(ROOT, '.env.example');
if (fs.existsSync(envExample)) {
  for (const line of fs.readFileSync(envExample, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]*(KEY|PASSWORD|SECRET|TOKEN)[A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && m[3] && !/^(change-me|CHANGE_ME|<.*>|)$/i.test(m[3]) && !m[3].includes('CHANGE_ME')) {
      failed++;
      console.error(`✗ .env.example: ${m[1]} no parece un placeholder`);
    }
  }
} else {
  failed++;
  console.error('✗ falta .env.example');
}

if (failed) {
  console.error(`check-syntax: ${failed} problema(s)`);
  process.exit(1);
}
console.log(`check-syntax: ${files.length} archivos OK`);
