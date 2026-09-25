/**
 * HTTP for plugins: one mount point, one set of middleware, no ports.
 *
 * A plugin calls ctx.http.router() and gets an Express Router that core mounts
 * at /plugin-api/<id>/. Everything a route needs in front of it runs here
 * rather than in the plugin:
 *
 *   1. auth, unless the path was declared public;
 *   2. the actor, so ctx and core APIs know who is calling;
 *   3. an enabled check, so a disabled plugin answers 503 rather than 404;
 *   4. body limits;
 *   5. an error wrapper that logs against the plugin and leaks nothing.
 *
 * The wrapper never touches the response body, so SSE, file downloads and
 * multipart uploads stream through untouched.
 */

import express, {
  type NextFunction,
  type Request,
  type Response,
  type Router,
} from "express";
import type {
  PluginMiddleware,
  PluginRouterOptions,
} from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { pluginLogger } from "../utils/logger.js";
import { AuthManager } from "../utils/auth-manager.js";
import { runAsActor } from "./actor.js";
import { hasCapability } from "./permissions.js";
import { declaredPermissions, resolvePermission } from "./rbac.js";

/** Matches what core's own routes accept, so moving a route changes nothing. */
const DEFAULT_BODY_LIMIT = "2mb";

/** Routers by plugin id, read by the dispatcher in plugin-api-routes.ts. */
const routers = new Map<string, Router>();

export function getPluginRouter(pluginId: string): Router | undefined {
  return routers.get(pluginId);
}

export function getRegisteredHttpPluginIds(): string[] {
  return [...routers.keys()];
}

export function unregisterPluginHttp(pluginId: string): void {
  if (!routers.delete(pluginId)) return;
  pluginLogger.info(`Unmounted /plugin-api/${pluginId}`, {
    operation: "plugin_http_unmount",
  });
}

/**
 * Whether the plugin is currently running.
 *
 * Injected rather than imported so this module does not depend on the loader,
 * which imports ctx.ts, which would close a cycle.
 */
type IsEnabled = (pluginId: string) => boolean;

let isPluginEnabled: IsEnabled = () => true;

export function setPluginEnabledCheck(check: IsEnabled): void {
  isPluginEnabled = check;
}

/** Test seam, so one test's stub does not leak into the next. */
export function resetPluginHttp(): void {
  routers.clear();
  isPluginEnabled = () => true;
}

function normalizePublicPath(path: string): string {
  const trimmed = path.trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.length > 1 && withSlash.endsWith("/")
    ? withSlash.slice(0, -1)
    : withSlash;
}

/**
 * Compiles a declared public path into a matcher.
 *
 * Express-style ":param" segments are supported, because the routes that have
 * to be public are usually keyed by a token ("/webhook/:token"). A parameter
 * matches exactly one segment and never a slash, so ":token" cannot swallow
 * the rest of the path and turn one declared route into a prefix hole.
 *
 * A trailing "/*" is the one deliberate prefix: it matches the path itself and
 * anything below it, for a proxied page that loads its own subpaths.
 */
function compilePublicPath(path: string): RegExp {
  const prefix = path.endsWith("/*");
  const escaped = (prefix ? path.slice(0, -2) : path)
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) return "[^/]+";
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(prefix ? `^${escaped}(?:/.*)?$` : `^${escaped}$`);
}

/**
 * Matches the request path against the declared public paths.
 *
 * Full-path match only. A prefix match would turn one declared route into a
 * hole covering everything below it, which is not what declaring a single
 * public path should mean.
 */
function isPublicRequest(req: Request, publicPaths: RegExp[]): boolean {
  if (publicPaths.length === 0) return false;
  const path = normalizePublicPath(req.path || "/");
  return publicPaths.some((pattern) => pattern.test(path));
}

export interface CreatePluginRouterArgs {
  manifest: PluginManifest;
  options?: PluginRouterOptions;
  /** Records a runtime error against the plugin's error budget. */
  reportError: (error: unknown) => void;
}

