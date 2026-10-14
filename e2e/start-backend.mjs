import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '../backend');
const python = process.env.ROOMSHELF_E2E_PYTHON || join(backend, '.venv/bin/python');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'roomshelf-e2e-'));
const environment = {
  ...process.env,
  ROOMSHELF_DATABASE_URL: `sqlite:///${join(temporaryDirectory, 'catalog.sqlite3')}`,
  ROOMSHELF_SECRET_KEY: randomBytes(32).toString('hex'),
  ROOMSHELF_PUBLIC_ORIGIN: 'http://127.0.0.1:4173',
  ROOMSHELF_ENV: 'development',
};

for (const command of ['init-db', 'seed']) {
  const result = spawnSync(python, ['-m', 'flask', '--app', 'roomshelf', command], {
    cwd: backend,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    if (result.error) console.error(result.error.message);
    process.exit(result.status || 1);
  }
}

const server = spawn(
  python,
  ['-m', 'flask', '--app', 'roomshelf', 'run', '--host', '127.0.0.1', '--port', '5000', '--no-reload'],
  { cwd: backend, env: environment, stdio: 'inherit' },
);

server.on('error', (error) => {
  console.error(error.message);
  rmSync(temporaryDirectory, { recursive: true, force: true });
  process.exit(1);
});
server.on('exit', (code, signal) => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
  process.exit(signal ? 0 : (code || 0));
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}
