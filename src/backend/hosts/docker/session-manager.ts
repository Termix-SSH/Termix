import { Client as SSHClient } from "ssh2";
import { logger } from "../../utils/logger.js";
import type { ContainerRuntime } from "./container-runtime.js";

const sshLogger = logger;

export interface SSHSession {
  client: SSHClient;
  isConnected: boolean;
  lastActive: number;
  timeout?: NodeJS.Timeout;
  activeOperations: number;
  hostId?: number;
  userId?: string;
  isWindows?: boolean;
  containerRuntime?: ContainerRuntime;
}

export interface PendingTOTPSession {
  client: SSHClient;
  finish: (responses: string[]) => void;
  config: Record<string, unknown>;
  createdAt: number;
  sessionId: string;
  hostId?: number;
  ip?: string;
  port?: number;
  username?: string;
  userId?: string;
  prompts?: Array<{ prompt: string; echo: boolean }>;
  totpPromptIndex?: number;
  resolvedPassword?: string;
  totpAttempts: number;
  isWarpgate?: boolean;
  containerRuntime?: ContainerRuntime;
}

export const sshSessions: Record<string, SSHSession> = {};
export const pendingTOTPSessions: Record<string, PendingTOTPSession> = {};

const SESSION_IDLE_TIMEOUT = 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  Object.keys(pendingTOTPSessions).forEach((sessionId) => {
    const session = pendingTOTPSessions[sessionId];
    if (now - session.createdAt > 180000) {
      try {
        session.client.end();
      } catch {
        // expected
      }
      delete pendingTOTPSessions[sessionId];
    }
  });
}, 60000);

export function cleanupSession(sessionId: string) {
  const session = sshSessions[sessionId];
  if (session) {
    if (session.activeOperations > 0) {
      sshLogger.warn(
        `Deferring session cleanup for ${sessionId} - ${session.activeOperations} active operations`,
        {
          operation: "cleanup_deferred",
          sessionId,
          activeOperations: session.activeOperations,
        },
      );
      scheduleSessionCleanup(sessionId);
      return;
    }

    try {
      session.client.end();
    } catch {
      // expected
    }
    clearTimeout(session.timeout);
    delete sshSessions[sessionId];
  }
}

export function scheduleSessionCleanup(sessionId: string) {
  const session = sshSessions[sessionId];
  if (session) {
    if (session.timeout) clearTimeout(session.timeout);

    session.timeout = setTimeout(() => {
      cleanupSession(sessionId);
    }, SESSION_IDLE_TIMEOUT);
  }
}

export async function executeDockerCommand(
  session: SSHSession,
  command: string,
  sessionId?: string,
  userId?: string,
  hostId?: number,
): Promise<string> {
  const startTime = Date.now();
  sshLogger.info("Executing Docker command", {
    operation: "docker_command_exec",
    sessionId,
    userId,
    hostId,
    command: command.split(" ")[1],
  });
  return new Promise((resolve, reject) => {
    session.client.exec(command, (err, stream) => {
      if (err) {
        sshLogger.error("Docker command execution error", err, {
          operation: "execute_docker_command",
          sessionId,
          userId,
          hostId,
          command: command.split(" ")[1],
        });
        return reject(err);
      }

      let stdout = "";
      let stderr = "";

      stream.on("close", (code: number) => {
        if (code !== 0) {
          sshLogger.error("Docker command failed", undefined, {
            operation: "execute_docker_command",
            sessionId,
            userId,
            hostId,
            command: command.split(" ")[1],
            exitCode: code,
            stderr,
          });
          reject(new Error(stderr || `Command exited with code ${code}`));
        } else {
          sshLogger.success("Docker command completed", {
            operation: "docker_command_success",
            sessionId,
            userId,
            hostId,
            command: command.split(" ")[1],
            duration: Date.now() - startTime,
          });
          resolve(stdout);
        }
      });

      stream.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      stream.on("error", (streamErr: Error) => {
        sshLogger.error("Docker command stream error", streamErr, {
          operation: "execute_docker_command",
          sessionId,
          userId,
          hostId,
          command: command.split(" ")[1],
        });
        reject(streamErr);
      });
    });
  });
}
