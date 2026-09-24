import { AsyncResource } from "node:async_hooks";
import { StringDecoder } from "node:string_decoder";
import type { Client, ClientChannel } from "ssh2";
import { WebSocket, type RawData } from "ws";
import type {
  PluginContext,
  PluginWebSocketConnection,
} from "@termix/plugin-sdk/backend";
import {
  containerCommand,
  type ContainerRuntime,
} from "./container-runtime.js";
import { readDockerHostSettings } from "./host-settings.js";
import {
  CONTAINER_ID_RE,
  HOST_ADDRESS_MISMATCH_MESSAGE,
  HOST_NOT_ON_THIS_SERVER_MESSAGE,
  asObject,
  asString,
  getErrorMessage,
  hostAddressMismatch,
  parseWsMessage,
  toTerminalDimension,
  type DockerLogger,
} from "./helpers.js";

const SHELLS = ["bash", "sh", "ash", "zsh"];
const PING_MS = 30_000;

interface ConsoleSession {
  client: Client;
  dispose: () => void;
  stream: ClientChannel | null;
  hostId: number;
  containerId: string;
  runtime: ContainerRuntime;
}

function shellExists(
  client: Client,
  runtime: ContainerRuntime,
  containerId: string,
  shell: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    client.exec(
      containerCommand(runtime, `exec ${containerId} which ${shell}`),
      (err, stream) => {
        if (err) return resolve(false);
        let output = "";
        stream.on("data", (data: Buffer) => {
          output += data.toString();
        });
        stream.on("close", (code: number) =>
          resolve(code === 0 && output.trim().length > 0),
        );
        stream.stderr.on("data", () => {});
        stream.stderr.on("error", () => {});
        stream.on("error", () => resolve(false));
      },
    );
  });
}

async function pickShell(
  client: Client,
  runtime: ContainerRuntime,
  containerId: string,
  requested: string | undefined,
): Promise<string> {
  if (requested && (await shellExists(client, runtime, containerId, requested)))
    return requested;
  for (const shell of ["bash", "sh", "ash"]) {
    if (await shellExists(client, runtime, containerId, shell)) return shell;
  }
  return "sh";
}

/**
 * The container console at /plugin-ws/docker/console.
 *
 * Public with optionalAuth: core still resolves the caller's token, and the
 * handler refuses a socket without a user or without docker.use. Every live
 * console is closed when the plugin deactivates.
 */
