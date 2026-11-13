/**
 * Login methods and keyboard-interactive handlers that live in a plugin
 * process. The live request and response stay in core: a method gets a plain
 * copy of the request (its own cookies only) and hands back its answer plus
 * the cookies it wants set, which core checks and applies.
 */
import type { Request } from "express";
import {
  LoginMethodError,
  type PluginKeyboardInteractiveHandler,
  type PluginLoginMethod,
  type PluginVerifiedIdentity,
} from "@termix-ssh/plugin-sdk/backend";
import { plainRound, readDetection } from "./ssh-auth-bridge.js";

type AnyFn = (...args: unknown[]) => unknown;

const MAX_COOKIES = 10;
const MAX_COOKIE_VALUE = 4096;
const MAX_COOKIE_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = /^[A-Za-z0-9_-]+$/;
const SAME_SITE = new Set(["lax", "strict", "none"]);

export interface LoginBridgeDeps {
  /** Cookies a plugin may set and read start with this. */
  cookiePrefix: string;
  /** The request headers the plugin may see. */
  headers: (req: Request) => Record<string, unknown>;
  baseUrl: (req: Request) => string;
  /** Host record as the plugin may see it. */
  visibleHost: (host: unknown) => Promise<unknown>;
}

export class LoginBridgeError extends Error {
  readonly code = "SANDBOX_VALUE";
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

function plainCopy(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (Array.isArray(value)) return value.map((v) => plainCopy(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = plainCopy(item, depth + 1);
    }
    return out;
  }
  return value;
}

/** What a login method in a plugin process sees of a request. */
export function plainLoginRequest(
  req: Request,
  deps: LoginBridgeDeps,
): Record<string, unknown> {
  return {
    body: isPlain(req.body) ? plainCopy(req.body) : {},
    query: plainCopy(req.query ?? {}),
    headers: deps.headers(req),
    ip: req.ip,
    termixBaseUrl: deps.baseUrl(req),
  };
}

interface CookieDirective {
  name: string;
  value: string;
  clear: boolean;
  options: Record<string, unknown>;
}

function cookieOptions(raw: unknown): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (!isPlain(raw)) return options;
  if (typeof raw.httpOnly === "boolean") options.httpOnly = raw.httpOnly;
  if (typeof raw.secure === "boolean") options.secure = raw.secure;
  if (typeof raw.sameSite === "string" && SAME_SITE.has(raw.sameSite)) {
    options.sameSite = raw.sameSite;
  }
  if (
    typeof raw.path === "string" &&
    raw.path.startsWith("/") &&
    raw.path.length <= 512 &&
    !/[;\s]/.test(raw.path)
  ) {
    options.path = raw.path;
  }
  if (typeof raw.maxAge === "number" && Number.isFinite(raw.maxAge)) {
    options.maxAge = Math.max(0, Math.min(raw.maxAge, MAX_COOKIE_AGE_MS));
  }
  return options;
}

/**
 * The cookies a plugin asked for, cut to its own names. Domain is never
 * passed on, so a cookie stays on this host.
 */
export function readCookieDirectives(
  raw: unknown,
  prefix: string,
): CookieDirective[] {
  if (!Array.isArray(raw)) return [];
  const out: CookieDirective[] = [];
  for (const item of raw.slice(0, MAX_COOKIES)) {
    if (!isPlain(item)) continue;
    const name = item.name;
    if (
      typeof name !== "string" ||
      !name.startsWith(prefix) ||
      name.length > 128 ||
      !COOKIE_NAME.test(name)
    ) {
      continue;
    }
    const clear = item.clear === true;
    const value = clear ? "" : item.value;
    if (typeof value !== "string" || value.length > MAX_COOKIE_VALUE) continue;
    out.push({ name, value, clear, options: cookieOptions(item.options) });
  }
  return out;
}

interface CookieResponse {
  cookie?: (name: string, value: string, options: object) => unknown;
  clearCookie?: (name: string, options: object) => unknown;
  headersSent?: boolean;
}

export function applyCookieDirectives(
  req: Request,
  directives: CookieDirective[],
): void {
  const res = (req as Request & { res?: CookieResponse }).res;
  if (!res || res.headersSent) return;
  for (const directive of directives) {
    if (directive.clear) res.clearCookie?.(directive.name, directive.options);
    else res.cookie?.(directive.name, directive.value, directive.options);
  }
}

