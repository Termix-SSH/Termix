/**
 * How a plugin frontend reaches its own backend.
 *
 * Every plugin serves HTTP under /plugin-api/<id>/ and WebSockets under
 * /plugin-ws/<id>/<path> on the main backend. No plugin has a port of its own,
 * so these two helpers are all a plugin frontend needs, in every deployment:
 *
 *   - web, same origin, optionally under a base path;
 *   - Docker behind nginx, which proxies both prefixes;
 *   - the Vite dev server, which proxies through /__termix_api/30001;
 *   - Electron with its embedded local backend;
 *   - Electron pointed at a remote Termix server, for hosts whose connection
 *     origin resolves there.
 *
 * A7 re-exports both through @termix/plugin-sdk/frontend. They live here for
 * now because plugin frontends are still bundled with the shell.
 */

import type { AxiosInstance } from "axios";
import { authApi } from "@/main-axios";
import { getBasePath } from "@/lib/base-path";
import { isElectron } from "@/lib/electron";
import { websocketAuthProtocols } from "@/lib/ws-auth";
import {
  buildOriginWsUrl,
  type ConnectionOrigin,
  type WebSocketConnectionTarget,
} from "@/lib/connection-origin";

/** The backend port. Everything plugin-facing rides the main server. */
const BACKEND_PORT = 30001;

export function pluginApiPath(pluginId: string, path = ""): string {
  const suffix = path && !path.startsWith("/") ? `/${path}` : path;
  return `/plugin-api/${pluginId}${suffix}`;
}

/**
 * An axios client rooted at this plugin's /plugin-api mount point.
 *
 * Built on the shared authenticated instance, so a plugin inherits the same
 * interceptors as core: auth headers, session expiry handling and error
 * reporting all behave identically.
 */
export function createPluginApi(pluginId: string): AxiosInstance {
  const prefix = pluginApiPath(pluginId);

  // A thin proxy rather than a new axios instance: the shared one resolves its
  // baseURL per deployment already, and duplicating that here is how the two
  // drift apart.
  return new Proxy(authApi, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;

      if (
        property === "get" ||
        property === "delete" ||
        property === "head" ||
        property === "options" ||
        property === "post" ||
        property === "put" ||
        property === "patch"
      ) {
        return (url: string, ...rest: unknown[]) =>
          (value as (...args: unknown[]) => unknown).call(
            target,
            `${prefix}${url.startsWith("/") ? url : `/${url}`}`,
            ...rest,
          );
      }

      return value.bind(target);
    },
  }) as AxiosInstance;
}

/**
 * The WebSocket URL for /plugin-ws/<id>/<path>, plus the subprotocols that
 * carry the JWT.
 *
 * In Electron the right backend depends on where the host actually lives, so
 * pass the resolved origin; without one it targets the embedded local backend,
 * which is what a plugin with no per-host notion of origin wants.
 */
export async function pluginWsUrl(
  pluginId: string,
  path: string,
  options: { origin?: ConnectionOrigin } = {},
): Promise<WebSocketConnectionTarget | null> {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const route = `/plugin-ws/${pluginId}${suffix}`;

  if (isElectron()) {
    return buildOriginWsUrl({
      origin: options.origin ?? "local",
      localPort: BACKEND_PORT,
      localPath: route,
      remotePath: route,
    });
  }

  const token = localStorage.getItem("jwt");
  const protocols = websocketAuthProtocols(token);

  // Dev without a configured API host goes through Vite's proxy, which is
  // reached on the page's own origin rather than the backend port.
  const devProxy =
    process.env.NODE_ENV === "development" &&
    !import.meta.env.VITE_API_HOST &&
    (window.location.port === "3000" || window.location.port === "5173");

  const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";

  if (devProxy) {
    return {
      url: `${wsProtocol}://${window.location.host}/__termix_api/${BACKEND_PORT}${route}`,
      protocols,
    };
  }

  return {
    url: `${wsProtocol}://${window.location.host}${getBasePath()}${route}`,
    protocols,
  };
}
