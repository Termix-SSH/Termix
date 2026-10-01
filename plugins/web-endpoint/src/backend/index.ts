import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { createWebEndpointRoutes } from "./routes.js";
import { hostImportNormalizer } from "./host-import.js";

export async function activate(ctx: PluginContext) {
  const router = ctx.http.router<Router>();
  router.use(createWebEndpointRoutes(ctx));

  ctx.registry.provide(
    "web-endpoint.hostImportNormalizer",
    hostImportNormalizer,
  );
  ctx.disposables.add(
    () =>
      void ctx.registry.revoke(
        "web-endpoint.hostImportNormalizer",
        hostImportNormalizer,
      ),
  );

  ctx.log.info("Web Endpoint routes mounted at /plugin-api/web-endpoint");
}

export async function deactivate() {}