/** A login error from a plugin process, as the error core answers with. */
export function readLoginError(raw: unknown): LoginMethodError {
  const value = isPlain(raw) ? raw : {};
  const status = Number(value.status);
  const error = new LoginMethodError(
    text(value.message, 500) || "Login failed",
    Number.isInteger(status) && status >= 400 && status <= 599 ? status : 400,
    text(value.code, 100),
  );
  const returnTo = text(value.returnTo, 2048);
  if (returnTo) Object.assign(error, { returnTo });
  const remainingTime = Number(value.remainingTime);
  if (Number.isFinite(remainingTime) && remainingTime >= 0) {
    Object.assign(error, { remainingTime });
  }
  return error;
}

function stringList(value: unknown, max = 200): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is string => typeof item === "string")
    .slice(0, max)
    .map((item) => item.slice(0, 255));
}

/** An identity from a plugin process, rebuilt field by field. */
export function readIdentity(raw: unknown): PluginVerifiedIdentity {
  if (!isPlain(raw)) throw new LoginBridgeError("A login gave no identity");
  const shared = {
    ...(typeof raw.mfaSatisfied === "boolean"
      ? { mfaSatisfied: raw.mfaSatisfied }
      : {}),
    ...(typeof raw.returnTo === "string"
      ? { returnTo: raw.returnTo.slice(0, 2048) }
      : {}),
    ...(typeof raw.rememberMe === "boolean"
      ? { rememberMe: raw.rememberMe }
      : {}),
  };
  if (raw.kind === "user") {
    if (typeof raw.userId !== "string" || !raw.userId) {
      throw new LoginBridgeError("A login gave no user");
    }
    return {
      kind: "user",
      userId: raw.userId,
      ...(typeof raw.password === "string" ? { password: raw.password } : {}),
      ...shared,
    };
  }
  if (raw.kind !== "external") {
    throw new LoginBridgeError("A login gave an unknown identity");
  }
  if (typeof raw.provider !== "string" || typeof raw.subject !== "string") {
    throw new LoginBridgeError(
      "An external identity needs provider and subject",
    );
  }
  const roles = isPlain(raw.roles)
    ? {
        desired: stringList(raw.roles.desired) ?? [],
        managed: stringList(raw.roles.managed) ?? [],
      }
    : undefined;
  const claims = isPlain(raw.logoutClaims) ? raw.logoutClaims : null;
  const legacy = isPlain(raw.legacy) ? raw.legacy : null;
  const nullableText = (value: unknown, max: number) =>
    value === null ? null : text(value, max);
  return {
    kind: "external",
    provider: raw.provider.slice(0, 255),
    subject: raw.subject.slice(0, 255),
    ...(raw.email !== undefined ? { email: nullableText(raw.email, 320) } : {}),
    ...(raw.name !== undefined ? { name: nullableText(raw.name, 255) } : {}),
    ...(stringList(raw.groups) ? { groups: stringList(raw.groups) } : {}),
    ...(typeof raw.isAdmin === "boolean" ? { isAdmin: raw.isAdmin } : {}),
    ...(raw.allowedUsers !== undefined
      ? { allowedUsers: nullableText(raw.allowedUsers, 65536) }
      : {}),
    ...(roles ? { roles } : {}),
    ...(claims
      ? {
          logoutClaims: {
            providerId:
              typeof claims.providerId === "number" ? claims.providerId : null,
            sub: nullableText(claims.sub, 255) ?? null,
            sid: nullableText(claims.sid, 255) ?? null,
          },
        }
      : {}),
    ...(legacy && typeof legacy.identifier === "string"
      ? {
          legacy: {
            identifier: legacy.identifier.slice(0, 255),
            providerRowId:
              typeof legacy.providerRowId === "number"
                ? legacy.providerRowId
                : null,
          },
        }
      : {}),
    ...(typeof raw.rateLimitKey === "string"
      ? { rateLimitKey: raw.rateLimitKey.slice(0, 255) }
      : {}),
    ...shared,
  };
}

interface RemoteAnswer {
  value?: unknown;
  error?: unknown;
  cookies?: unknown;
}

/**
 * Builds the login method core registers for one a plugin process sent. Its
 * functions are calls into that process.
 */
