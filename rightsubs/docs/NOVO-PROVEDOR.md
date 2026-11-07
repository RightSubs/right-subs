# Adicionando uma fonte de legendas

## Caminho 1 — é um addon do Stremio? Só configuração

Se a fonte já existe como addon de legendas do Stremio, basta adicionar ao `config.yaml`:

```yaml
providers:
  # ...provedores existentes...
  - id: subdl
    type: stremio-addon
    enabled: true
    url: https://<endereço-do-addon>/manifest.json
```

A posição na lista define a prioridade. Valide com `npm run check-config` e reinicie.

## Caminho 2 — fonte com API própria: um arquivo novo

1. Crie `src/providers/<nome>.ts` exportando um `ProviderType` (`src/providers/types.ts`):
   - `type`: o nome usado em `type:` no `config.yaml`;
   - `options`: schema zod das opções específicas (use `.strict()` para pegar erros de digitação);
   - `create(options, context)`: devolve a implementação de `SubtitleProvider` (`search` e `download`; `status` opcional, mostrado no `/health`). Use `src/providers/http.ts` para as requisições (timeout, User-Agent, erros) e marque `metered: true` nos candidatos cujo download gaste cota. Exemplos: `stremio-addon.ts`, `opensubtitles-api.ts`.
2. Registre em `src/providers/index.ts`, na lista `PROVIDER_TYPES`.
3. Segredos vão no `.env` e entram no `config.yaml` como `${NOME}`.
4. Adicione testes em `test/` cobrindo a validação das opções.

Exemplo mínimo:

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

export const minhaFonte: ProviderType = {
  type: 'minha-fonte',
  description: 'Descrição curta mostrada em mensagens de erro',
  options,
  create: (raw, context) => {
    const { apiKey, timeoutMs } = raw as z.output<typeof options>;
    return {
      id: context.id,
      async search(query) {
        const body = await requestJson<{ items: { url: string; lang: string; release?: string }[] }>(
          context,
          `https://api.minha-fonte.example/search?imdb=${query.imdbId}&key=${apiKey}`,
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
