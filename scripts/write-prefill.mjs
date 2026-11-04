// TEST BUILDS ONLY (build.ps1 -Prefill): copies the developer's credentials from .env into
// assets/prefill.json, which Prefill.kt stores on the first start. Prints key names, never values.
// Usage: node write-prefill.mjs <.env> <output.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const [envFile, out] = process.argv.slice(2);
if (!envFile || !out) {
  console.error('uso: node write-prefill.mjs <.env> <saida.json>');
  process.exit(2);
}

const env = parseEnv(readFileSync(envFile, 'utf8'));
const REQUIRED = ['OPENSUBTITLES_API_KEY', 'OPENSUBTITLES_USER', 'OPENSUBTITLES_PASSWORD'];
const OPTIONAL = ['RD_TOKEN', 'DEEPL_API_KEY'];

const missing = REQUIRED.filter((key) => !env[key]);
if (missing.length > 0) {
  console.error(`faltam no .env: ${missing.join(', ')}`);
  process.exit(1);
}

const values = {};
for (const key of [...REQUIRED, ...OPTIONAL]) {
  if (env[key]) values[key] = env[key];
}
writeFileSync(out, JSON.stringify(values));
console.log(`prefill: ${Object.keys(values).join(', ')}`);
