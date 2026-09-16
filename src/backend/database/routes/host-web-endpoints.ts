import {
  MAX_WEB_ENDPOINTS,
  MAX_WEB_ENDPOINT_LABEL_LENGTH,
} from "../../../types/index.js";
import type { WebEndpoint, WebUiConfig } from "../../../types/index.js";

export { MAX_WEB_ENDPOINTS, MAX_WEB_ENDPOINT_LABEL_LENGTH };

const SCHEMES = new Set(["http", "https"]);
const ACCESS_VALUES = new Set(["direct", "tunnel"]);
const RENDER_VALUES = new Set(["external", "embedded"]);

const MIN_PORT = 1;
const MAX_PORT = 65535;

function isValidPort(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_PORT &&
    value <= MAX_PORT
  );
}

/**
 * C0 controls and DEL. Checked by codepoint rather than by regex character
 * class so no escaping subtlety can let one through: a path like
 * "\t//evil.example" defeats a naive startsWith("//") guard, because the
 * browser strips the control character and then follows the authority.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Coerces a path to begin with "/", or returns null to drop the endpoint.
 *
 * This is THE enforcement point for a value that reaches an href and an
 * iframe src -- the editor's checks are UX. Anything that could redirect the
 * frame away from the endpoint is rejected rather than sanitized, because
 * sanitizing invites a second, subtly different implementation elsewhere.
 */
function normalizePath(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return "/";
  if (typeof raw !== "string") return null;
  if (hasControlCharacter(raw)) return null;

  const path = raw.startsWith("/") ? raw : `/${raw}`;

  if (path.startsWith("//")) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  if (path.includes("\\")) return null;

  return path;
}

/**
 * A bare host literal, or null to drop the endpoint, or undefined to leave the
 * field unset (the route then falls back to loopback).
 *
 * The value lands both in a TCP listener and in a URL authority, so nothing
 * carrying a scheme, port, path or credentials may survive.
 */
function normalizeBindHost(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") return null;

  const value = raw.trim();
  if (!value) return undefined;
  if (value.length > 253) return null;
  if (hasControlCharacter(value)) return null;

  const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  const HOSTNAME =
    /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
  const IPV6_BRACKETED = /^\[[0-9A-Fa-f:.]+\]$/;

  if (IPV4.test(value)) {
    return value.split(".").every((part) => Number(part) <= 255) ? value : null;
  }
  if (IPV6_BRACKETED.test(value) || HOSTNAME.test(value)) return value;
  return null;
}

function normalizeEndpoint(raw: unknown): WebEndpoint | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;

  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!id) return null;

  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!label) return null;

  const scheme = input.scheme;
  if (typeof scheme !== "string" || !SCHEMES.has(scheme)) return null;

  if (!isValidPort(input.port)) return null;

  const path = normalizePath(input.path);
  if (path === null) return null;

  const access = input.access;
  if (typeof access !== "string" || !ACCESS_VALUES.has(access)) return null;

  const render = input.render;
  if (typeof render !== "string" || !RENDER_VALUES.has(render)) return null;

  const isTunnel = access === "tunnel";

  const endpoint: WebEndpoint = {
    id,
    label: label.slice(0, MAX_WEB_ENDPOINT_LABEL_LENGTH),
    scheme: scheme as WebEndpoint["scheme"],
    port: input.port,
    path,
    access: access as WebEndpoint["access"],
    render: render as WebEndpoint["render"],
    // Meaningless for a tunnel, whose host component is loopback and already
    // exempt from certificate checks. Cleared rather than carried so nothing
    // downstream has to re-derive that.
    ignoreCert: !isTunnel && input.ignoreCert === true,
  };

  // Both are tunnel-only. Silently ignored on a direct endpoint rather than
  // rejected: they describe a forward that a direct endpoint never creates.
  if (isTunnel) {
    const bindHost = normalizeBindHost(input.bindHost);
    if (bindHost === null) return null;
    if (bindHost !== undefined) endpoint.bindHost = bindHost;

    if (input.localPort !== undefined && input.localPort !== null) {
      if (!isValidPort(input.localPort)) return null;
      endpoint.localPort = input.localPort;
    }
  }

  return endpoint;
}

/**
 * Drops any endpoint it refuses rather than rejecting the whole host -- one
 * bad row must not make a host unsaveable or unlistable. The editor is
 * responsible for telling the user before that happens
 * (src/ui/lib/web-endpoint-validation.ts).
 */
export function normalizeWebEndpoints(raw: unknown): WebEndpoint[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const endpoints: WebEndpoint[] = [];

  for (const candidate of raw) {
    if (endpoints.length >= MAX_WEB_ENDPOINTS) break;
    const endpoint = normalizeEndpoint(candidate);
    if (!endpoint) continue;
    if (seen.has(endpoint.id)) continue;
    seen.add(endpoint.id);
    endpoints.push(endpoint);
  }

  return endpoints;
}

/**
 * Never throws. A malformed stored value yields an empty endpoint list, so a
 * half-written config cannot take out the whole host listing -- which is what
 * dockerConfig's bare JSON.parse does today.
 */
export function parseWebUiConfig(raw: unknown): WebUiConfig {
  if (raw === undefined || raw === null) return { endpoints: [] };

  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { endpoints: [] };
    }
  }

  if (!value || typeof value !== "object") return { endpoints: [] };
  return {
    endpoints: normalizeWebEndpoints(
      (value as { endpoints?: unknown }).endpoints,
    ),
  };
}

/** Null when nothing survives normalization, so the column is cleared. */
export function serializeWebUiConfig(config: unknown): string | null {
  const endpoints = normalizeWebEndpoints(
    (config as { endpoints?: unknown } | null | undefined)?.endpoints,
  );
  if (endpoints.length === 0) return null;
  return JSON.stringify({ endpoints });
}
