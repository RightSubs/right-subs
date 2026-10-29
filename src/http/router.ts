import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  /** Path parameters exactly as they appear in the URL (still percent-encoded). */
  params: Record<string, string>;
}

export type RouteHandler = (ctx: RouteContext) => void | Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
}

export interface RouteMatch {
  handler: RouteHandler;
  params: Record<string, string>;
}

/** Minimal router for Stremio-style paths such as `/subtitles/:type/:id/:extra.json`. */
export class Router {
  #routes: Route[] = [];

  get(path: string, handler: RouteHandler): this {
    const { pattern, keys } = compile(path);
    this.#routes.push({ method: 'GET', pattern, keys, handler });
    return this;
  }

  match(method: string, pathname: string): RouteMatch | undefined {
    const wanted = method === 'HEAD' ? 'GET' : method;
    for (const route of this.#routes) {
      if (route.method !== wanted) continue;
      const found = route.pattern.exec(pathname);
      if (!found) continue;
      const params = Object.fromEntries(route.keys.map((key, index) => [key, found[index + 1] ?? '']));
      return { handler: route.handler, params };
    }
    return undefined;
  }
}

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path.replace(/:([A-Za-z]+)|[^:]+/g, (segment, key: string | undefined) => {
    if (key) {
      keys.push(key);
      return '([^/]+?)';
    }
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}
