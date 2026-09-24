import crypto from "crypto";
import net from "net";
import path from "path";
import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { GuacamoleTokenService } from "./token-service.js";
import type { GuacdOptions } from "./guacd-config.js";
import type { RemoteSessions } from "./sessions.js";
import type { RecordingsWriter } from "./guacamole-server.js";
import { recordingsDir } from "./guacamole-server.js";
import { withRecordingSettings } from "./recording-settings.js";
import { withDriveSettings } from "./drive-settings.js";
import { resolveJumpTunnelEndpoint } from "./jump-tunnel-endpoint.js";
import { buildRdpSettings, resolveRdpDomain } from "./rdp-settings.js";
import { createMacosVncCompatibilityProxy } from "./macos-vnc-proxy.js";
import { openJumpTunnel } from "./jump-tunnel.js";
import {
  DEFAULT_PORT,
  ENABLE_KEY,
  PORT_KEY,
  isRemoteProtocol,
  readHostSettings,
  readUserDefaults,
  type RemoteProtocol,
} from "./host-settings.js";
import { errorMessage, type RemoteDesktopLogger } from "./log.js";

export interface RouteDeps {
  ctx: PluginContext;
  log: RemoteDesktopLogger;
  tokens: GuacamoleTokenService;
  sessions: RemoteSessions;
  guacd: () => GuacdOptions;
  enabled: () => Promise<boolean>;
  recordings: () => RecordingsWriter | null;
}

function actor(ctx: PluginContext, res: Response): string | null {
  const userId = ctx.currentActor();
  if (!userId) res.status(401).json({ error: "Authentication required" });
  return userId ?? null;
}

function probeGuacd({ host, port }: GuacdOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(3000);
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

/** guacd reads these settings as given; the editor stores "auto" for its default. */
function cleanGuacConfig(raw: Record<string, unknown>): {
  config: Record<string, unknown>;
  guacdOverrides: { guacdHost?: string; guacdPort?: number };
} {
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== "auto") config[key] = value;
  }
  const guacdHost =
    typeof config["guacd-hostname"] === "string" && config["guacd-hostname"]
      ? (config["guacd-hostname"] as string)
      : undefined;
  const guacdPort = config["guacd-port"]
    ? parseInt(String(config["guacd-port"]), 10) || undefined
    : undefined;
  delete config["guacd-hostname"];
  delete config["guacd-port"];
  if (config.dpi != null) {
    const dpi = parseInt(String(config.dpi), 10);
    config.dpi = Number.isFinite(dpi) && dpi > 0 ? dpi : undefined;
  }
  return {
    config,
    guacdOverrides: {
      ...(guacdHost ? { guacdHost } : {}),
      ...(guacdPort ? { guacdPort } : {}),
    },
  };
}

