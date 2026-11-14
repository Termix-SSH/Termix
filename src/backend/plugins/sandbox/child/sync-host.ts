/**
 * ctx.sync.host inside a plugin process. Data calls go to core. What the
 * provider reads synchronously (whether this is the desktop, the version, the
 * entity list) is kept here, and calls that act on the live response run in
 * core on the request this call belongs to.
 */
import type { Endpoint } from "../rpc.js";

type AnyFn = (...args: unknown[]) => unknown;

const HOST = "sync.host"; // plugin-id-ok: ctx.sync is a core namespace

interface EntityInfo {
  type: string;
  owner: string;
  order: number;
  readOnly: boolean;
  covers?: AnyFn;
}

interface ChildResponse {
  status(code: number): { json(body: unknown): unknown };
  termixHandOff?: () => void;
}

/** The same key core uses for a sync record. */
export function recordKey(type: string, syncId: string): string {
  return `${type}\u0000${syncId}`;
}

/** A remote server error that kept its kind on the way here. */
export function isRemoteError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "SyncRemoteError" &&
    typeof (error as { kind?: unknown }).kind === "string"
  );
}

function withKind(error: unknown): unknown {
  if (error instanceof Error && error.name === "SyncRemoteError") {
    const code = (error as { code?: unknown }).code;
    Object.defineProperty(error, "kind", {
      value: typeof code === "string" ? code : "server",
      enumerable: true,
    });
  }
  return error;
}

