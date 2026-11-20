/**
 * What a request looked like when it reached the server: header and cookie
 * names only, never values. Enough to see a proxy or login gate in front of
 * Termix without leaking anything it sends.
 */
import type { Request } from "express";
import { isIP } from "net";
import { getClientIp } from "../utils/request-origin.js";

/** Headers that point at a login proxy or a tunnel in front of Termix. */
const PROXY_SIGNS: [RegExp, string][] = [
  [/^remote-(user|email|groups|name)$/, "forward auth (Authelia or similar)"],
  [/^x-authentik-/, "Authentik"],
  [/^x-auth-request-/, "oauth2-proxy"],
  [/^x-forwarded-(user|email|preferred-username|groups)$/, "forward auth"],
  [/^cf-access-/, "Cloudflare Access"],
  [/^cf-(ray|connecting-ip|ipcountry|visitor)$/, "Cloudflare"],
  [/^x-pomerium-/, "Pomerium"],
  [/^tailscale-user-/, "Tailscale Serve"],
  [/^x-amzn-/, "AWS load balancer"],
  [/^x-goog-/, "Google proxy"],
  [/^via$/, "a proxy that sets Via"],
];

export type IpClass = "loopback" | "private" | "public" | "unknown";

export function classifyIp(raw: string): IpClass {
  const ip = raw.replace(/^::ffff:/, "");
  const kind = isIP(ip);
  if (!kind) return "unknown";
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return "loopback";
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254)
    ) {
      return "private";
    }
    return "public";
  }
  const lower = ip.toLowerCase();
  if (lower === "::1") return "loopback";
  if (/^f[cd]/.test(lower) || lower.startsWith("fe80")) return "private";
  return "public";
}

export interface RequestInfo {
  method: string;
  protocol: string;
  headerNames: string[];
  cookieNames: string[];
  authCookie: boolean;
  authHeader: boolean;
  forwarded: {
    hops: number;
    proto: string | null;
    hostDiffers: boolean;
    port: string | null;
  };
  clientIp: IpClass;
  proxySigns: string[];
  userAgent: string | null;
}

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function describeRequest(req: Request): RequestInfo {
  const headerNames = Object.keys(req.headers)
    .map((name) => name.toLowerCase())
    .sort();
  const cookieNames = (first(req.headers.cookie) ?? "")
    .split(";")
    .map((part) => part.split("=")[0]?.trim())
    .filter((name): name is string => !!name)
    .map((name) => name.slice(0, 64))
    .sort();
  const forwardedFor = first(req.headers["x-forwarded-for"]);
  const forwardedHost = first(req.headers["x-forwarded-host"]);
  const signs = new Set<string>();
  for (const name of headerNames) {
    for (const [pattern, label] of PROXY_SIGNS) {
      if (pattern.test(name)) signs.add(label);
    }
  }
  const proto = first(req.headers["x-forwarded-proto"]);
  return {
    method: req.method,
    protocol: req.protocol,
    headerNames,
    cookieNames,
    authCookie: cookieNames.includes("jwt"),
    authHeader: !!req.headers.authorization,
    forwarded: {
      hops: forwardedFor
        ? forwardedFor.split(",").filter((part) => part.trim()).length
        : 0,
      proto: proto && /^[a-z]{2,8}$/i.test(proto) ? proto : null,
      hostDiffers: !!forwardedHost && forwardedHost !== req.headers.host,
      port: first(req.headers["x-forwarded-port"])?.match(/^\d{1,5}$/)?.[0]
        ? first(req.headers["x-forwarded-port"])
        : null,
    },
    clientIp: classifyIp(getClientIp(req)),
    proxySigns: [...signs].sort(),
    userAgent: first(req.headers["user-agent"])?.slice(0, 300) ?? null,
  };
}
