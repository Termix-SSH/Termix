/**
 * The frame's network. Requests to the plugin's own routes go straight to the
 * server with the frame token. Anything else on the server (core reads the
 * UI kit makes) goes to the shell, which checks it against a short list and
 * sends it with the user's login. Nothing else is reachable.
 */

export interface CoreResponse {
  status: number;
  headers: Record<string, string>;
  body: ArrayBuffer | null;
}

export interface FrameNetOptions {
  pluginId: string;
  /** Server root as the frame reaches it, like https://host/base. */
  baseUrl: string;
  token: () => Promise<string>;
  /** Sends a core request through the shell. */
  coreRequest: (request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: ArrayBuffer | null;
  }) => Promise<CoreResponse>;
  realFetch: typeof fetch;
}

export type RouteKind = "own-api" | "own-asset" | "core" | "blocked";

export interface ResolvedRoute {
  kind: RouteKind;
  /** Path under the server root, for core requests. */
  path: string;
  /** Full URL, for direct requests. */
  url: string;
}

const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where a URL the frame asked for really goes. */
export function resolveRoute(
  input: string,
  pluginId: string,
  baseUrl: string,
): ResolvedRoute {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  let target: URL;
  try {
    target = new URL(input, base);
  } catch {
    return { kind: "blocked", path: "", url: input };
  }
  if (target.origin !== base.origin || target.username || target.password) {
    return { kind: "blocked", path: "", url: target.href };
  }
  if (/%2f|%5c|%2e/i.test(target.pathname) || target.pathname.includes("\\")) {
    return { kind: "blocked", path: "", url: target.href };
  }
  const prefix = base.pathname.replace(/\/+$/, "");
  let path = target.pathname;
  // Core code in the frame builds URLs from the server root, without the
  // base path the server may sit under.
  if (prefix && (path === prefix || path.startsWith(`${prefix}/`))) {
    path = path.slice(prefix.length) || "/";
  }
  if (path.split("/").some((part) => part === "." || part === "..")) {
    return { kind: "blocked", path: "", url: target.href };
  }
  const url = `${base.origin}${prefix}${path}${target.search}`;
  const id = esc(pluginId);
  if (new RegExp(`^/plugin-api/${id}(/|$)`).test(path)) {
    return { kind: "own-api", path, url };
  }
  if (new RegExp(`^/plugin-assets/${id}/`).test(path)) {
    return { kind: "own-asset", path, url };
  }
  return { kind: "core", path: `${path}${target.search}`, url };
}

function headersOf(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
}

export function createFrameFetch(options: FrameNetOptions): typeof fetch {
  return async (input, init) => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (/^(data|blob):/i.test(href)) return options.realFetch(input, init);
    const route = resolveRoute(href, options.pluginId, options.baseUrl);
    const request =
      input instanceof Request && !init ? input : new Request(route.url, init);

    if (route.kind === "own-api") {
      const headers = new Headers(request.headers);
      headers.set("Authorization", `Bearer ${await options.token()}`);
      return options.realFetch(route.url, {
        method: request.method,
        headers,
        body:
          request.method === "GET" || request.method === "HEAD"
            ? undefined
            : await request.arrayBuffer(),
        signal: init?.signal ?? request.signal,
        credentials: "omit",
        cache: init?.cache,
        redirect: "follow",
      });
    }
    if (route.kind === "own-asset") {
      return options.realFetch(route.url, {
        method: "GET",
        credentials: "omit",
        signal: init?.signal ?? request.signal,
      });
    }
    if (route.kind === "blocked") {
      throw new TypeError("This address is not reachable from a plugin view");
    }
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? null
        : await request.arrayBuffer();
    const response = await options.coreRequest({
      method: request.method,
      path: route.path,
      headers: headersOf(request.headers),
      body: body && body.byteLength > 0 ? body : null,
    });
    const nullBody = response.status === 204 || response.status === 304;
    return new Response(nullBody ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  };
}