export function registerConsole(ctx: PluginContext, log: DockerLogger): void {
  const live = new Set<() => void>();
  ctx.disposables.add(() => {
    for (const end of [...live]) end();
    live.clear();
  });

  const onConnection = async (connection: PluginWebSocketConnection) => {
    const ws = connection.socket as WebSocket;
    const userId = connection.userId;
    if (!userId || !(await ctx.rbac.hasFor(userId, "use"))) {
      ws.close(1008, "Authentication required");
      return;
    }

    let session: ConsoleSession | null = null;
    const send = (message: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };

    const endSession = () => {
      if (!session) return;
      const current = session;
      session = null;
      current.stream?.end();
      current.dispose();
    };

    const pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, PING_MS);

    const cleanup = () => {
      clearInterval(pingTimer);
      endSession();
      live.delete(shutdown);
    };
    const shutdown = () => {
      cleanup();
      try {
        ws.close(1001, "Docker plugin disabled");
      } catch {
        // already closed
      }
    };
    live.add(shutdown);

    const connect = async (data: unknown) => {
      if (!connection.isDataUnlocked()) {
        send({
          type: "error",
          message: "Session expired - please log in again",
        });
        return;
      }
      const payload = asObject(data);
      const hostConfig = asObject(payload.hostConfig);
      const hostId = Number(hostConfig.id);
      const syncId =
        typeof hostConfig.syncId === "string" ? hostConfig.syncId : null;
      const containerId = asString(payload.containerId);
      const shell = asString(payload.shell) || undefined;
      const cols = toTerminalDimension(payload.cols) || 80;
      const rows = toTerminalDimension(payload.rows) || 24;

      if (!hostId || !containerId) {
        send({
          type: "error",
          message: "Host configuration and container ID are required",
        });
        return;
      }
      if (!CONTAINER_ID_RE.test(containerId)) {
        send({ type: "error", message: "Invalid container ID" });
        return;
      }
      if (shell && !SHELLS.includes(shell)) {
        send({ type: "error", message: "Invalid shell" });
        return;
      }

      endSession();

      try {
        // syncId names the host on both sides of a sync pair; the numeric
        // id only names it in the database the client is displaying.
        const host = await ctx.ssh.resolveHost(hostId, { syncId });
        if (!host) {
          send({
            type: "error",
            message: syncId
              ? HOST_NOT_ON_THIS_SERVER_MESSAGE
              : "Host not found",
          });
          return;
        }
        if (!syncId && hostAddressMismatch(hostConfig.ip, host.ip)) {
          log.error("Refusing Docker console: host id resolves elsewhere", {
            hostId,
            userId,
          });
          send({ type: "error", message: HOST_ADDRESS_MISMATCH_MESSAGE });
          return;
        }

        const settings = await readDockerHostSettings(ctx, host.id);
        if (!settings.enabled) {
          send({
            type: "error",
            message:
              "Docker is not enabled for this host. Enable it in Host Settings.",
          });
          return;
        }

        const { client, dispose } = await ctx.ssh.connect<Client>(host, {
          purpose: "docker-console",
          timeoutMs: 65_000,
        });
        if (ws.readyState !== WebSocket.OPEN) {
          dispose();
          return;
        }
        const current: ConsoleSession = {
          client,
          dispose,
          stream: null,
          hostId: host.id,
          containerId,
          runtime: settings.runtime,
        };
        session = current;

        const shellToUse = await pickShell(
          client,
          settings.runtime,
          containerId,
          shell,
        );
        if (session !== current) return;

        client.exec(
          containerCommand(
            settings.runtime,
            `exec -it ${containerId} /bin/${shellToUse}`,
          ),
          { pty: { term: "xterm-256color", cols, rows } },
          (err, stream) => {
            if (err) {
              send({
                type: "error",
                message: `Failed to start console: ${err.message}`,
              });
              return;
            }
            if (session !== current) {
              stream.end();
              return;
            }
            current.stream = stream;

            // Buffers split multi-byte UTF-8 sequences across chunks.
            const decoder = new StringDecoder("utf-8");
            stream.on("data", (chunk: Buffer) => {
              const text = decoder.write(chunk);
              if (text) send({ type: "output", data: text });
            });
            stream.stderr.on("data", () => {});
            stream.stderr.on("error", () => {});
            stream.on("error", (streamErr: Error) => {
              send({
                type: "error",
                message: `Console error: ${streamErr.message}`,
              });
            });
            stream.on("close", () => {
              send({ type: "disconnected", message: "Console session ended" });
              if (session === current) endSession();
            });

            send({
              type: "connected",
              data: {
                shell: shellToUse,
                requestedShell: shell,
                shellChanged: !!shell && shell !== shellToUse,
              },
            });
          },
        );
      } catch (error) {
        log.error("Failed to connect to container", error, {
          hostId,
          containerId,
        });
        send({
          type: "error",
          message: getErrorMessage(error, "Failed to connect to container"),
        });
      }
    };

    ws.on(
      "message",
      AsyncResource.bind(async (raw: RawData) => {
        let type: string;
        let data: unknown;
        try {
          ({ type, data } = parseWsMessage(raw));
        } catch (error) {
          send({ type: "error", message: getErrorMessage(error) });
          return;
        }

        switch (type) {
          case "connect":
            await connect(data);
            break;
          case "input": {
            const input = asString(data);
            if (input) session?.stream?.write(input);
            break;
          }
          case "resize": {
            const size = asObject(data);
            const cols = toTerminalDimension(size.cols);
            const rows = toTerminalDimension(size.rows);
            if (cols && rows)
              session?.stream?.setWindow(rows, cols, rows, cols);
            break;
          }
          case "disconnect":
            if (session) {
              endSession();
              send({
                type: "disconnected",
                message: "Disconnected from container",
              });
            }
            break;
          case "ping":
            send({ type: "pong" });
            break;
          default:
            log.warn("Unknown docker console message", { type });
        }
      }),
    );

    ws.on("close", cleanup);
    ws.on("error", (error: Error) => {
      log.error("Docker console socket error", error);
      cleanup();
    });
  };

  ctx.ws.route("/console", onConnection, { public: true, optionalAuth: true });
}
