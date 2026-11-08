import { z } from 'zod';

export class ConfigError extends Error {
  readonly file: string;
  readonly issues: string[];

  constructor(file: string, issues: string[]) {
    super(`Invalid configuration (${file}):\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
    this.file = file;
    this.issues = issues;
  }
}

/**
 * Plain messages for the validation errors a user is likely to hit while editing config.yaml.
 * Anything else keeps zod's own message (returning undefined).
 */
export const errorMap: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.input === undefined) return 'required';
      return `invalid type: expected ${issue.expected}, got ${describe(issue.input)}`;
    case 'invalid_value':
      return `invalid value "${String(issue.input)}" — options: ${issue.values.map(String).join(', ')}`;
    case 'invalid_format':
      if (issue.format === 'url') return 'invalid URL';
      break;
    case 'unrecognized_keys':
      return `unknown option: ${issue.keys.join(', ')} (typo?)`;
    case 'too_small':
      if (issue.origin === 'string') return 'must not be empty';
      if (issue.origin === 'array') return `needs at least ${String(issue.minimum)} item(s)`;
      return `must be greater than or equal to ${String(issue.minimum)}`;
    case 'too_big':
      return `must be less than or equal to ${String(issue.maximum)}`;
  }
  return undefined;
};

/** The type name zod 3 used to report ("string", "number", "array", "null"…). */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isNaN(value)) return 'nan';
  return typeof value;
}

/**
 * Renders an issue path like `languages.primary`, appending a hint when the value
 * came from a `${VAR}` placeholder that is not defined in the environment.
 */
export function formatIssue(
  label: string,
  message: string,
  missingVar: string | undefined,
): string {
  const hint = missingVar ? ` (variable ${missingVar} is not defined in .env)` : '';
  return `${label || '(root)'}: ${message}${hint}`;
}
