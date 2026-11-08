import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { findProviderType, PROVIDER_TYPES } from '../providers/index.ts';
import { readEnvFile, substituteEnv, type Env } from './env.ts';
import { ConfigError, errorMap, formatIssue } from './errors.ts';
import { configSchema, type ParsedConfig } from './schema.ts';

export interface ProviderConfig {
  id: string;
  type: string;
  enabled: boolean;
  /** Type-specific options, already validated (empty for disabled providers). */
  options: Record<string, unknown>;
}

export interface AppConfig extends Omit<ParsedConfig, 'providers'> {
  providers: ProviderConfig[];
  source: { configFile: string; envFile: string };
}

export interface LoadOptions {
  configFile: string;
  /** Defaults to `.env` next to the config file. */
  envFile?: string;
  /** Process environment; takes precedence over the .env file. */
  env?: Env;
}

export function loadConfig({ configFile, envFile, env = process.env }: LoadOptions): AppConfig {
  const resolvedEnvFile = envFile ?? join(dirname(configFile), '.env');

  if (!existsSync(configFile)) {
    throw new ConfigError(configFile, [
      'file not found — create it from the example: cp config.example.yaml config.yaml',
    ]);
  }

  let document: unknown;
  try {
    document = parseYaml(readFileSync(configFile, 'utf8'));
  } catch (err) {
    throw new ConfigError(configFile, [`invalid YAML: ${(err as Error).message}`]);
  }

  const mergedEnv = { ...readEnvFile(resolvedEnvFile), ...definedOnly(env) };
  const { value, missing } = substituteEnv(document ?? {}, mergedEnv);

  const parsed = configSchema.safeParse(value, { errorMap });
  if (!parsed.success) {
    throw new ConfigError(
      configFile,
      parsed.error.issues.map((issue) =>
        formatIssue(issue.path.join('.'), issue.message, missing.get(issue.path.join('.'))),
      ),
    );
  }

  const { providers, issues } = validateProviders(parsed.data.providers, missing);
  if (issues.length > 0) throw new ConfigError(configFile, issues);

  return {
    ...parsed.data,
    providers,
    cache: { ...parsed.data.cache, dir: expandHome(parsed.data.cache.dir) },
    source: { configFile, envFile: resolvedEnvFile },
  };
}

function validateProviders(
  entries: ParsedConfig['providers'],
  missing: Map<string, string>,
): { providers: ProviderConfig[]; issues: string[] } {
  const issues: string[] = [];
  const providers: ProviderConfig[] = [];
  const enabledIds = new Set(entries.filter((entry) => entry.enabled).map((entry) => entry.id));

  entries.forEach((entry, index) => {
    const { id, type, enabled, ...rawOptions } = entry;
    const label = `providers[${id}]`;
    const providerType = findProviderType(type);

    if (!providerType) {
      const available = PROVIDER_TYPES.map((p) => p.type).join(', ');
      issues.push(formatIssue(`${label}.type`, `unknown type "${type}" — available types: ${available}`, undefined));
      return;
    }
    if (!enabled) {
      providers.push({ id, type, enabled, options: {} });
      return;
    }

    const result = providerType.options.safeParse(rawOptions, { errorMap });
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path.join('.');
        issues.push(formatIssue(`${label}.${field}`, issue.message, missing.get(`providers.${index}.${field}`)));
      }
      return;
    }

    const options = result.data as Record<string, unknown>;
    const downloadVia = options['downloadVia'];
    if (typeof downloadVia === 'string' && !enabledIds.has(downloadVia)) {
      issues.push(formatIssue(`${label}.downloadVia`, `provider "${downloadVia}" does not exist or is disabled`, undefined));
    }
    providers.push({ id, type, enabled, options });
  });

  if (issues.length === 0 && enabledIds.size === 0) {
    issues.push(formatIssue('providers', 'no provider enabled', undefined));
  }
  return { providers, issues };
}

function definedOnly(env: Env): Env {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== ''));
}

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;
}
