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

/** Plain messages for the validation errors a user is likely to hit while editing config.yaml. */
export const errorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') return { message: 'required' };
      return { message: `invalid type: expected ${issue.expected}, got ${issue.received}` };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `invalid value "${String(issue.received)}" — options: ${issue.options.join(', ')}` };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'url') return { message: 'invalid URL' };
      break;
    case z.ZodIssueCode.unrecognized_keys:
      return { message: `unknown option: ${issue.keys.join(', ')} (typo?)` };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: 'must not be empty' };
      if (issue.type === 'array') return { message: `needs at least ${String(issue.minimum)} item(s)` };
      return { message: `must be greater than or equal to ${String(issue.minimum)}` };
    case z.ZodIssueCode.too_big:
      return { message: `must be less than or equal to ${String(issue.maximum)}` };
  }
  return { message: ctx.defaultError };
};

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
