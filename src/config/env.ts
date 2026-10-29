import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export type Env = Record<string, string | undefined>;

export function readEnvFile(path: string): Env {
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, 'utf8'));
}

const PLACEHOLDER = /\$\{([A-Za-z0-9_]+)\}/g;

export interface Substitution {
  value: unknown;
  /** Dotted path of each value that referenced an undefined variable → variable name. */
  missing: Map<string, string>;
}

/**
 * Replaces `${VAR}` placeholders in every string of a parsed YAML document.
 * A string referencing an undefined (or empty) variable becomes `undefined`,
 * so validation reports it as missing instead of silently using a partial value.
 */
export function substituteEnv(input: unknown, env: Env): Substitution {
  const missing = new Map<string, string>();

  const walk = (node: unknown, path: (string | number)[]): unknown => {
    if (typeof node === 'string') {
      let absent: string | undefined;
      const replaced = node.replace(PLACEHOLDER, (_match, name: string) => {
        const value = env[name];
        if (value === undefined || value === '') {
          absent ??= name;
          return '';
        }
        return value;
      });
      if (absent) {
        missing.set(path.join('.'), absent);
        return undefined;
      }
      return replaced;
    }
    if (Array.isArray(node)) return node.map((item, index) => walk(item, [...path, index]));
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, walk(value, [...path, key])]));
    }
    return node;
  };

  return { value: walk(input, []), missing };
}
