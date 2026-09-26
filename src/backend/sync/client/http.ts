/**
 * Requests from a desktop to the server it is linked to.
 *
 * The Termix session travels as the jwt cookie rather than an Authorization
 * header, so a proxy in front that uses basic auth can have that header to
 * itself. Proxy headers (a Cloudflare Access service token, a gateway key)
 * are added to every request.
 */

import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";
import type { Dispatcher } from "undici";
import type { BasicAuth, ProxyHeader } from "./link-store.js";

export interface RemoteTarget {
  serverUrl: string;
  sessionToken?: string | null;
  customHeaders?: ProxyHeader[];
  basicAuth?: BasicAuth | null;
  allowInvalidCertificate?: boolean;
}

export type RemoteErrorKind =
  /** Could not reach the server at all. */
  | "offline"
  /** TLS failed and the certificate is not allowed. */
  | "tls"
  /** A proxy answered instead of Termix (its login page, a 404 page). */
  | "proxy"
  /** The proxy wants basic auth. */
  | "basic_auth"
  /** Termix refused the session: revoked, expired or signed out. */
  | "signed_out"
  /** Termix answered with an error. */
  | "server";

export class RemoteError extends Error {
  constructor(
    readonly kind: RemoteErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const TLS_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_UNTRUSTED",
]);

function envProxy(url: string): string | null {
  const proxy =
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY;
  if (!proxy) return null;
  const hostname = new URL(url).hostname.toLowerCase();
  const noProxy = (process.env.no_proxy || process.env.NO_PROXY || "")
    .split(",")
    .map((entry) =>
      entry
        .trim()
        .toLowerCase()
        .replace(/^\*?\./, ""),
    )
    .filter(Boolean);
  if (
    noProxy.some(
      (entry) => hostname === entry || hostname.endsWith(`.${entry}`),
    )
  )
    return null;
  return proxy;
}

const dispatchers = new Map<string, Dispatcher>();

function dispatcherFor(target: RemoteTarget): Dispatcher {
  const insecure = !!target.allowInvalidCertificate;
  const proxy = envProxy(target.serverUrl);
  const key = `${insecure}|${proxy ?? ""}`;
  let dispatcher = dispatchers.get(key);
  if (!dispatcher) {
    const tls = insecure ? { rejectUnauthorized: false } : {};
    dispatcher = proxy
      ? new ProxyAgent({ uri: proxy, requestTls: tls })
      : new Agent({ connect: tls });
    dispatchers.set(key, dispatcher);
  }
  return dispatcher;
}

/** "https://x.example/termix/" + "/sync/v2/info" keeps the base path. */
export function remoteUrl(serverUrl: string, pathname: string): string {
  return `${serverUrl.replace(/\/+$/, "")}${pathname}`;
}

export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) &&
    !/^https?:\/\//i.test(trimmed)
  ) {
    return null;
  }
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function requestHeaders(target: RemoteTarget): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Electron-App": "true",
    "User-Agent": "Termix-Desktop-Sync",
  };
  for (const header of target.customHeaders ?? []) {
    if (header.name && header.value) headers[header.name] = header.value;
  }
  if (target.basicAuth?.username) {
    headers.Authorization = `Basic ${Buffer.from(
      `${target.basicAuth.username}:${target.basicAuth.password ?? ""}`,
    ).toString("base64")}`;
  }
  if (target.sessionToken) headers.Cookie = `jwt=${target.sessionToken}`;
  return headers;
}

function describeNetworkError(error: unknown): RemoteError {
  const cause = (error as { cause?: { code?: string; message?: string } })
    ?.cause;
  const code = cause?.code ?? (error as { code?: string })?.code ?? "";
  if (TLS_CODES.has(code) || /certificate/i.test(cause?.message ?? "")) {
    return new RemoteError("tls", cause?.message || code);
  }
  if ((error as Error)?.name === "AbortError") {
    return new RemoteError("offline", "The server did not answer in time");
  }
  return new RemoteError(
    "offline",
    cause?.message || (error as Error)?.message || "Could not reach the server",
  );
}

export interface RemoteRequest {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Sends a request and returns the raw response, classifying failures. */
export async function remoteFetch(
  target: RemoteTarget,
  pathname: string,
  request: RemoteRequest = {},
) {
  const url = remoteUrl(target.serverUrl, pathname);
  const headers = requestHeaders(target);
  if (request.body !== undefined) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timeout = request.timeoutMs
    ? setTimeout(() => controller.abort(), request.timeoutMs)
    : null;
  request.signal?.addEventListener("abort", () => controller.abort(), {
    once: true,
  });

  let response;
  try {
    response = await undiciFetch(url, {
      method: request.method ?? "GET",
      headers,
      body:
        request.body !== undefined ? JSON.stringify(request.body) : undefined,
      dispatcher: dispatcherFor(target),
      signal: controller.signal,
    });
  } catch (error) {
    throw describeNetworkError(error);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  return response;
}

/** Sends a request and parses a JSON answer from Termix. */
export async function remoteJson<T>(
  target: RemoteTarget,
  pathname: string,
  request: RemoteRequest = {},
): Promise<T> {
  const response = await remoteFetch(target, pathname, {
    timeoutMs: 60_000,
    ...request,
  });
  const type = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (!type.includes("application/json")) {
    if (
      response.status === 401 &&
      /basic/i.test(response.headers.get("www-authenticate") ?? "")
    ) {
      throw new RemoteError(
        "basic_auth",
        "The server asks for a username and password before Termix",
        401,
      );
    }
    throw new RemoteError(
      "proxy",
      `Something other than Termix answered (${response.status})`,
      response.status,
    );
  }

  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new RemoteError(
      "proxy",
      "The server sent invalid JSON",
      response.status,
    );
  }

  if (response.status === 401) {
    throw new RemoteError(
      "signed_out",
      (data as { error?: string })?.error || "Signed out",
      401,
    );
  }
  if (!response.ok) {
    throw new RemoteError(
      "server",
      (data as { error?: string })?.error || `Server error ${response.status}`,
      response.status,
    );
  }
  return data as T;
}
