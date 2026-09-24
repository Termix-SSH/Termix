import { Client, type ConnectConfig } from "ssh2";
import type { PluginSsh } from "@termix/plugin-sdk/backend";
import {
  connectionLog,
  newSessionId,
  type ConnectionLog,
  type MetricsHost,
} from "./helpers.js";
import type { MetricsLogger } from "./log.js";
import { sessionKey, type MetricsSessions } from "./sessions.js";

const CONNECT_TIMEOUT_MS = 60_000;
const TOTP_TTL_MS = 180_000;
const MAX_TOTP_ATTEMPTS = 3;

export type StartResult =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401 | 500; body: Record<string, unknown> };

export interface InteractiveDeps {
  ssh: PluginSsh;
  sessions: MetricsSessions;
  log: MetricsLogger;
  registerViewer: (hostId: number, sessionId: string, userId: string) => void;
}

function stageForError(message: string): [string, string] {
  if (message.includes("ENOTFOUND") || message.includes("getaddrinfo")) {
    return ["dns", `DNS resolution failed: ${message}`];
  }
  if (message.includes("ECONNREFUSED") || message.includes("ETIMEDOUT")) {
    return ["tcp", `TCP connection failed: ${message}`];
  }
  if (message.includes("handshake") || message.includes("key exchange")) {
    return ["handshake", `SSH handshake failed: ${message}`];
  }
  if (/authentication/i.test(message)) {
    return ["auth", `Authentication failed: ${message}`];
  }
  if (message.includes("verification failed")) {
    return [
      "handshake",
      "SSH host key has changed. For security, please open a Terminal connection to this host first to verify and accept the new key fingerprint.",
    ];
  }
  return ["error", `SSH connection failed: ${message}`];
}

/**
 * Opens a connection from the tab, where a person can answer a TOTP prompt,
 * and keeps it for polling. Resolves with the HTTP answer.
 */
export async function startInteractive(
  deps: InteractiveDeps,
  host: MetricsHost,
  userId: string,
): Promise<StartResult> {
  const { ssh, sessions, log } = deps;
  const logs: ConnectionLog[] = [
    connectionLog("info", "stats_connecting", "Starting metrics collection"),
    connectionLog("info", "dns", `Resolving DNS for ${host.ip}`),
    connectionLog("info", "tcp", `Connecting to ${host.ip}:${host.port}`),
    connectionLog("info", "handshake", "Initiating SSH handshake"),
  ];
  if (host.authType === "password") {
    logs.push(connectionLog("info", "auth", "Authenticating with password"));
  } else if (host.authType === "key") {
    logs.push(connectionLog("info", "auth", "Authenticating with SSH key"));
  }

  const key = sessionKey(host.id, userId);
  if (sessions.get(key)?.isConnected) {
    logs.push(
      connectionLog(
        "success",
        "stats_polling",
        "Using existing metrics session",
      ),
    );
    return { status: 200, body: { success: true, connectionLogs: logs } };
  }

  const client = new Client();
  const prepared = await ssh.prepare(host, {
    purpose: "metrics",
    client,
    log: (level, message) => logs.push(connectionLog(level, "auth", message)),
  });
  const config = prepared.config as ConnectConfig;
  config.readyTimeout = CONNECT_TIMEOUT_MS;
  if (prepared.outcome.status !== "ready") {
    const outcome = prepared.outcome;
    logs.push(connectionLog("error", "auth", outcome.message));
    if (outcome.status === "interaction-required") {
      return {
        status: 401,
        body: {
          error: outcome.message,
          requiresAuthInteraction: outcome.interaction,
          ...(outcome.flag ? { [outcome.flag]: true } : {}),
          connectionLogs: logs,
        },
      };
    }
    return {
      status: 400,
      body: { error: outcome.message, connectionLogs: logs },
    };
  }

  try {
    const result = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          fn();
        };
        const timeout = setTimeout(
          () =>
            settle(() => {
              client.end();
              reject(new Error("Connection timeout"));
            }),
          CONNECT_TIMEOUT_MS,
        );

        client.on(
          "keyboard-interactive",
          (name, instructions, _lang, prompts, finish) => {
            const decision = ssh.classifyKeyboardInteractive(
              { name, instructions, prompts },
              host,
            );
            if (decision.kind !== "totp") {
              finish(ssh.autoResponses(prompts, host.password));
              return;
            }
            const sessionId = newSessionId("totp");
            sessions.addPending({
              client,
              finish,
              config,
              createdAt: Date.now(),
              sessionId,
              hostId: host.id,
              userId,
              prompts: prompts.map((p) => ({
                prompt: p.prompt,
                echo: p.echo ?? false,
              })),
              totpPromptIndex: decision.promptIndex,
              resolvedPassword: host.password ?? undefined,
              totpAttempts: 0,
            });
            logs.push(
              connectionLog("info", "stats_totp", "TOTP verification required"),
            );
            settle(() =>
              resolve({
                success: false,
                requires_totp: true,
                sessionId,
                prompt: prompts[decision.promptIndex].prompt,
              }),
            );
          },
        );

        client.on("ready", () =>
          settle(() => {
            logs.push(
              connectionLog(
                "success",
                "connected",
                "SSH connection established successfully",
              ),
              connectionLog(
                "success",
                "stats_polling",
                "Metrics session established",
              ),
            );
            sessions.open(key, {
              client,
              isConnected: true,
              lastActive: Date.now(),
              activeOperations: 0,
              hostId: host.id,
              userId,
            });
            const viewerSessionId = newSessionId("viewer");
            deps.registerViewer(host.id, viewerSessionId, userId);
            resolve({ success: true, viewerSessionId });
          }),
        );

        client.on("error", (error) =>
          settle(() => {
            const message =
              error instanceof Error ? error.message : String(error);
            const [stage, text] = stageForError(message);
            logs.push(connectionLog("error", stage, text));
            log.error("SSH connection error in metrics/start", {
              operation: "metrics_start_ssh_error",
              hostId: host.id,
              error: message,
            });
            reject(error);
          }),
        );

        if (Array.isArray(host.jumpHosts) && host.jumpHosts.length > 0) {
          logs.push(
            connectionLog("info", "proxy", "Connecting via jump host chain"),
          );
        }
        ssh
          .openTransport(host, config as Record<string, unknown>)
          .then((transport) => {
            if (transport.jumpClient) {
              const jumpClient = transport.jumpClient as Client;
              client.on("close", () => jumpClient.end());
            }
            client.connect(config);
          })
          .catch((error) =>
            settle(() => {
              logs.push(
                connectionLog(
                  "error",
                  "proxy",
                  `Connection setup failed: ${error instanceof Error ? error.message : String(error)}`,
                ),
              );
              reject(error);
            }),
          );
      },
    );
    return { status: 200, body: { ...result, connectionLogs: logs } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logs.push(
      connectionLog(
        "error",
        "stats_connecting",
        `Failed to start metrics: ${message}`,
      ),
    );
    return {
      status: 500,
      body: {
        error: message || "Failed to start metrics collection",
        connectionLogs: logs,
      },
    };
  }
}

