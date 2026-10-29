import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXAMPLE_CONFIG = fileURLToPath(new URL('../config.example.yaml', import.meta.url));

export const FULL_ENV = {
  OPENSUBTITLES_API_KEY: 'key',
  OPENSUBTITLES_USER: 'user',
  OPENSUBTITLES_PASSWORD: 'secret',
};

/** Creates a temp dir with config.yaml (example config unless `yaml` is given) and an optional .env. */
export function writeConfig(yaml?: string, dotenv?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rightsubs-'));
  const configFile = join(dir, 'config.yaml');
  if (yaml === undefined) copyFileSync(EXAMPLE_CONFIG, configFile);
  else writeFileSync(configFile, yaml);
  if (dotenv !== undefined) writeFileSync(join(dir, '.env'), dotenv);
  return configFile;
}

export const MINIMAL_YAML = `
languages:
  primary: pt-BR
providers:
  - id: os-v3
    type: stremio-addon
    url: https://opensubtitles-v3.strem.io/manifest.json
`;
