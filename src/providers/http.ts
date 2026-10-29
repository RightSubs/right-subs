import { ProviderError, type ProviderContext } from './types.ts';

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}

/** Subtitle files are small; anything bigger is not a subtitle. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

export function userAgent(version: string): string {
  return `RightSubs v${version}`;
}

export async function request(context: ProviderContext, url: string, options: RequestOptions): Promise<Response> {
  const { method = 'GET', headers = {}, body, timeoutMs } = options;
  let res: Response;
  try {
    res = await context.fetch(url, {
      method,
      headers: {
        'User-Agent': userAgent(context.version),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = (err as Error).name === 'TimeoutError';
    throw new ProviderError(context.id, timedOut ? `sem resposta em ${timeoutMs} ms` : (err as Error).message);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ProviderError(context.id, `HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`, res.status);
  }
  return res;
}

export async function requestJson<T>(context: ProviderContext, url: string, options: RequestOptions): Promise<T> {
  const res = await request(context, url, { ...options, headers: { Accept: 'application/json', ...options.headers } });
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError(context.id, 'resposta não é JSON válido');
  }
}

export async function requestFile(context: ProviderContext, url: string, timeoutMs: number): Promise<Buffer> {
  const res = await request(context, url, { timeoutMs });
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw new ProviderError(context.id, `arquivo grande demais (${declared} bytes)`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_BODY_BYTES) throw new ProviderError(context.id, `arquivo grande demais (${buffer.length} bytes)`);
  return buffer;
}
