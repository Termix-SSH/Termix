import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { createLogger } from "./helpers.js";
import { createDockerSessions } from "./sessions.js";
import { registerRoutes } from "./routes.js";
import { registerConsole } from "./console.js";
import { registerServices } from "./services.js";
import { normalizeImportedHost } from "./host-settings.js";

export type {
  DockerContainerAction,
  DockerContainerSummary,
  DockerEvent,
  DockerEventsV1,
  DockerServiceV1,
} from "./services.js";

export async function activate(ctx: PluginContext) {
  const log = createLogger(ctx.log);
  const sessions = createDockerSessions(ctx.schedule, log);
  ctx.disposables.add(() => sessions.closeAll());

  registerRoutes(ctx.http.router<Router>(), { ctx, sessions, log });
  registerConsole(ctx, log);
  registerServices(ctx, log);
  ctx.registry.provide("docker.hostImportNormalizer", normalizeImportedHost);

  ctx.log.info(
    "Docker mounted at /plugin-api/docker and /plugin-ws/docker/console",
  );
}

export async function deactivate() {}
