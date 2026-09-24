import type { PluginContext } from "@termix/plugin-sdk/backend";
import { GuacamoleTokenService } from "./token-service.js";
import { RemoteSessions } from "./sessions.js";
import {
  createGuacamoleServer,
  type RecordingsWriter,
} from "./guacamole-server.js";
import { resolveGuacdOptions } from "./guacd-config.js";
import { registerRoutes } from "./routes.js";
import { createLiveSessions } from "./live-sessions.js";
import { normalizeImportedHost } from "./host-settings.js";
import { createLogger } from "./log.js";

export async function activate(ctx: PluginContext) {
  const log = createLogger(ctx.log);
  const tokens = new GuacamoleTokenService(log);
  const sessions = new RemoteSessions();
  ctx.disposables.add(() => sessions.clear());

  // The admin setting, unless GUACD_URL / GUACD_HOST / GUACD_PORT override it.
  let guacdUrl = (await ctx.settings.get<string>("guacdUrl")) ?? "";
  const guacd = () => resolveGuacdOptions(guacdUrl || undefined);
  const enabled = async () =>
    (await ctx.settings.get<boolean>("enabled")) !== false;

  // Optional: without session-recording nothing is recorded.
  const recordings = (): RecordingsWriter | null => {
    const service =
      ctx.services.get<Partial<RecordingsWriter>>("recordings.writer");
    return typeof service.createFinished === "function" &&
      typeof service.enabledFor === "function"
      ? (service as RecordingsWriter)
      : null;
  };

  // guacamole-lite prints every new connection to stdout.
  const consoleLog = console.log;
  console.log = (...args: unknown[]) => {
    if (
      typeof args[0] === "string" &&
      args[0].startsWith("New client connection")
    )
      return;
    consoleLog(...args);
  };
  ctx.disposables.add(() => {
    console.log = consoleLog;
  });

  const server = createGuacamoleServer({
    log,
    tokens,
    sessions,
    guacd,
    recordings,
    asUser: (userId, fn) => ctx.asUser(userId, fn),
    onOpen: (hostId) => ctx.hosts.trackSession(hostId),
  });
  ctx.disposables.add(() => server.close());

  ctx.settings.onChange("guacdUrl", (value) => {
    guacdUrl = typeof value === "string" ? value : "";
    server.restart();
  });

  registerRoutes(ctx.http.router(), {
    ctx,
    log,
    tokens,
    sessions,
    guacd,
    enabled,
    recordings,
  });

  // guacamole-lite owns its own WebSocketServer, so it takes the raw upgrade.
  // Public because a display authenticates with the encrypted, single-use
  // token minted by an authenticated route, not with a session JWT.
  ctx.ws.upgrade(
    "/display",
    (request, socket, head) =>
      server.handleUpgrade(
        request as Parameters<typeof server.handleUpgrade>[0],
        socket as Parameters<typeof server.handleUpgrade>[1],
        head as Buffer,
      ),
    { public: true },
  );

  for (const protocol of ["rdp", "vnc", "telnet"] as const) {
    ctx.services.provide(
      "sessions.live",
      createLiveSessions(protocol, {
        sessions,
        tokens,
        endSession: server.endSession,
      }),
      { name: protocol },
    );
  }

  ctx.registry.provide(
    "remote-desktop.hostImportNormalizer",
    normalizeImportedHost,
  );
}

export async function deactivate() {}
