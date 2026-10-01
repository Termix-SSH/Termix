/**
 * The Docker panel's interactive connect.
 *
 * Core's pipeline does the handshake; this only bridges its prompt channel to
 * HTTP. A connect that needs a person (a TOTP code, a browser sign-in, a
 * password the host does not store) answers the request that is waiting with
 * what to ask, and the next request (connect-totp, connect-browser-sign-in) carries
 * the answer back and waits for whatever comes after it: the session, another
 * prompt, or an error.
 */

import type { Client } from "ssh2";
import type {
  PluginContext,
  PluginSshHost,
  PluginSshPromptRequest,
} from "@termix/plugin-sdk/backend";
import type { ContainerRuntime } from "./container-runtime.js";
import type { DockerSessions } from "./sessions.js";
import {
  connectionLog,
  getErrorMessage,
  type ConnectionLogLine,
  type DockerLogger,
} from "./helpers.js";

/** What one HTTP request answers with. */
export interface ConnectStep {
  status: number;
  body: Record<string, unknown>;
}

const TOTP_WAIT_MS = 3 * 60 * 1000;
const BROWSER_SIGN_IN_WAIT_MS = 5 * 60 * 1000;
const STEP_WAIT_MS = 90 * 1000;
// Covers the longest a person may take on a prompt, plus the handshake.
const CONNECT_TIMEOUT_MS = BROWSER_SIGN_IN_WAIT_MS + 30 * 1000;

const PASSWORD_PROMPT = /password/i;

/** Hands each step to whichever request is waiting for one. */
export class PendingConnect {
  constructor(
    readonly userId: string,
    readonly hostId: number,
  ) {}

  expiresAt = Date.now() + TOTP_WAIT_MS;
  /** What the open prompt expects, or null when nothing is being asked. */
  awaiting: "totp" | "browser" | null = null;
  abandoned = false;
  private waiter: ((step: ConnectStep) => void) | null = null;
  private queued: ConnectStep | null = null;
  private answer: ((value: string | null) => void) | null = null;

  emit(step: ConnectStep): void {
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter(step);
    } else {
      this.queued = step;
    }
  }

  next(timeoutMs = STEP_WAIT_MS): Promise<ConnectStep> {
    if (this.queued) {
      const step = this.queued;
      this.queued = null;
      return Promise.resolve(step);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiter !== settle) return;
        this.waiter = null;
        this.cancel();
        resolve({
          status: 408,
          body: { error: "Connection timed out. Please reconnect." },
        });
      }, timeoutMs);
      const settle = (step: ConnectStep) => {
        clearTimeout(timer);
        resolve(step);
      };
      this.waiter = settle;
    });
  }

  ask(kind: "totp" | "browser", waitMs: number): Promise<string | null> {
    this.awaiting = kind;
    this.expiresAt = Date.now() + waitMs;
    return new Promise((resolve) => {
      this.answer = resolve;
    });
  }

  respond(value: string | null): void {
    const answer = this.answer;
    this.answer = null;
    this.awaiting = null;
    answer?.(value);
  }

  /** Nobody will read the result: give up the prompt and drop the client. */
  cancel(): void {
    this.abandoned = true;
    this.respond(null);
  }
}

function classifyConnectError(
  message: string,
  logs: ConnectionLogLine[],
): { hostKeyChanged: boolean; authFailed: boolean } {
  if (message.includes("ENOTFOUND") || message.includes("getaddrinfo")) {
    logs.push(
      connectionLog("error", "dns", `DNS resolution failed: ${message}`),
    );
  } else if (
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT")
  ) {
    logs.push(
      connectionLog("error", "tcp", `TCP connection failed: ${message}`),
    );
  } else if (message.includes("verification failed")) {
    logs.push(
      connectionLog(
        "error",
        "handshake",
        "SSH host key has changed. For security, please open a Terminal connection to this host first to verify and accept the new key fingerprint.",
      ),
    );
    return { hostKeyChanged: true, authFailed: false };
  } else if (
    message.includes("handshake") ||
    message.includes("key exchange")
  ) {
    logs.push(
      connectionLog("error", "handshake", `SSH handshake failed: ${message}`),
    );
  } else if (/authentication/i.test(message)) {
    logs.push(
      connectionLog("error", "auth", `Authentication failed: ${message}`),
    );
    return { hostKeyChanged: false, authFailed: true };
  } else {
    logs.push(
      connectionLog("error", "error", `SSH connection failed: ${message}`),
    );
  }
  return { hostKeyChanged: false, authFailed: false };
}

export interface StartConnectInput {
  sessionId: string;
  userId: string;
  host: PluginSshHost;
  runtime: ContainerRuntime;
  logs: ConnectionLogLine[];
}

/**
 * Starts a connect and returns the first step for the request that asked.
 * The pending entry lives in `sessions` until the connect settles, so the
 * answer routes can find it.
 */