/** An XMLHttpRequest that runs on the frame's fetch, for axios. */
export function createFrameXhr(
  frameFetch: typeof fetch,
): typeof XMLHttpRequest {
  class FrameXhr extends EventTarget {
    static readonly UNSENT = 0;
    static readonly OPENED = 1;
    static readonly HEADERS_RECEIVED = 2;
    static readonly LOADING = 3;
    static readonly DONE = 4;
    readonly UNSENT = 0;
    readonly OPENED = 1;
    readonly HEADERS_RECEIVED = 2;
    readonly LOADING = 3;
    readonly DONE = 4;

    readyState = 0;
    status = 0;
    statusText = "";
    responseType: XMLHttpRequestResponseType = "";
    response: unknown = null;
    responseText = "";
    responseURL = "";
    timeout = 0;
    withCredentials = false;
    upload = new EventTarget();

    onreadystatechange: ((event: Event) => void) | null = null;
    onload: ((event: Event) => void) | null = null;
    onloadend: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onabort: ((event: Event) => void) | null = null;
    ontimeout: ((event: Event) => void) | null = null;

    private method = "GET";
    private url = "";
    private headers = new Headers();
    private responseHeaders: Record<string, string> = {};
    private controller: AbortController | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;

    open(method: string, url: string | URL): void {
      this.method = method.toUpperCase();
      this.url = String(url);
      this.headers = new Headers();
      this.setState(1);
    }

    setRequestHeader(name: string, value: string): void {
      this.headers.set(name, value);
    }

    getResponseHeader(name: string): string | null {
      return this.responseHeaders[name.toLowerCase()] ?? null;
    }

    getAllResponseHeaders(): string {
      return Object.entries(this.responseHeaders)
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n");
    }

    overrideMimeType(): void {}

    send(body?: Document | XMLHttpRequestBodyInit | null): void {
      const controller = new AbortController();
      this.controller = controller;
      if (this.timeout > 0) {
        this.timer = setTimeout(() => {
          controller.abort();
          this.finish("timeout");
        }, this.timeout);
      }
      frameFetch(this.url, {
        method: this.method,
        headers: this.headers,
        body:
          this.method === "GET" || this.method === "HEAD"
            ? undefined
            : (body as BodyInit | null | undefined),
        signal: controller.signal,
      }).then(
        async (response) => {
          this.status = response.status;
          this.statusText = response.statusText;
          this.responseURL = this.url;
          this.responseHeaders = headersOf(response.headers);
          this.setState(2);
          this.setState(3);
          const buffer = await response.arrayBuffer();
          if (this.controller !== controller) return;
          const text = () => new TextDecoder().decode(buffer);
          if (this.responseType === "arraybuffer") this.response = buffer;
          else if (this.responseType === "blob") {
            this.response = new Blob([buffer], {
              type: response.headers.get("content-type") ?? "",
            });
          } else if (this.responseType === "json") {
            try {
              this.response = JSON.parse(text());
            } catch {
              this.response = null;
            }
          } else {
            this.responseText = text();
            this.response = this.responseText;
          }
          this.finish("load");
        },
        () => {
          if (this.controller === controller) this.finish("error");
        },
      );
    }

    abort(): void {
      if (!this.controller) return;
      this.controller.abort();
      this.finish("abort");
    }

    private setState(state: number) {
      this.readyState = state;
      this.fire("readystatechange");
    }

    private finish(kind: "load" | "error" | "abort" | "timeout") {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.controller = null;
      if (kind !== "load") this.status = 0;
      this.setState(4);
      this.fire(kind);
      this.fire("loadend");
    }

    private fire(type: string) {
      const event = new Event(type);
      this.dispatchEvent(event);
      const handler = (this as unknown as Record<string, unknown>)[`on${type}`];
      if (typeof handler === "function") handler.call(this, event);
    }
  }
  return FrameXhr as unknown as typeof XMLHttpRequest;
}
