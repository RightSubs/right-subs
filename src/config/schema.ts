import { z } from 'zod';
import { findLanguage, LANGUAGE_EXAMPLES, type Language } from '../languages/languages.ts';

const language = z.string().transform((value, ctx): Language => {
  const found = findLanguage(value);
  if (!found) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `idioma "${value}" desconhecido — exemplos válidos: ${LANGUAGE_EXAMPLES.join(', ')}`,
    });
    return z.NEVER;
  }
  return found;
});

/** A Stremio stream addon (Torrentio, Sootio…) whose results the addon passes through unchanged. */
const indexer = z
  .object({
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    url: z
      .string()
      .url()
      .refine((url) => url.endsWith('/manifest.json'), 'deve ser a URL do manifest.json do addon')
      .optional(),
    timeoutMs: z.number().int().positive().default(10000),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.enabled && !entry.url) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'obrigatório' });
  });

/** Generic provider entry; type-specific options are validated by each provider type. */
const providerEntry = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    enabled: z.boolean().default(true),
  })
  .passthrough();

export const configSchema = z
  .object({
    server: z
      .object({
        host: z.string().min(1).default('127.0.0.1'),
        port: z.number().int().min(1).max(65535).default(7000),
      })
      .strict()
      .default({}),
    languages: z
      .object({
        primary: language,
        secondary: language.optional(),
        useSecondaryWhen: z.array(z.enum(['not_found', 'low_confidence'])).default(['not_found']),
      })
      .strict(),
    providers: z.array(providerEntry).min(1),
    streams: z
      .object({
        indexers: z.array(indexer).default([]),
      })
      .strict()
      .default({}),
    sync: z
      .object({
        enabled: z.boolean().default(true),
        budgetSeconds: z.number().positive().default(15),
        minConfidence: z.number().min(0).max(1).default(0.7),
        embedded: z
          .object({
            enabled: z.boolean().default(true),
            windows: z.number().int().min(1).max(10).default(3),
            windowSeconds: z.number().int().min(15).max(600).default(45),
          })
          .strict()
          .default({}),
        audio: z
          .object({
            samples: z.number().int().min(1).default(8),
            sampleSeconds: z.number().positive().default(45),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),
    resources: z
      .object({
        idleAfterMinutes: z.number().positive().default(10),
        maxIdleMemoryMB: z.number().int().positive().default(80),
        maxConcurrentJobs: z.number().int().min(1).default(1),
        lowPriority: z.boolean().default(true),
      })
      .strict()
      .default({}),
    cache: z
      .object({
        dir: z.string().min(1).default('~/.rightsubs/cache'),
        maxSizeMB: z.number().positive().default(50),
        maxAgeDays: z.number().positive().default(10),
      })
      .strict()
      .default({}),
    log: z
      .object({
        level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((config, ctx) => {
    const { primary, secondary } = config.languages;
    if (secondary && secondary.tag === primary.tag) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['languages', 'secondary'],
        message: 'deve ser diferente do idioma principal',
      });
    }
    const indexerIds = new Set<string>();
    config.streams.indexers.forEach((entry, index) => {
      if (indexerIds.has(entry.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['streams', 'indexers', index, 'id'], message: `id "${entry.id}" repetido` });
      }
      indexerIds.add(entry.id);
    });
    const seen = new Set<string>();
    config.providers.forEach((provider, index) => {
      if (seen.has(provider.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providers', index, 'id'],
          message: `id "${provider.id}" repetido`,
        });
      }
      seen.add(provider.id);
    });
  });

export type ParsedConfig = z.output<typeof configSchema>;
