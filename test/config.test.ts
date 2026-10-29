import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConfigError } from '../src/config/errors.ts';
import { loadConfig } from '../src/config/load.ts';
import { FULL_ENV, MINIMAL_YAML, writeConfig } from './helpers.ts';

function issuesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (err) {
    if (err instanceof ConfigError) return err.issues;
    throw err;
  }
  assert.fail('expected a ConfigError');
}

test('the example config is valid once secrets are provided', () => {
  const config = loadConfig({ configFile: writeConfig(), env: FULL_ENV });
  assert.equal(config.languages.primary.tag, 'pt-BR');
  assert.equal(config.languages.secondary?.tag, 'en');
  assert.deepEqual(config.languages.useSecondaryWhen, ['not_found']);
  assert.deepEqual(config.providers.map((p) => p.id), ['opensubtitles-api', 'opensubtitles-v3']);
  assert.equal(config.providers[0]?.options['apiKey'], 'key');
  assert.deepEqual(config.streams.indexers.map((i) => [i.id, i.enabled]), [
    ['torrentio', false],
    ['sootio', false],
  ]);
  assert.equal(config.cache.dir, join(homedir(), '.rightsubs/cache'));
});

test('applies defaults for omitted sections', () => {
  const config = loadConfig({ configFile: writeConfig(MINIMAL_YAML), env: {} });
  assert.equal(config.server.port, 7000);
  assert.equal(config.server.host, '127.0.0.1');
  assert.equal(config.sync.budgetSeconds, 15);
  assert.deepEqual(config.resources, { idleAfterMinutes: 10, maxIdleMemoryMB: 80, maxConcurrentJobs: 1, lowPriority: true });
  assert.equal(config.cache.maxSizeMB, 50);
  assert.equal(config.cache.maxAgeDays, 10);
  assert.equal(config.providers[0]?.options['timeoutMs'], 8000);
});

test('reads secrets from the .env next to config.yaml, process env wins', () => {
  const configFile = writeConfig(undefined, 'OPENSUBTITLES_API_KEY=from-file\nOPENSUBTITLES_USER=u\nOPENSUBTITLES_PASSWORD=p\n');
  assert.equal(loadConfig({ configFile, env: {} }).providers[0]?.options['apiKey'], 'from-file');
  assert.equal(loadConfig({ configFile, env: { OPENSUBTITLES_API_KEY: 'from-env' } }).providers[0]?.options['apiKey'], 'from-env');
});

test('points at the missing .env variable', () => {
  const issues = issuesOf(() => loadConfig({ configFile: writeConfig(), env: {} }));
  assert.deepEqual(issues, [
    'providers[opensubtitles-api].apiKey: obrigatório (variável OPENSUBTITLES_API_KEY não definida no .env)',
  ]);
});

test('skips option validation for disabled providers', () => {
  const yaml = `${MINIMAL_YAML}
  - id: os-api
    type: opensubtitles-api
    enabled: false
    apiKey: \${OPENSUBTITLES_API_KEY}
`;
  const config = loadConfig({ configFile: writeConfig(yaml), env: {} });
  assert.deepEqual(config.providers.map((p) => [p.id, p.enabled]), [['os-v3', true], ['os-api', false]]);
});

test('rejects unknown languages with examples', () => {
  const issues = issuesOf(() => loadConfig({ configFile: writeConfig(MINIMAL_YAML.replace('pt-BR', 'pt-BRR')), env: {} }));
  assert.equal(issues.length, 1);
  assert.match(issues[0] ?? '', /^languages\.primary: idioma "pt-BRR" desconhecido — exemplos válidos: pt-BR/);
});

test('rejects a secondary language equal to the primary', () => {
  const yaml = MINIMAL_YAML.replace('primary: pt-BR', 'primary: pt-BR\n  secondary: pob');
  assert.deepEqual(issuesOf(() => loadConfig({ configFile: writeConfig(yaml), env: {} })), [
    'languages.secondary: deve ser diferente do idioma principal',
  ]);
});