export async function createChildSyncHost(
  endpoint: Endpoint,
  hybrid: (promise: Promise<unknown>, path: string) => AnyFn,
): Promise<Record<string, unknown>> {
  const call = (method: string, args: unknown[] = []) =>
    endpoint.call(`${HOST}.${method}`, args);
  const fire = (method: string, args: unknown[]) => {
    call(method, args).catch((error: Error) => {
      console.error(`ctx.sync.host.${method} failed: ${error.message}`);
    });
  };
  const data =
    (method: string) =>
    (...args: unknown[]) =>
      call(method, args);
  const listener = (method: string) => (fn: AnyFn) =>
    hybrid(call(method, [fn]), `${HOST}.${method}`);

  const snapshot = (await call("snapshot")) as {
    embedded: boolean;
    version: string;
    deviceName: string;
  };

  let entities: EntityInfo[] = [];
  const loadEntities = async () => {
    const list = await call("entities.list");
    if (Array.isArray(list)) entities = list as EntityInfo[];
  };
  await loadEntities();
  // Kept current, since the provider reads the list synchronously.
  call("entities.onChanged", [
    () => {
      void loadEntities().catch(() => {});
    },
  ]).catch(() => {});

  let nextResolvers = 1;
  const resolverId = (resolvers: unknown): string => {
    const id = (resolvers as { termixResolvers?: unknown })?.termixResolvers;
    if (typeof id !== "string") {
      throw new Error("Pass the value replica.resolvers() returned");
    }
    return id;
  };

  return {
    embedded: snapshot.embedded,
    info: {
      appName: data("info.appName"),
      version: () => snapshot.version,
    },
    entities: {
      list: () => [...entities],
      get: (type: string) => entities.find((entity) => entity.type === type),
      ensureCore: async () => {
        await call("entities.ensureCore");
        await loadEntities();
      },
      onChanged: listener("entities.onChanged"),
      onLocalWrite: listener("entities.onLocalWrite"),
      idsOf: data("entities.idsOf"),
    },
    replica: {
      // Core holds the resolvers; the plugin passes this marker back.
      resolvers: (userId: string, onMissing?: AnyFn) => {
        const id = `r${nextResolvers++}`;
        fire("replica.resolvers", [id, userId, onMissing]);
        return Object.freeze({ termixResolvers: id });
      },
      loadRows: (type: string, userId: string, resolvers: unknown) =>
        call("replica.loadRows", [type, userId, resolverId(resolvers)]),
      loadRow: (
        type: string,
        userId: string,
        syncId: string,
        resolvers: unknown,
      ) =>
        call("replica.loadRow", [type, userId, syncId, resolverId(resolvers)]),
      writeRow: (
        type: string,
        userId: string,
        wire: unknown,
        resolvers: unknown,
      ) =>
        call("replica.writeRow", [type, userId, wire, resolverId(resolvers)]),
      deleteRow: data("replica.deleteRow"),
      orderSelfReferences: data("replica.orderSelfReferences"),
      counts: data("replica.counts"),
      wipe: data("replica.wipe"),
      regenerateSyncIds: data("replica.regenerateSyncIds"),
      removeSharedCopies: data("replica.removeSharedCopies"),
      records: {
        list: data("replica.records.list"),
        put: data("replica.records.put"),
        setError: data("replica.records.setError"),
        clearErrors: data("replica.records.clearErrors"),
        listErrors: data("replica.records.listErrors"),
        deleteForUser: data("replica.records.deleteForUser"),
        key: recordKey,
      },
      conflicts: {
        save: data("replica.conflicts.save"),
        list: data("replica.conflicts.list"),
        get: data("replica.conflicts.get"),
        delete: data("replica.conflicts.delete"),
      },
    },
    feed: {
      withUserLock: data("feed.withUserLock"),
      changes: data("feed.changes"),
      parsePushOps: data("feed.parsePushOps"),
      applyPush: data("feed.applyPush"),
      // Core streams to the live response of the request this runs in.
      listen: async (userId: string) => {
        const drop = (await call("feed.listen", [userId])) as AnyFn;
        return () => void drop();
      },
    },
    links: {
      list: data("links.list"),
      get: data("links.get"),
      create: data("links.create"),
      update: data("links.update"),
      remove: data("links.remove"),
    },
    accounts: {
      list: data("accounts.list"),
      create: data("accounts.create"),
      setActive: data("accounts.setActive"),
      activeId: data("accounts.activeId"),
      remove: data("accounts.remove"),
    },
    http: {
      json: async (target: unknown, pathname: string, request?: unknown) => {
        const { signal, ...rest } = (request ?? {}) as {
          signal?: AbortSignal;
        };
        signal?.throwIfAborted();
        try {
          return await call("http.json", [target, pathname, rest]);
        } catch (error) {
          throw withKind(error);
        }
      },
      fetch: async (target: unknown, pathname: string, request?: unknown) => {
        const { signal, ...rest } = (request ?? {}) as {
          signal?: AbortSignal;
        };
        signal?.throwIfAborted();
        let response: {
          ok: boolean;
          status: number;
          body: (AsyncIterable<Uint8Array> & { destroy(): void }) | null;
        };
        try {
          response = (await call("http.fetch", [
            target,
            pathname,
            rest,
          ])) as typeof response;
        } catch (error) {
          throw withKind(error);
        }
        if (signal) {
          // Closing the body here closes the request in core.
          const close = () => response.body?.destroy();
          if (signal.aborted) close();
          else signal.addEventListener("abort", close, { once: true });
        }
        return response;
      },
      normalizeServerUrl: data("http.normalizeServerUrl"),
      isRemoteError,
    },
    sessions: {
      issueDesktop: data("sessions.issueDesktop"),
      revoke: data("sessions.revoke"),
      find: data("sessions.find"),
      findUser: data("sessions.findUser"),
      verify: data("sessions.verify"),
      setCookie: (
        _req: unknown,
        _res: unknown,
        value: string,
        options?: unknown,
      ) => fire("sessions.setCookie", [value, options]),
      clearCookie: (_req: unknown, _res: unknown, name?: string) =>
        fire("sessions.clearCookie", name === undefined ? [] : [name]),
      middleware:
        () =>
        async (
          req: Record<string, unknown>,
          res: ChildResponse,
          next: (error?: unknown) => void,
        ) => {
          try {
            const answer = (await call("sessions.authenticate")) as {
              answered?: boolean;
              userId?: string;
              sessionId?: string | null;
            };
            if (answer.answered) {
              res.termixHandOff?.();
              return;
            }
            req.userId = answer.userId;
            req.sessionId = answer.sessionId ?? undefined;
            next();
          } catch (error) {
            next(error);
          }
        },
      desktopOnly:
        () => (_req: unknown, res: ChildResponse, next: () => void) => {
          if (!snapshot.embedded) {
            res.status(404).json({ error: "Not found" });
            return;
          }
          next();
        },
    },
    hosts: {
      findForSync: data("hosts.findForSync"),
      statusBySyncId: data("hosts.statusBySyncId"),
    },
    plugins: {
      listForDesktop: data("plugins.listForDesktop"),
      sendPackage: async (pluginId: string, res: ChildResponse) => {
        const sent = (await call("plugins.sendPackage", [pluginId])) === true;
        // Core answered on the live response.
        if (sent) res.termixHandOff?.();
        return sent;
      },
      mirror: data("plugins.mirror"),
      lastRemote: data("plugins.lastRemote"),
      localNames: data("plugins.localNames"),
    },
    desktop: {
      applyProxy: data("desktop.applyProxy"),
      deviceName: () => snapshot.deviceName,
      connectionOrigin: data("desktop.connectionOrigin"),
    },
    alerts: {
      send: data("alerts.send"), // plugin-id-ok: the sync host's own alerts call
    },
  };
}
