/**
 * The sync provider (ctx.sync.provide and ctx.sync.host) for a plugin
 * process. Plain data calls go to the real sync host. Calls that need the live
 * HTTP response (sign in cookies, the change feed, plugin packages, the auth
 * middleware) only work inside one of the plugin's own requests, by the token
 * core minted for it, and run on that request in core.
 */
import { Readable } from "node:stream";
import type { NextFunction, Request, Response } from "express";
import type { PluginSyncHost } from "@termix-ssh/plugin-sdk/backend";
import type { Endpoint, StreamPort } from "./rpc.js";

type AnyFn = (...args: unknown[]) => unknown;

const HOST = "sync.host"; // plugin-id-ok: ctx.sync is a core namespace
const PROVIDE = "sync.provide"; // plugin-id-ok: ctx.sync is a core namespace

export interface LiveRequest {
  req: Request;
  res: Response;
  handedOff: boolean;
}

export interface SyncBridgeDeps {
  endpoint: Endpoint;
  host: () => PluginSyncHost;
  live: (token: string | undefined) => LiveRequest | undefined;
  provide: (
    handle: (req: Request, res: Response, next: NextFunction) => void,
  ) => () => void;
  dispatch: (req: Request, res: Response, next: NextFunction) => void;
  cookiePrefix: string;
}

export class SyncBridgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** sync.host paths answered by the real host as they are. */
export const SYNC_HOST_DATA_PATHS = [
  "info.appName",
  "entities.list",
  "entities.get",
  "entities.ensureCore",
  "entities.onChanged",
  "entities.onLocalWrite",
  "entities.idsOf",
  "replica.deleteRow",
  "replica.orderSelfReferences",
  "replica.counts",
  "replica.wipe",
  "replica.regenerateSyncIds",
  "replica.removeSharedCopies",
  "replica.records.list",
  "replica.records.put",
  "replica.records.setError",
  "replica.records.clearErrors",
  "replica.records.listErrors",
  "replica.records.deleteForUser",
  "replica.conflicts.save",
  "replica.conflicts.list",
  "replica.conflicts.get",
  "replica.conflicts.delete",
  "feed.withUserLock",
  "feed.changes",
  "feed.parsePushOps",
  "feed.applyPush",
  "links.list",
  "links.get",
  "links.create",
  "links.update",
  "links.remove",
  "accounts.list",
  "accounts.create",
  "accounts.setActive",
  "accounts.activeId",
  "accounts.remove",
  "http.normalizeServerUrl",
  "sessions.issueDesktop",
  "sessions.revoke",
  "sessions.find",
  "sessions.findUser",
  "sessions.verify",
  "hosts.findForSync",
  "hosts.statusBySyncId",
  "plugins.listForDesktop",
  "plugins.mirror",
  "plugins.lastRemote",
  "plugins.localNames",
  "desktop.applyProxy",
  "desktop.connectionOrigin",
  "alerts.send", // plugin-id-ok: the sync host's own alerts call
] as const;

/** Resolvers a sync run holds; the oldest go first past this. */
const MAX_RESOLVERS = 256;
const COOKIE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const SESSION_COOKIE = "jwt";

function at(target: unknown, dotted: string): { fn: AnyFn; self: unknown } {
  let self: unknown = undefined;
  let value: unknown = target;
  for (const part of dotted.split(".")) {
    if (!value || typeof value !== "object") break;
    self = value;
    value = (value as Record<string, unknown>)[part];
  }
  if (typeof value !== "function") {
    throw new SyncBridgeError(
      `${HOST}.${dotted} is not available on this server`,
      "SANDBOX_UNSUPPORTED",
      501,
    );
  }
  return { fn: value as AnyFn, self };
}

/** Request options without the parts that can't cross (an AbortSignal). */
function plainRequest(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const { signal: _signal, ...rest } = value as Record<string, unknown>;
  return rest;
}

/** A remote server error keeps its kind on the way to the plugin. */
function remoteFailure(host: PluginSyncHost, error: unknown): unknown {
  if (!host.http.isRemoteError(error)) return error;
  const out = new Error(error.message) as Error & {
    code?: string;
    status?: number;
  };
  out.name = "SyncRemoteError";
  out.code = error.kind;
  if (typeof error.status === "number") out.status = error.status;
  return out;
}