export function remoteLoginMethod(
  raw: Record<string, unknown>,
  deps: LoginBridgeDeps,
): PluginLoginMethod {
  if (typeof raw.id !== "string" || typeof raw.labelKey !== "string") {
    throw new LoginBridgeError("A login method needs id and labelKey");
  }
  if (raw.kind !== "redirect" && raw.kind !== "form") {
    throw new LoginBridgeError("A login method's kind is redirect or form");
  }

  const run = async (fn: AnyFn, req: Request, ...rest: unknown[]) => {
    const answer = (await fn(plainLoginRequest(req, deps), ...rest)) as
      RemoteAnswer | undefined;
    applyCookieDirectives(
      req,
      readCookieDirectives(answer?.cookies, deps.cookiePrefix),
    );
    if (answer?.error !== undefined) throw readLoginError(answer.error);
    return answer?.value;
  };
  const instanceArg = (value: unknown) =>
    typeof value === "string" ? value.slice(0, 255) : null;

  const method: PluginLoginMethod = {
    id: raw.id,
    labelKey: raw.labelKey,
    kind: raw.kind,
    ...(typeof raw.icon === "string" ? { icon: raw.icon } : {}),
    ...(typeof raw.external === "boolean" ? { external: raw.external } : {}),
  };

  if (typeof raw.describe === "function") {
    const describe = raw.describe as AnyFn;
    method.describe = async () => {
      const list = await describe();
      if (!Array.isArray(list)) return [];
      return list.filter(isPlain).map((item) => ({
        id: String(item.id ?? "").slice(0, 255),
        label: String(item.label ?? "").slice(0, 255),
        enabled: item.enabled === true,
        ...(typeof item.type === "string"
          ? { type: item.type.slice(0, 50) }
          : {}),
        ...(item.autoStart === true ? { autoStart: true } : {}),
      }));
    };
  }

  if (typeof raw.start === "function") {
    const start = raw.start as AnyFn;
    method.start = async (request, instanceId) => {
      const value = await run(
        start,
        request as unknown as Request,
        instanceArg(instanceId),
      );
      const redirectUrl = isPlain(value) ? value.redirectUrl : undefined;
      if (
        typeof redirectUrl !== "string" ||
        !/^https?:\/\//i.test(redirectUrl)
      ) {
        throw new LoginBridgeError("A redirect login gave no http(s) URL");
      }
      return { redirectUrl };
    };
  }

  if (typeof raw.callback === "function") {
    const callback = raw.callback as AnyFn;
    method.callback = async (request) =>
      readIdentity(await run(callback, request as unknown as Request));
  }

  if (typeof raw.verify === "function") {
    const verify = raw.verify as AnyFn;
    method.verify = async (request, instanceId) =>
      readIdentity(
        await run(
          verify,
          request as unknown as Request,
          instanceArg(instanceId),
        ),
      );
  }

  return method;
}

function plainSettings(value: unknown): Record<string, unknown> {
  if (!isPlain(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      out[key] = item;
    }
  }
  return out;
}

/** A keyboard-interactive handler whose hooks are calls into a plugin process. */
export function remoteKeyboardInteractiveHandler(
  raw: Record<string, unknown>,
  deps: Pick<LoginBridgeDeps, "visibleHost">,
): PluginKeyboardInteractiveHandler & { remote: true } {
  if (typeof raw.id !== "string" || typeof raw.label !== "string") {
    throw new LoginBridgeError(
      "A keyboard-interactive handler needs id and label",
    );
  }
  if (typeof raw.detect !== "function") {
    throw new LoginBridgeError("A keyboard-interactive handler needs detect");
  }
  const detect = raw.detect as AnyFn;
  const handler: PluginKeyboardInteractiveHandler & { remote: true } = {
    id: raw.id,
    label: raw.label.slice(0, 100),
    remote: true,
    detect: async (round, host, settings) =>
      readDetection(
        await detect(
          plainRound(round),
          await deps.visibleHost(host),
          plainSettings(settings),
        ),
      ) as never,
  };
  if (typeof raw.autoAnswerPasswords === "function") {
    const auto = raw.autoAnswerPasswords as AnyFn;
    handler.autoAnswerPasswords = async (host, settings) =>
      (await auto(await deps.visibleHost(host), plainSettings(settings))) ===
      true;
  }
  return handler;
}