export type TotpResult = { status: number; body: Record<string, unknown> };

/** Sends the TOTP code a person typed and keeps the connection on success. */
export async function submitTotp(
  deps: InteractiveDeps,
  userId: string,
  sessionId: string,
  totpCode: string,
): Promise<TotpResult> {
  const { sessions, log } = deps;
  const session = sessions.getPending(sessionId);
  if (!session) {
    return {
      status: 404,
      body: { error: "TOTP session not found or expired" },
    };
  }
  if (Date.now() - session.createdAt > TOTP_TTL_MS) {
    sessions.dropPending(sessionId, true);
    return { status: 408, body: { error: "TOTP session timeout" } };
  }
  if (session.userId !== userId) {
    return { status: 403, body: { error: "Unauthorized" } };
  }

  session.totpAttempts++;
  if (session.totpAttempts > MAX_TOTP_ATTEMPTS) {
    sessions.dropPending(sessionId, true);
    return { status: 429, body: { error: "Too many TOTP attempts" } };
  }

  const passwordFor = (prompt: string) =>
    /password/i.test(prompt) && session.resolvedPassword
      ? session.resolvedPassword
      : "";

  try {
    const responses = (session.prompts || []).map((p, index) =>
      index === session.totpPromptIndex
        ? totpCode.trim()
        : passwordFor(p.prompt),
    );

    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("TOTP verification timeout")),
        30_000,
      );
      session.client.once(
        "keyboard-interactive",
        (_name, _instructions, _lang, prompts, finish) => {
          log.warn("Second keyboard-interactive received after TOTP", {
            operation: "totp_second_keyboard_interactive",
            hostId: session.hostId,
          });
          finish(prompts.map((p) => passwordFor(p.prompt)));
        },
      );
      session.client.once("ready", () => {
        clearTimeout(timeout);
        resolve();
      });
      session.client.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    session.finish(responses);
    await ready;

    sessions.open(sessionKey(session.hostId, userId), {
      client: session.client,
      isConnected: true,
      lastActive: Date.now(),
      activeOperations: 0,
      hostId: session.hostId,
      userId,
    });
    sessions.dropPending(sessionId);

    const viewerSessionId = newSessionId("viewer");
    deps.registerViewer(session.hostId, viewerSessionId, userId);
    return { status: 200, body: { success: true, viewerSessionId } };
  } catch (error) {
    log.error("TOTP verification failed", {
      operation: "totp_verification_failed",
      hostId: session.hostId,
      error: error instanceof Error ? error.message : String(error),
    });
    if (session.totpAttempts >= MAX_TOTP_ATTEMPTS) {
      sessions.dropPending(sessionId, true);
    }
    return {
      status: 401,
      body: {
        error: "TOTP verification failed",
        attemptsRemaining: Math.max(
          0,
          MAX_TOTP_ATTEMPTS - session.totpAttempts,
        ),
      },
    };
  }
}
