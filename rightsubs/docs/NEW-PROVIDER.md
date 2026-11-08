# Adding a subtitle source

## Path 1 — is it a Stremio addon? Configuration only

If the source already exists as a Stremio subtitle addon, just add it to `config.yaml`:

```yaml
providers:
  # ...existing providers...
  - id: subdl
    type: stremio-addon
    enabled: true
    url: https://<addon-address>/manifest.json
```

The position in the list sets the priority. Validate with `npm run check-config` and restart.

## Path 2 — a source with its own API: one new file

1. Create `src/providers/<name>.ts` exporting a `ProviderType` (`src/providers/types.ts`):
   - `type`: the name used in `type:` in `config.yaml`;
   - `options`: zod schema of the specific options (use `.strict()` to catch typos);
   - `create(options, context)`: returns the `SubtitleProvider` implementation (`search` and `download`; `status` optional, shown in `/health`). Use `src/providers/http.ts` for the requests (timeout, User-Agent, errors) and set `metered: true` on candidates whose download uses quota. Examples: `stremio-addon.ts`, `opensubtitles-api.ts`.
2. Register it in `src/providers/index.ts`, in the `PROVIDER_TYPES` list.
3. Secrets go in `.env` and enter `config.yaml` as `${NAME}`.
4. Add tests in `test/` covering the options validation.

Minimal example:

```ts
import { z } from 'zod';
import { findLanguage } from '../languages/languages.ts';
import { requestFile, requestJson } from './http.ts';
import type { ProviderType } from './types.ts';

const options = z
  .object({
    apiKey: z.string().min(1),
    timeoutMs: z.number().int().positive().default(8000),
  })
  .strict();

export const mySource: ProviderType = {
  type: 'my-source',
  description: 'Short description shown in error messages',
  options,
  create: (raw, context) => {
    const { apiKey, timeoutMs } = raw as z.output<typeof options>;
    return {
      id: context.id,
      async search(query) {
        const body = await requestJson<{ items: { url: string; lang: string; release?: string }[] }>(
          context,
          `https://api.my-source.example/search?imdb=${query.imdbId}&key=${apiKey}`,
          { timeoutMs },
        );
        return body.items.flatMap((item) => {
          const language = findLanguage(item.lang);
          return language ? [{ providerId: context.id, ref: item.url, language, releaseName: item.release }] : [];
        });
      },
      download: (candidate) => requestFile(context, candidate.ref, timeoutMs),
    };
  },
};
```
