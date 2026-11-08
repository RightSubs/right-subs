import { z } from 'zod';
import { findLanguage, LANGUAGE_EXAMPLES, type Language } from '../languages/languages.ts';

const language = z.string().transform((value, ctx): Language => {
  const found = findLanguage(value);
  if (!found) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `unknown language "${value}" — valid examples: ${LANGUAGE_EXAMPLES.join(', ')}`,
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
      .refine((url) => url.endsWith('/manifest.json'), 'must be the URL of the addon\'s manifest.json')
      .optional(),
    timeoutMs: z.number().int().positive().default(10000),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.enabled && !entry.url) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'required' });
  });

/** Finds the file being played in the Real-Debrid download history (no stream proxy needed). */
const realdebrid = z
  .object({
    enabled: z.boolean().default(true),
    token: z.string().min(1).optional(),
    lookback: z.number().int().min(1).max(100).default(20),
    timeoutMs: z.number().int().positive().default(3000),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.enabled && !entry.token) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['token'], message: 'required' });
  });

/** Finds torrents played without a debrid service in Stremio's local streaming server (same device). */
const stremio = z
  .object({
    enabled: z.boolean().default(true),
    url: z.string().url().default('http://127.0.0.1:11470'),
    timeoutMs: z.number().int().positive().default(2000),
  })
  .strict();

/** Last-resort translation (DeepL) of a synced reference subtitle when nothing exists in the wanted languages. */
const deepl = z
  .object({
    enabled: z.boolean().default(false),
    apiKey: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().default(15000),
    /**
     * TESTING ONLY: with languages here, RightSubs ignores the subtitles that already exist in the
     * primary and secondary languages and always translates, only from these languages (same
     * timing check). Lets you see the translation of an episode that already has a subtitle.
     */
    forceFrom: z.array(language).max(5).default([]),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.enabled && !entry.apiKey) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['apiKey'], message: 'required' });
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
        realdebrid: realdebrid.optional(),
        stremio: stremio.optional(),
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
        /** Only for syncing, never shown: searched as references and preferred among embedded tracks. */
        referenceLanguages: z.array(language).max(5).default(['en']),
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
    translation: z.object({ deepl: deepl.default({}) }).strict().default({}),
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
        message: 'must differ from the primary language',
      });
    }
    const indexerIds = new Set<string>();
    config.streams.indexers.forEach((entry, index) => {
      if (indexerIds.has(entry.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['streams', 'indexers', index, 'id'], message: `id "${entry.id}" is repeated` });
      }
      indexerIds.add(entry.id);
    });
    const seen = new Set<string>();
    config.providers.forEach((provider, index) => {
      if (seen.has(provider.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providers', index, 'id'],
          message: `id "${provider.id}" is repeated`,
        });
      }
      seen.add(provider.id);
    });
  });

export type ParsedConfig = z.output<typeof configSchema>;