test('catches typos in option names', () => {
  const yaml = `${MINIMAL_YAML}server:\n  prot: 8000\n`;
  assert.deepEqual(issuesOf(() => loadConfig({ configFile: writeConfig(yaml), env: {} })), [
    'server: opção desconhecida: prot (erro de digitação?)',
  ]);
});

test('rejects unknown provider types and lists the available ones', () => {
  const yaml = MINIMAL_YAML.replace('type: stremio-addon', 'type: legendas-tv');
  const issues = issuesOf(() => loadConfig({ configFile: writeConfig(yaml), env: {} }));
  assert.deepEqual(issues, [
    'providers[os-v3].type: tipo "legendas-tv" desconhecido — tipos disponíveis: opensubtitles-api, stremio-addon',
  ]);
});

test('validates stremio-addon URLs', () => {
  const yaml = MINIMAL_YAML.replace('/manifest.json', '/');
  assert.deepEqual(issuesOf(() => loadConfig({ configFile: writeConfig(yaml), env: {} })), [
    'providers[os-v3].url: deve ser a URL do manifest.json do addon',
  ]);
});

test('rejects downloadVia pointing to an unknown provider', () => {
  const yaml = `${MINIMAL_YAML}
  - id: os-api
    type: opensubtitles-api
    apiKey: k
    downloadVia: nope
`;
  assert.deepEqual(issuesOf(() => loadConfig({ configFile: writeConfig(yaml), env: {} })), [
    'providers[os-api].downloadVia: provedor "nope" não existe ou está desabilitado',
  ]);
});

test('rejects duplicated provider ids', () => {
  const yaml = `${MINIMAL_YAML}
  - id: os-v3
    type: stremio-addon
    url: https://example.com/manifest.json
`;
  assert.deepEqual(issuesOf(() => loadConfig({ configFile: writeConfig(yaml), env: {} })), [
    'providers.1.id: id "os-v3" repetido',
  ]);
});

test('requires at least one enabled provider', () => {
  const yaml = MINIMAL_YAML.replace('type: stremio-addon', 'type: stremio-addon\n    enabled: false');
  assert.deepEqual(issuesOf(() => loadConfig({ configFile: writeConfig(yaml), env: {} })), [
    'providers: nenhum provedor habilitado',
  ]);
});

test('explains how to create a missing config file', () => {
  const issues = issuesOf(() => loadConfig({ configFile: '/nonexistent/config.yaml', env: {} }));
  assert.match(issues[0] ?? '', /cp config\.example\.yaml config\.yaml/);
});

test('reports invalid YAML', () => {
  const issues = issuesOf(() => loadConfig({ configFile: writeConfig('languages: [unclosed'), env: {} }));
  assert.match(issues[0] ?? '', /^YAML inválido/);
});

test('rejects an e-mail as the OpenSubtitles username', () => {
  const issues = issuesOf(() => loadConfig({ configFile: writeConfig(), env: { ...FULL_ENV, OPENSUBTITLES_USER: 'me@example.com' } }));
  assert.deepEqual(issues, ['providers[opensubtitles-api].username: use o nome de usuário do OpenSubtitles, não o e-mail']);
});

test('an enabled indexer needs its manifest URL', () => {
  const yaml = `${MINIMAL_YAML}
streams:
  indexers:
    - id: torrentio
      url: \${TORRENTIO_URL}
    - id: sootio
      url: https://sootio.example/abc/stream.json
`;
  assert.deepEqual(issuesOf(() => loadConfig({ configFile: writeConfig(yaml), env: {} })), [
    'streams.indexers.0.url: obrigatório (variável TORRENTIO_URL não definida no .env)',
    'streams.indexers.1.url: deve ser a URL do manifest.json do addon',
  ]);
  const ok = loadConfig({ configFile: writeConfig(yaml.replace('stream.json', 'manifest.json')), env: { TORRENTIO_URL: 'https://torrentio.strem.fun/realdebrid=KEY/manifest.json' } });
  assert.equal(ok.streams.indexers[0]?.timeoutMs, 10000);
});