export function registerRoutes(router: Router, deps: RouteDeps): void {
  const { ctx, log, tokens, sessions } = deps;

  const refuseWhenOff = async (res: Response): Promise<boolean> => {
    if (await deps.enabled()) return false;
    res.status(403).json({ error: "Remote Desktop is turned off" });
    return true;
  };

  /**
   * @openapi
   * /plugin-api/remote-desktop/connection/{connectId}:
   *   get:
   *     summary: Look up guacd's id for a session
   *     description: Returns the guacamole connection id for a connect request, once guacd has opened it. Only the session's owner gets an answer.
   *     tags:
   *       - Remote Desktop
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: connectId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The id, or null while guacd has not opened the session.
   *       401:
   *         description: Not signed in.
   */
  router.get("/connection/:connectId", (req: Request, res: Response) => {
    const userId = actor(ctx, res);
    if (!userId) return;
    const session = sessions.byConnect(String(req.params.connectId));
    res.json({
      guacamoleConnectionId:
        session?.ownerUserId === userId ? session.guacamoleConnectionId : null,
    });
  });

  /**
   * @openapi
   * /plugin-api/remote-desktop/token:
   *   post:
   *     summary: Mint a connection token for an address
   *     description: Creates an encrypted guacamole-lite token for connection details the caller supplies, used by Quick Connect. No saved host is involved.
   *     tags:
   *       - Remote Desktop
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - type
   *               - hostname
   *             properties:
   *               type:
   *                 type: string
   *                 enum: [rdp, vnc, telnet]
   *               hostname:
   *                 type: string
   *               port:
   *                 type: integer
   *               username:
   *                 type: string
   *               password:
   *                 type: string
   *               domain:
   *                 type: string
   *     responses:
   *       200:
   *         description: The encrypted token.
   *       400:
   *         description: Missing or invalid fields.
   *       403:
   *         description: Remote Desktop is turned off.
   *       500:
   *         description: Server error.
   */
  router.post("/token", async (req: Request, res: Response) => {
    try {
      if (await refuseWhenOff(res)) return;
      const { type, hostname, port, username, password, domain, ...raw } =
        (req.body ?? {}) as Record<string, unknown>;
      if (!type || !hostname) {
        return res
          .status(400)
          .json({ error: "Missing required fields: type and hostname" });
      }
      if (!isRemoteProtocol(type)) {
        return res.status(400).json({
          error: "Invalid connection type. Must be rdp, vnc, or telnet",
        });
      }
      const options: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (value !== "auto") options[key] = value;
      }
      const host = String(hostname);
      const user = username ? String(username) : "";
      const pass = password ? String(password) : "";
      const targetPort = Number(port) || DEFAULT_PORT[type];
      const userId = ctx.currentActor();
      if (type === "rdp" && userId) {
        for (const [key, value] of Object.entries(
          await readUserDefaults(ctx, userId),
        )) {
          if (options[key] === undefined) options[key] = value;
        }
      }

      let token: string;
      if (type === "rdp") {
        token = tokens.createRdpToken(host, user, pass, {
          port: targetPort,
          domain: domain ? String(domain) : undefined,
          ...options,
        });
      } else if (type === "vnc") {
        token = tokens.createVncToken(host, user || undefined, pass, {
          port: targetPort,
          ...options,
        });
      } else {
        token = tokens.createTelnetToken(host, user, pass, {
          port: targetPort,
          ...options,
        });
      }
      res.json({ token });
    } catch (error) {
      log.error("Failed to generate a connection token", {
        operation: "guac_token_error",
        error: errorMessage(error),
      });
      res.status(500).json({ error: "Failed to generate connection token" });
    }
  });

  /**
   * @openapi
   * /plugin-api/remote-desktop/connect-host/{hostId}:
   *   post:
   *     summary: Mint a connection token for a saved host
   *     description: Resolves the host's RDP, VNC or Telnet login for the caller (a shared recipient gets only what was shared with them), opens a jump tunnel when the host has jump hosts, and returns an encrypted guacamole-lite token.
   *     tags:
   *       - Remote Desktop
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               protocol:
   *                 type: string
   *                 enum: [rdp, vnc, telnet]
   *               promptedUsername:
   *                 type: string
   *               promptedPassword:
   *                 type: string
   *               promptedDomain:
   *                 type: string
   *               tabInstanceId:
   *                 type: string
   *     responses:
   *       200:
   *         description: The token and the id to look the session up by.
   *       400:
   *         description: Invalid host id, or the protocol is off for this host.
   *       403:
   *         description: Remote Desktop is turned off.
   *       404:
   *         description: Host not found or no access.
   *       500:
   *         description: The tunnel or the token could not be set up.
   */
  router.post("/connect-host/:hostId", async (req: Request, res: Response) => {
    try {
      const userId = actor(ctx, res);
      if (!userId) return;
      if (await refuseWhenOff(res)) return;

      const hostId = Number.parseInt(String(req.params.hostId), 10);
      if (!hostId) return res.status(400).json({ error: "Invalid host ID" });

      const body = (req.body ?? {}) as Record<string, unknown>;
      const settings = await readHostSettings(ctx, hostId);
      const requested = body.protocol;
      const protocol: RemoteProtocol | undefined = isRemoteProtocol(requested)
        ? requested
        : (["rdp", "vnc", "telnet"] as const).find(
            (candidate) => settings[ENABLE_KEY[candidate]],
          );
      if (!protocol) {
        return res
          .status(400)
          .json({ error: "Remote Desktop is not enabled for this host." });
      }

      const target = await ctx.credentials.resolveHostProtocol(
        hostId,
        protocol,
      );
      if (!target) {
        return res.status(404).json({ error: "Host not found" });
      }
      if (!settings[ENABLE_KEY[protocol]]) {
        return res.status(400).json({
          error: `${protocol.toUpperCase()} is not enabled for this host.`,
        });
      }

      // The user's RDP defaults sit under whatever the host sets itself.
      const { config, guacdOverrides } = cleanGuacConfig({
        ...(protocol === "rdp" ? await readUserDefaults(ctx, userId) : {}),
        ...settings.guacamoleConfig,
      });
      let guacConfig = config;

      const promptForLogin =
        protocol === "rdp" && target.auth.authType === "none";
      const username = promptForLogin
        ? String(body.promptedUsername || "")
        : target.auth.username;
      const password = promptForLogin
        ? String(body.promptedPassword || "")
        : target.auth.password;
      const domain = resolveRdpDomain(
        target.auth.authType,
        body.promptedDomain,
        target.auth.domain,
      );

      let hostname = target.host.ip;
      let port =
        (settings[PORT_KEY[protocol]] as number) || DEFAULT_PORT[protocol];
      const termixConnectId = crypto.randomUUID();
      const cleanups: Array<() => void> = [];
      const jumpHosts = target.host.jumpHosts;
      const needsVncProxy = protocol === "vnc" && !username;

      const endpoint =
        jumpHosts.length > 0 || needsVncProxy
          ? resolveJumpTunnelEndpoint(
              guacdOverrides.guacdHost || deps.guacd().host,
            )
          : null;

      try {
        if (jumpHosts.length > 0 && endpoint) {
          const tunnel = await openJumpTunnel(ctx, log, {
            jumpHosts,
            targetHost: hostname,
            targetPort: port,
            bindHost: endpoint.bindHost,
            connectId: termixConnectId,
          });
          cleanups.push(tunnel.close);
          hostname = endpoint.advertisedHost;
          port = tunnel.port;
        }

        if (needsVncProxy && endpoint) {
          const proxy = await createMacosVncCompatibilityProxy({
            targetHost: hostname,
            targetPort: port,
            bindHost: endpoint.bindHost,
          });
          cleanups.push(proxy.close);
          hostname = endpoint.advertisedHost;
          port = proxy.port;
        }
      } catch (error) {
        for (const cleanup of cleanups) cleanup();
        log.error("Failed to reach the host through its jump hosts", {
          operation: "guac_ssh_tunnel_error",
          hostId,
          error: errorMessage(error),
        });
        return res
          .status(500)
          .json({ error: "Failed to establish SSH tunnel to remote host" });
      }
      sessions.park(termixConnectId, cleanups);

      const recordings = deps.recordings();
      const recordingEnabled =
        protocol !== "vnc" &&
        !!recordings &&
        (await recordings.enabledFor(hostId));
      const recordingName = `${crypto.randomUUID()}.guac`;
      const guacdRecordingPath =
        process.env.GUACD_RECORDING_PATH ||
        process.env.GUACD_RECORDING_BACKEND_PATH ||
        path.resolve(recordingsDir());
      const recording = recordingEnabled
        ? {
            hostId,
            userId,
            protocol,
            path: recordingName,
            guacdPath: guacdRecordingPath,
            startedAt: new Date().toISOString(),
          }
        : undefined;
      if (recordingEnabled) {
        guacConfig = withRecordingSettings(
          guacConfig,
          guacdRecordingPath,
          recordingName,
        );
      }

      const termixMeta = {
        termixConnectId,
        hostId,
        hostName: target.host.name || target.host.ip,
        ownerUserId: userId,
        protocol,
        tabInstanceId:
          typeof body.tabInstanceId === "string" ? body.tabInstanceId : null,
      };

      let token: string;
      if (protocol === "rdp") {
        token = tokens.createRdpToken(
          hostname,
          username,
          password,
          buildRdpSettings({
            port,
            domain,
            security: settings.rdpSecurity || undefined,
            ignoreCert: settings.rdpIgnoreCert,
            guacConfig: withDriveSettings(guacConfig, userId),
            guacdOverrides,
          }),
          recording,
          termixMeta,
        );
      } else if (protocol === "vnc") {
        token = tokens.createVncToken(
          hostname,
          username || undefined,
          password,
          { port, ...guacConfig, ...guacdOverrides },
          recording,
          termixMeta,
        );
      } else {
        token = tokens.createTelnetToken(
          hostname,
          username,
          password,
          { port, ...guacConfig, ...guacdOverrides },
          recording,
          termixMeta,
        );
      }

      await ctx.audit.record({
        action: `${protocol}_connect`,
        resourceType: "host",
        resourceId: String(hostId),
        resourceName: `${hostname}:${port}`,
        success: true,
      });

      res.json({ token, termixConnectId, guacamoleConnectionId: null });
    } catch (error) {
      log.error("Failed to generate a connection token for a host", {
        operation: "guac_host_token_error",
        error: errorMessage(error),
      });
      res.status(500).json({ error: "Failed to generate connection token" });
    }
  });

  /**
   * @openapi
   * /plugin-api/remote-desktop/status:
   *   get:
   *     summary: Remote Desktop status
   *     description: Whether Remote Desktop is turned on, and whether guacd answers at the configured address.
   *     tags:
   *       - Remote Desktop
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: probe
   *         schema:
   *           type: string
   *         description: "0" skips dialing guacd.
   *     responses:
   *       200:
   *         description: The status.
   *       500:
   *         description: The check failed.
   */
  router.get("/status", async (req: Request, res: Response) => {
    try {
      const enabled = await deps.enabled();
      const guacd = deps.guacd();
      const probe = enabled && req.query.probe !== "0";
      const reachable = probe ? await probeGuacd(guacd) : false;
      res.json({
        enabled,
        guacd: {
          host: guacd.host,
          port: guacd.port,
          status: reachable ? "connected" : "disconnected",
        },
        websocket: {
          path: "/plugin-ws/remote-desktop/display",
          status: "running",
        },
      });
    } catch (error) {
      log.error("Failed to check Remote Desktop status", {
        operation: "guac_status_error",
        error: errorMessage(error),
      });
      res.status(500).json({ error: "Failed to check status" });
    }
  });

  /**
   * @openapi
   * /plugin-api/remote-desktop/native-rdp:
   *   get:
   *     summary: Whether the native RDP client can be opened
   *     description: True only in the Windows desktop app.
   *     tags:
   *       - Remote Desktop
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Availability.
   *   post:
   *     summary: Open the native RDP client
   *     description: Opens the operating system's own RDP client (mstsc) for an address. The password is never passed; the client asks for it. Windows desktop app only.
   *     tags:
   *       - Remote Desktop
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - host
   *             properties:
   *               host:
   *                 type: string
   *               port:
   *                 type: integer
   *               username:
   *                 type: string
   *               domain:
   *                 type: string
   *     responses:
   *       200:
   *         description: Whether the client opened.
   *       400:
   *         description: Missing host.
   *       404:
   *         description: Not running in the desktop app.
   */
  router.get("/native-rdp", (_req: Request, res: Response) => {
    res.json({
      available: ctx.desktop.available() && process.platform === "win32",
    });
  });

  router.post("/native-rdp", async (req: Request, res: Response) => {
    if (!ctx.desktop.available()) {
      return res.status(404).json({ error: "Only in the desktop app" });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.host !== "string" || !body.host) {
      return res.status(400).json({ error: "Missing host" });
    }
    try {
      const result = await ctx.desktop.launchNativeRdp({
        host: body.host,
        port: Number(body.port) || DEFAULT_PORT.rdp,
        username: typeof body.username === "string" ? body.username : undefined,
        domain: typeof body.domain === "string" ? body.domain : undefined,
      });
      res.json(result);
    } catch (error) {
      res.json({ success: false, error: errorMessage(error) });
    }
  });
}
