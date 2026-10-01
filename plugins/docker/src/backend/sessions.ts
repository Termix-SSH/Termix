import type { Client } from "ssh2";
import type { PluginSchedule } from "@termix/plugin-sdk/backend";
import type { ContainerRuntime } from "./container-runtime.js";
import type { DockerLogger } from "./helpers.js";

const SESSION_IDLE_MS = 60 * 60 * 1000;
const PENDING_SWEEP_MS = 60 * 1000;

/** A live SSH connection behind the Docker panel, owned by one user. */
export interface DockerSession {
  id: string;
  client: Client;
  dispose: () => void;
  hostId: number;
  userId: string;
  runtime: ContainerRuntime;
  isWindows: boolean;
  lastActive: number;
  activeOperations: number;
  cancelIdle?: () => void;
}

/** A connect still waiting on a person (TOTP, a browser sign-in). */
export interface PendingEntry {
  userId: string;
  hostId: number;
  expiresAt: number;
  /** Gives up: answers the open prompt with nothing. */
  cancel: () => void;
}

export interface DockerSessions {
  add: (session: DockerSession) => void;
  /** The session when `userId` owns it. */
  get: (id: string, userId: string) => DockerSession | undefined;
  close: (id: string) => void;
  touch: (session: DockerSession) => void;
  /** Runs `fn` with the session marked busy, so idle cleanup waits. */
  run: <T>(session: DockerSession, fn: () => Promise<T>) => Promise<T>;
  exec: (session: DockerSession, command: string) => Promise<string>;
  setPending: (id: string, entry: PendingEntry) => void;
  getPending: (id: string) => PendingEntry | undefined;
  clearPending: (id: string) => void;
  closeAll: () => void;
}

/** Runs one command and resolves stdout, rejecting on a non-zero exit. */
export function execOnClient(client: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = "";
      let stderr = "";
      stream.on("close", (code: number) => {
        if (code !== 0 && code !== null && code !== undefined) {
          reject(new Error(stderr || `Command exited with code ${code}`));
        } else {
          resolve(stdout);
        }
      });
      stream.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
      stream.on("error", (streamErr: Error) => reject(streamErr));
    });
  });
}

export function createDockerSessions(
  schedule: PluginSchedule,
  log: DockerLogger,
): DockerSessions {
  const sessions = new Map<string, DockerSession>();
  const pending = new Map<string, PendingEntry>();

  const end = (session: DockerSession) => {
    session.cancelIdle?.();
    sessions.delete(session.id);
    session.dispose();
  };

  const scheduleIdle = (session: DockerSession) => {
    session.cancelIdle?.();
    session.cancelIdle = schedule.after(SESSION_IDLE_MS, () => {
      if (sessions.get(session.id) !== session) return;
      if (session.activeOperations > 0) {
        scheduleIdle(session);
        return;
      }
      end(session);
    });
  };

  schedule.every(PENDING_SWEEP_MS, () => {
    const now = Date.now();
    for (const [id, entry] of pending) {
      if (now < entry.expiresAt) continue;
      pending.delete(id);
      entry.cancel();
    }
  });

  return {
    add: (session) => {
      const existing = sessions.get(session.id);
      if (existing) end(existing);
      sessions.set(session.id, session);
      session.client.once("close", () => {
        if (sessions.get(session.id) === session) {
          session.cancelIdle?.();
          sessions.delete(session.id);
        }
      });
      scheduleIdle(session);
    },

    get: (id, userId) => {
      const session = sessions.get(id);
      return session && session.userId === userId ? session : undefined;
    },

    close: (id) => {
      const session = sessions.get(id);
      if (session) end(session);
      const entry = pending.get(id);
      if (entry) {
        pending.delete(id);
        entry.cancel();
      }
    },

    touch: (session) => {
      session.lastActive = Date.now();
      scheduleIdle(session);
    },

    run: async (session, fn) => {
      session.lastActive = Date.now();
      session.activeOperations++;
      try {
        return await fn();
      } finally {
        session.activeOperations--;
      }
    },

    exec: async (session, command) => {
      const started = Date.now();
      try {
        return await execOnClient(session.client, command);
      } catch (error) {
        log.warn("Docker command failed", {
          hostId: session.hostId,
          command: command.split(" ")[2],
          durationMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    setPending: (id, entry) => {
      const existing = pending.get(id);
      if (existing) existing.cancel();
      pending.set(id, entry);
    },

    getPending: (id) => pending.get(id),

    clearPending: (id) => {
      pending.delete(id);
    },

    closeAll: () => {
      for (const session of [...sessions.values()]) end(session);
      for (const entry of pending.values()) entry.cancel();
      pending.clear();
    },
  };
}
