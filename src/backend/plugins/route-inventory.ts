/**
 * Lists every plugin route and socket the server serves right now. Used by the
 * authorization matrix (scripts/authz) to find routes its table is missing, so
 * it is only written when TERMIX_ROUTE_INVENTORY_FILE is set.
 */

import fs from "node:fs";
import type { Router } from "express";
import { listRouterIds, getPluginRouter } from "./http.js";
import { listWsRoutes } from "./ws.js";

export interface InventoryRoute {
  method: string;
  path: string;
  /** Set when a nested router hides the full path. */
  partial?: boolean;
}

interface Layer {
  route?: { path: string | string[]; methods: Record<string, boolean> };
  // A nested Router has a stack; a nested express() app keeps it on router.
  handle?: { stack?: Layer[]; router?: { stack?: Layer[] } };
  slash?: boolean;
}

function walk(
  stack: Layer[],
  prefix: string,
  out: InventoryRoute[],
  partial: boolean,
): void {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path)
        ? layer.route.path
        : [layer.route.path];
      for (const path of paths) {
        for (const [method, on] of Object.entries(layer.route.methods)) {
          if (!on || method === "_all") continue;
          out.push({
            method: method.toUpperCase(),
            path: `${prefix}${path === "/" ? "" : path}` || prefix,
            ...(partial ? { partial: true } : {}),
          });
        }
        if (layer.route.methods._all) {
          out.push({ method: "ALL", path: `${prefix}${path}` });
        }
      }
    } else if (layer.handle?.stack || layer.handle?.router?.stack) {
      // Express 5 keeps no mount path, only whether it was "/". Routes
      // under any other mount are marked partial.
      walk(
        (layer.handle.stack ?? layer.handle.router?.stack) as Layer[],
        prefix,
        out,
        partial || !layer.slash,
      );
    }
  }
}

export function listPluginHttpRoutes(): InventoryRoute[] {
  const out: InventoryRoute[] = [];
  for (const id of listRouterIds()) {
    const router = getPluginRouter(id) as
      (Router & { stack: Layer[] }) | undefined;
    if (!router) continue;
    const found: InventoryRoute[] = [];
    walk(router.stack, `/plugin-api/${id}`, found, false);
    out.push(...found);
  }
  return out;
}

export function writeRouteInventory(file: string): void {
  const data = {
    http: listPluginHttpRoutes(),
    ws: listWsRoutes().map((route) => ({
      method: "WS",
      path: `/plugin-ws/${route.pluginId}${route.path}`,
      public: !!route.public,
      optionalAuth: !!route.optionalAuth,
    })),
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