export function installSyncBridge(deps: SyncBridgeDeps): void {
  const { endpoint } = deps;
  const resolvers = new Map<string, unknown>();
  const handle = (
    method: string,
    fn: (args: unknown[], token?: string) => unknown,
  ) => endpoint.handle(`${HOST}.${method}`, (args, token) => fn(args, token));

  const liveFor = (token: string | undefined, what: string): LiveRequest => {
    const live = deps.live(token);
    if (!live || live.handedOff) {
      throw new SyncBridgeError(
        `${HOST}.${what} works only inside one of the plugin's own requests`,
        "SANDBOX_UNSUPPORTED",
      );
    }
    return live;
  };
  const resolverOf = (id: unknown): unknown => {
    const found = resolvers.get(String(id));
    if (!found) {
      throw new SyncBridgeError(
        "Those resolvers are gone",
        "SANDBOX_HANDLE",
        410,
      );
    }
    return found;
  };

  endpoint.handle(PROVIDE, () =>
    deps.provide((req, res, next) => deps.dispatch(req, res, next)),
  );

  // Values the plugin reads synchronously, sent once at start.
  endpoint.handle(`${HOST}.snapshot`, () => {
    const host = deps.host();
    return {
      embedded: host.embedded,
      version: host.info.version(),
      deviceName: host.desktop.deviceName(),
    };
  });

  for (const dotted of SYNC_HOST_DATA_PATHS) {
    handle(dotted, async (args) => {
      const host = deps.host();
      const { fn, self } = at(host, dotted);
      return fn.apply(self, args);
    });
  }

  handle("replica.resolvers", ([id, userId, onMissing]) => {
    const key = String(id);
    if (!/^r\d{1,12}$/.test(key)) {
      throw new SyncBridgeError("Bad resolvers id", "SANDBOX_VALUE");
    }
    resolvers.delete(key);
    resolvers.set(
      key,
      deps
        .host()
        .replica.resolvers(
          String(userId),
          typeof onMissing === "function"
            ? (onMissing as () => void)
            : undefined,
        ),
    );
    while (resolvers.size > MAX_RESOLVERS) {
      resolvers.delete(resolvers.keys().next().value as string);
    }
    return true;
  });
  handle("replica.loadRows", ([type, userId, id]) =>
    deps.host().replica.loadRows(String(type), String(userId), resolverOf(id)),
  );
  handle("replica.loadRow", ([type, userId, syncId, id]) =>
    deps
      .host()
      .replica.loadRow(
        String(type),
        String(userId),
        String(syncId),
        resolverOf(id),
      ),
  );
  handle("replica.writeRow", ([type, userId, wire, id]) =>
    deps
      .host()
      .replica.writeRow(
        String(type),
        String(userId),
        wire as never,
        resolverOf(id),
      ),
  );

  handle("http.json", async ([target, pathname, request]) => {
    const host = deps.host();
    try {
      return await host.http.json(
        target as never,
        String(pathname),
        plainRequest(request),
      );
    } catch (error) {
      throw remoteFailure(host, error);
    }
  });
  // The body comes back as a stream; closing it on either side ends the fetch.
  handle("http.fetch", async ([target, pathname, request]) => {
    const host = deps.host();
    const controller = new AbortController();
    let response: Awaited<ReturnType<PluginSyncHost["http"]["fetch"]>>;
    try {
      response = await host.http.fetch(target as never, String(pathname), {
        ...plainRequest(request),
        signal: controller.signal,
      });
    } catch (error) {
      throw remoteFailure(host, error);
    }
    let body: StreamPort | null = null;
    if (response.body) {
      const port = endpoint.openStream();
      body = port;
      const source = Readable.from(response.body as AsyncIterable<Uint8Array>);
      source.on("data", (chunk: Uint8Array) => {
        if (!port.write(chunk)) {
          source.pause();
          port.once("drain", () => source.resume());
        }
      });
      source.on("end", () => port.end());
      source.on("error", () => port.destroy());
      port.on("close", () => {
        controller.abort();
        source.destroy();
      });
    }
    return { ok: response.ok, status: response.status, body };
  });

  // Live response calls.
  handle("sessions.setCookie", ([value, options], token) => {
    const live = liveFor(token, "sessions.setCookie");
    const opts = (options ?? {}) as { name?: unknown; days?: unknown };
    const name = opts.name === undefined ? SESSION_COOKIE : String(opts.name);
    if (
      !COOKIE_NAME.test(name) ||
      (name !== SESSION_COOKIE && !name.startsWith(deps.cookiePrefix))
    ) {
      throw new SyncBridgeError(
        `A sync provider may only set the session cookie or cookies starting with ${deps.cookiePrefix}`,
        "SANDBOX_VALUE",
      );
    }
    const days = Number(opts.days ?? 30);
    deps.host().sessions.setCookie(live.req, live.res, String(value), {
      name,
      days: Number.isFinite(days) && days > 0 ? Math.min(days, 400) : 30,
    });
    return true;
  });
  handle("sessions.clearCookie", ([name], token) => {
    const live = liveFor(token, "sessions.clearCookie");
    const cookie = name === undefined ? SESSION_COOKIE : String(name);
    if (
      !COOKIE_NAME.test(cookie) ||
      (cookie !== SESSION_COOKIE && !cookie.startsWith(deps.cookiePrefix))
    ) {
      throw new SyncBridgeError(
        "That cookie is not the plugin's",
        "SANDBOX_VALUE",
      );
    }
    deps.host().sessions.clearCookie(live.req, live.res, cookie);
    return true;
  });
  // Runs core's real sign in check on the request. Either it lets the request
  // through with the user and session, or it already answered (a 401 that
  // also clears a dead cookie) and the plugin's handler stops.
  handle("sessions.authenticate", async (_args, token) => {
    const live = liveFor(token, "sessions.authenticate");
    const middleware = deps.host().sessions.middleware() as (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => unknown;
    let passed = false;
    await middleware(live.req, live.res, () => {
      passed = true;
    });
    if (!passed) {
      live.handedOff = true;
      return { answered: true };
    }
    const req = live.req as Request & { userId?: string; sessionId?: string };
    return { userId: req.userId ?? "", sessionId: req.sessionId ?? null };
  });
  handle("feed.listen", async ([userId], token) => {
    const live = liveFor(token, "feed.listen");
    const feed = deps.host().feed;
    const subscribe = feed.listen;
    const remove = await subscribe.call(feed, String(userId), live.res);
    let removed = false;
    const drop = () => {
      if (removed) return;
      removed = true;
      remove();
    };
    live.res.on("close", drop);
    return drop;
  });
  handle("plugins.sendPackage", async ([pluginId], token) => {
    const live = liveFor(token, "plugins.sendPackage");
    if (live.res.headersSent) {
      throw new SyncBridgeError(
        "The response already started",
        "SANDBOX_VALUE",
      );
    }
    const sent = await deps
      .host()
      .plugins.sendPackage(String(pluginId), live.res);
    if (sent) live.handedOff = true;
    return sent;
  });
}