export function createPluginRouter({
  manifest,
  options,
  reportError,
}: CreatePluginRouterArgs): Router {
  const pluginId = manifest.id;
  const declaredPublic = (options?.public ?? []).map((path) =>
    normalizePublicPath(path),
  );
  const publicPaths = declaredPublic.map((path) => compilePublicPath(path));

  if (declaredPublic.length > 0) {
    // Audited once at registration: the set of unauthenticated routes a plugin
    // has is worth seeing even if nobody ever calls them.
    pluginLogger.warn(
      `Plugin ${pluginId} serves ${declaredPublic.length} route(s) without authentication: ${declaredPublic.join(", ")}`,
      { operation: "plugin_http_public" },
    );
    void writePublicRouteAudit(manifest, declaredPublic);
  }

  const outer = express.Router();
  const inner = express.Router();

  outer.use((req: Request, res: Response, next: NextFunction) => {
    if (isPluginEnabled(pluginId)) {
      next();
      return;
    }
    res.status(503).json({ error: "Plugin is not running", pluginId });
  });

  // The grant lives in the database, so it cannot be checked in the
  // synchronous router() call a plugin makes inside activate. Checked per
  // request instead: a plugin whose network:serve was revoked keeps its mount
  // point and refuses every request through it, which is the same outcome a
  // revoke should have and takes effect without a restart.
  outer.use((req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const granted = await hasCapability(
          pluginId,
          "network:serve",
          manifest.capabilities,
        );
        if (!granted) {
          res.status(403).json({
            error: "Plugin is not granted the network:serve capability",
            pluginId,
          });
          return;
        }
        next();
      } catch (error) {
        next(error);
      }
    })();
  });

  const authenticate = AuthManager.getInstance().createAuthMiddleware();

  outer.use((req: Request, res: Response, next: NextFunction) => {
    if (isPublicRequest(req, publicPaths)) {
      pluginLogger.info(`Unauthenticated request to ${pluginId}${req.path}`, {
        operation: "plugin_http_public_request",
      });
      next();
      return;
    }
    authenticate(req, res, next);
  });

  if (!options?.rawBody) {
    const limit = options?.bodyLimit ?? DEFAULT_BODY_LIMIT;
    // Both parsers ignore a body they do not claim, so multipart still reaches
    // multer untouched. database.ts skips its own global parser for
    // /plugin-api so this limit is the one that actually applies.
    outer.use(express.json({ limit }));
    outer.use(express.urlencoded({ limit, extended: true }));
  }

  // After auth, so the actor is the user core authenticated rather than
  // whatever the request claimed.
  outer.use((req: Request, _res: Response, next: NextFunction) => {
    const { userId, sessionId } = req as Request & {
      userId?: string;
      sessionId?: string;
    };
    if (!userId) {
      next();
      return;
    }
    runAsActor(userId, "request", () => next(), sessionId);
  });

  outer.use(inner);

  outer.use(
    (
      error: unknown,
      req: Request,
      res: Response,
      _next: NextFunction,
    ): void => {
      void _next;
      reportError(error);
      pluginLogger.error(
        `Plugin ${pluginId} route ${req.method} ${req.path} failed`,
        error instanceof Error ? error : new Error(String(error)),
        { operation: "plugin_http_error" },
      );
      if (res.headersSent) {
        // Mid-stream: the only honest thing left is to end it.
        res.end();
        return;
      }
      res.status(500).json({ error: "Plugin request failed" });
    },
  );

  routers.set(pluginId, outer);
  pluginLogger.info(`Mounted /plugin-api/${pluginId}`, {
    operation: "plugin_http_mount",
  });

  return inner;
}

async function writePublicRouteAudit(
  manifest: PluginManifest,
  paths: string[],
): Promise<void> {
  try {
    const { logAudit } = await import("../utils/audit-logger.js");
    await logAudit({
      userId: "system",
      username: `plugin:${manifest.id}`,
      action: "plugin_http_public_routes",
      resourceType: "plugin",
      resourceId: manifest.id,
      resourceName: manifest.name,
      details: `unauthenticated routes: ${paths.join(", ")}`,
      success: true,
    });
  } catch {
    // Auditing must never stop a plugin starting.
  }
}

/**
 * Builds ctx.rbac.require.
 *
 * A plugin may only gate on a permission it declares itself. Without that a
 * route could require admin.users.manage and borrow someone else's authority,
 * which is the escalation shape the manifest validator already blocks for
 * role defaults.
 *
 * The 401/403 bodies match requirePermission(), so a plugin route denies the
 * same way a core route does and a client needs one code path.
 */
export function createRbacMiddleware(
  manifest: PluginManifest,
  permission: string,
): PluginMiddleware {
  const required = resolvePermission(manifest, permission);
  const declared = declaredPermissions(manifest);

  if (!declared.has(required)) {
    throw new Error(
      `Plugin ${manifest.id} cannot require permission "${permission}": it is not declared in contributes.permissions`,
    );
  }

  return ((req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const userId = (req as Request & { userId?: string }).userId;
      if (!userId) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      try {
        const { PermissionManager } =
          await import("../utils/permission-manager.js");
        const allowed = await PermissionManager.getInstance().hasPermission(
          userId,
          required,
        );
        if (!allowed) {
          res.status(403).json({ error: "Insufficient permissions", required });
          return;
        }
        next();
      } catch (error) {
        next(error);
      }
    })();
  }) as unknown as PluginMiddleware;
}
