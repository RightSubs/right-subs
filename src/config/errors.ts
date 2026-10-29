import { z } from 'zod';

export class ConfigError extends Error {
  readonly file: string;
  readonly issues: string[];

  constructor(file: string, issues: string[]) {
    super(`Configuração inválida (${file}):\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
    this.file = file;
    this.issues = issues;
  }
}

/** Portuguese messages for the validation errors a user is likely to hit while editing config.yaml. */
export const errorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') return { message: 'obrigatório' };
      return { message: `tipo inválido: esperado ${issue.expected}, recebido ${issue.received}` };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `valor "${String(issue.received)}" inválido — opções: ${issue.options.join(', ')}` };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'url') return { message: 'URL inválida' };
      break;
    case z.ZodIssueCode.unrecognized_keys:
      return { message: `opção desconhecida: ${issue.keys.join(', ')} (erro de digitação?)` };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: 'não pode ser vazio' };
      if (issue.type === 'array') return { message: `precisa de pelo menos ${String(issue.minimum)} item` };
      return { message: `deve ser maior ou igual a ${String(issue.minimum)}` };
    case z.ZodIssueCode.too_big:
      return { message: `deve ser menor ou igual a ${String(issue.maximum)}` };
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
  const hint = missingVar ? ` (variável ${missingVar} não definida no .env)` : '';
  return `${label || '(raiz)'}: ${message}${hint}`;
}