export async function startConnect(
  ctx: PluginContext,
  sessions: DockerSessions,
  log: DockerLogger,
  input: StartConnectInput,
): Promise<ConnectStep> {
  const { sessionId, userId, host, runtime, logs } = input;
  const hostId = host.id;
  const authType = (host.authType as string) || "none";
  const credentialless = !ctx.ssh.requiresSecret(authType);

  const pending = new PendingConnect(userId, hostId);
  sessions.setPending(sessionId, pending);

  const parkTotp = (prompt: string, extra: Record<string, unknown>) => {
    logs.push(connectionLog("info", "docker_auth", "Verification required"));
    const answer = pending.ask("totp", TOTP_WAIT_MS);
    pending.emit({
      status: 200,
      body: {
        requires_totp: true,
        sessionId,
        prompt,
        connectionLogs: logs,
        ...extra,
      },
    });
    return answer;
  };

  const ask = async (
    request: PluginSshPromptRequest,
  ): Promise<string | null> => {
    if (pending.abandoned) return null;
    switch (request.kind) {
      case "totp":
        return parkTotp(request.prompt, request.retry ? { retry: true } : {});
      case "browser": {
        logs.push(
          connectionLog(
            "info",
            "docker_auth",
            `${request.label} sign-in required`,
          ),
        );
        const answer = pending.ask("browser", BROWSER_SIGN_IN_WAIT_MS);
        pending.emit({
          status: 200,
          body: {
            requires_browser_sign_in: true,
            sessionId,
            label: request.label,
            url: request.url,
            code: request.code,
            connectionLogs: logs,
          },
        });
        return answer;
      }
      case "input": {
        const isPassword = PASSWORD_PROMPT.test(request.prompt);
        if (isPassword && credentialless) {
          pending.abandoned = true;
          pending.emit({
            status: 200,
            body: { status: "auth_required", reason: "no_keyboard" },
          });
          return null;
        }
        if (!isPassword && !request.isPush) return "";
        return parkTotp(request.prompt, isPassword ? { isPassword: true } : {});
      }
    }
  };

  logs.push(connectionLog("info", "dns", `Resolving DNS for ${host.ip}`));
  logs.push(
    connectionLog("info", "tcp", `Connecting to ${host.ip}:${host.port}`),
  );
  logs.push(connectionLog("info", "handshake", "Initiating SSH handshake"));

  ctx.ssh
    .connect<Client>(host, {
      purpose: "docker",
      profile: "session",
      timeoutMs: CONNECT_TIMEOUT_MS,
      prompt: { ask },
    })
    .then(
      (connection) => {
        sessions.clearPending(sessionId);
        ctx.hosts.status.reportLogin(hostId, { ok: true });
        if (pending.abandoned) {
          connection.dispose();
          return;
        }

        const session = {
          id: sessionId,
          client: connection.client,
          dispose: connection.dispose,
          hostId,
          userId,
          runtime,
          isWindows: false,
          lastActive: Date.now(),
          activeOperations: 0,
        };
        sessions.add(session);

        connection.client.exec("ver", (err, stream) => {
          if (err || !stream) return;
          let output = "";
          stream.on("data", (d: Buffer) => {
            output += d.toString();
          });
          stream.on("close", () => {
            if (output.toLowerCase().includes("windows")) {
              session.isWindows = true;
            }
          });
          stream.stderr.on("data", () => {});
        });

        void ctx.audit.record({
          action: "docker_connect",
          resourceType: "host",
          resourceId: String(hostId),
          resourceName: (host.name as string) || undefined,
          success: true,
        });

        logs.push(
          connectionLog(
            "success",
            "connected",
            "SSH connection established successfully",
          ),
        );
        pending.emit({
          status: 200,
          body: { success: true, status: "success", connectionLogs: logs },
        });
      },
      (error: unknown) => {
        sessions.clearPending(sessionId);
        const message = getErrorMessage(error, "SSH connection failed");
        if (pending.abandoned) return;

        const outcome = (error as { outcome?: Record<string, unknown> })
          .outcome;
        if (outcome?.status === "interaction-required") {
          logs.push(connectionLog("error", "docker_auth", message));
          pending.emit({
            status: 401,
            body: {
              error: message,
              requiresAuthInteraction: outcome.interaction,
              ...(typeof outcome.flag === "string"
                ? { [outcome.flag]: true }
                : {}),
              connectionLogs: logs,
            },
          });
          return;
        }
        if (outcome?.status === "error") {
          logs.push(connectionLog("error", "docker_auth", message));
          pending.emit({
            status: 400,
            body: { error: message, connectionLogs: logs },
          });
          return;
        }

        const { hostKeyChanged, authFailed } = classifyConnectError(
          message,
          logs,
        );
        if (hostKeyChanged || authFailed) {
          ctx.hosts.status.reportLogin(hostId, { ok: false, hostKeyChanged });
        }
        log.error("Docker SSH connection failed", {
          hostId,
          userId,
          error: message,
        });

        if (credentialless && authFailed) {
          pending.emit({
            status: 200,
            body: {
              status: "auth_required",
              reason: "no_keyboard",
              connectionLogs: logs,
            },
          });
          return;
        }
        pending.emit({
          status: 500,
          body: { success: false, message, connectionLogs: logs },
        });
      },
    );

  return pending.next();
}

/** Carries a person's answer to a parked connect and waits for what's next. */
export async function answerConnect(
  sessions: DockerSessions,
  sessionId: string,
  userId: string,
  kind: "totp" | "browser",
  value: string,
): Promise<ConnectStep> {
  const pending = sessions.getPending(sessionId);
  if (!(pending instanceof PendingConnect) || pending.userId !== userId) {
    return {
      status: 404,
      body: { error: "Authentication session expired. Please reconnect." },
    };
  }
  if (pending.awaiting !== kind) {
    return {
      status: 400,
      body: {
        error:
          kind === "browser"
            ? "Session is not waiting for a browser sign-in"
            : "Session is not waiting for a code",
      },
    };
  }
  pending.respond(value);
  return pending.next();
}
