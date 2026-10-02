/**
 * Puesta en marcha del entorno de desarrollo con un solo comando: `pnpm setup`.
 *
 * 1. Comprueba Node.js, pnpm y Docker Compose.
 * 2. Crea `.env` a partir de `.env.example` generando secretos aleatorios (nunca los imprime).
 *    Si `.env` ya existe, añade solo las variables nuevas de `.env.example`.
 * 3. Levanta la infraestructura en Docker y espera a que esté sana.
 * 4. Aplica las migraciones y carga los datos iniciales.
 *
 * Autor: Ing. Heri Espinosa
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const INFRA_SERVICES = ['postgres', 'redis', 'storage', 'gotenberg', 'mailpit'];
const MIN_NODE_MAJOR = 24;
const MIN_PNPM_MAJOR = 11;
const LINE_BREAK = /\r?\n/;
const ENV_KEY = /^([A-Z0-9_]+)=/;

/** Marcadores de .env.example y cómo generar su valor. */
const SECRET_GENERATORS = {
  __POSTGRES_PASSWORD__: () => randomBytes(24).toString('base64url'),
  __REDIS_PASSWORD__: () => randomBytes(24).toString('base64url'),
  __S3_SECRET_ACCESS_KEY__: () => randomBytes(30).toString('base64url'),
  __AUTH_SECRET__: () => randomBytes(32).toString('base64url'),
  __ENCRYPTION_KEY__: () => randomBytes(32).toString('base64'),
  __TRACKING_SIGNING_SECRET__: () => randomBytes(32).toString('base64url'),
  __SEED_ADMIN_PASSWORD__: () => randomBytes(18).toString('base64url'),
};

const isWindows = process.platform === 'win32';

function step(message) {
  console.log(`\n▶ ${message}`);
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function run(command, args, { capture = false } = {}) {
  const options = { stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' };
  // En Windows, pnpm es un .cmd y requiere shell. Los argumentos son constantes internas
  // de este script (nunca entrada del usuario), por lo que se pasan como una sola cadena.
  const result = isWindows
    ? spawnSync([command, ...args].join(' '), { ...options, shell: true })
    : spawnSync(command, args, options);
  if (result.status !== 0) {
    fail(`Falló el comando: ${command} ${args.join(' ')}`);
  }
  return capture ? result.stdout.trim() : '';
}

function majorVersion(version) {
  return Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '0', 10);
}

function checkPrerequisites() {
  step('Comprobando requisitos');
  if (majorVersion(process.version) < MIN_NODE_MAJOR) {
    fail(`Se requiere Node.js ${MIN_NODE_MAJOR} o superior (actual: ${process.version}).`);
  }
  const pnpmVersion = run('pnpm', ['--version'], { capture: true });
  if (majorVersion(pnpmVersion) < MIN_PNPM_MAJOR) {
    fail(`Se requiere pnpm ${MIN_PNPM_MAJOR} o superior (actual: ${pnpmVersion}).`);
  }
  run('docker', ['compose', 'version'], { capture: true });
  console.log(`  Node ${process.version} · pnpm ${pnpmVersion} · Docker Compose disponible`);
}

function fillSecrets(content) {
  let result = content;
  for (const [token, generate] of Object.entries(SECRET_GENERATORS)) {
    if (result.includes(token)) result = result.replaceAll(token, generate());
  }
  return result;
}

function keyOf(line) {
  return ENV_KEY.exec(line)?.[1];
}

function ensureEnvFile() {
  step('Preparando el archivo .env');
  const example = readFileSync('.env.example', 'utf8');
  if (!existsSync('.env')) {
    writeFileSync('.env', fillSecrets(example), { encoding: 'utf8', mode: 0o600 });
    console.log('  .env creado con secretos aleatorios (no se muestran).');
    return;
  }

  const current = readFileSync('.env', 'utf8');
  const pending = Object.keys(SECRET_GENERATORS).filter((token) => current.includes(token));
  if (pending.length > 0) {
    fail(`.env contiene marcadores sin sustituir: ${pending.join(', ')}. Corrígelos o borra .env.`);
  }

  // Migración: añade las variables nuevas de .env.example que aún no existen en .env.
  const existing = new Set(current.split(LINE_BREAK).map(keyOf).filter(Boolean));
  const missingLines = example.split(LINE_BREAK).filter((line) => {
    const key = keyOf(line);
    return key !== undefined && !existing.has(key);
  });
  if (missingLines.length === 0) {
    console.log('  .env ya existe y está completo; se conserva sin cambios.');
    return;
  }
  const addition = fillSecrets(missingLines.join('\n'));
  writeFileSync('.env', `${current.trimEnd()}\n\n# Añadidas por pnpm setup\n${addition}\n`, 'utf8');
  const names = missingLines.map(keyOf).join(', ');
  console.log(`  Variables añadidas a .env: ${names} (valores no mostrados).`);
}

function startInfrastructure() {
  step(`Levantando la infraestructura: ${INFRA_SERVICES.join(', ')}`);
  run('docker', ['compose', 'up', '-d', '--wait', ...INFRA_SERVICES]);
}

function prepareDatabase() {
  step('Aplicando migraciones');
  run('pnpm', ['exec', 'prisma', 'migrate', 'deploy']);
  step('Cargando datos iniciales');
  run('pnpm', ['exec', 'prisma', 'db', 'seed']);
}

checkPrerequisites();
ensureEnvFile();
startInfrastructure();
prepareDatabase();

console.log(`
✔ Entorno listo.

  Acceso inicial:    SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD de tu archivo .env
  Inicia la app:     pnpm dev          → http://localhost:3020
  Inicia el worker:  pnpm dev:worker   → http://localhost:9464/health
  Correos de prueba: Mailpit           → http://localhost:8025
  Estado:            http://localhost:3020/api/health/ready
`);
