import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Cue } from '../src/subtitles/srt.ts';

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

/** Real cue timings (no text) kept in test/fixtures as `[startMs, endMs]` pairs. */
export function loadTimings(name: string): { reference: Cue[]; subtitle: Cue[] } {
  const raw = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Record<'reference' | 'subtitle', [number, number][]>;
  const cues = (pairs: [number, number][]) => pairs.map(([startMs, endMs], i) => ({ startMs, endMs, text: `${i}` }));
  return { reference: cues(raw.reference), subtitle: cues(raw.subtitle) };
}
