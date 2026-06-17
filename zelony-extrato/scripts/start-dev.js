import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('..', import.meta.url)));
const isWin = process.platform === 'win32';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, shell: isWin, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function runAsync(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: 'inherit', cwd: root, shell: isWin, ...opts });
}

const envPath = path.join(root, '.env');
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(path.join(root, '.env.example'), envPath);
  console.log('Criado .env a partir de .env.example — ajuste as chaves antes de produção.');
}

console.log('=== Instalando dependências ===');
run('npm', ['install']);
run('npm', ['install'], { cwd: path.join(root, 'server') });

console.log('=== Subindo PostgreSQL (Docker) ===');
run('docker', ['compose', 'up', '-d', 'postgres']);

console.log('=== Aguardando Postgres (15s) ===');
await new Promise((r) => setTimeout(r, 15000));

console.log('=== Criando admin (se .env tiver SEED_*) ===');
spawnSync('npm', ['run', 'seed-admin'], {
  cwd: path.join(root, 'server'),
  stdio: 'inherit',
  shell: isWin,
});

const py = isWin
  ? path.join(root, 'backend', '.venv', 'Scripts', 'python.exe')
  : path.join(root, 'backend', '.venv', 'bin', 'python');

const statementCmd = fs.existsSync(py)
  ? [py, '-m', 'uvicorn', 'api:app', '--reload', '--host', '127.0.0.1', '--port', '8000']
  : ['python', '-m', 'uvicorn', 'api:app', '--reload', '--host', '127.0.0.1', '--port', '8000'];

console.log('=== Iniciando frontend + API + extrator Python ===');
console.log('Frontend: http://localhost:5173');

const procs = [
  runAsync('npm', ['run', 'dev'], { cwd: root }),
  runAsync('npm', ['run', 'dev'], { cwd: path.join(root, 'server') }),
  runAsync(statementCmd[0], statementCmd.slice(1), { cwd: path.join(root, 'backend') }),
];

process.on('SIGINT', () => {
  procs.forEach((p) => p.kill('SIGINT'));
  process.exit(0);
});
