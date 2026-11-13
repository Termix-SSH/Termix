/**
 * Starts a plugin's process. Three ways, picked once per backend:
 *
 *   fork      core forks the child itself (dev, plain Node installs, Docker
 *             run as a fixed user without the launcher);
 *   launcher  Docker: the root launcher that started core starts the child as
 *             the plugin's own Linux user and relays its messages;
 *   electron  desktop: Electron main forks a utility process and hands core a
 *             MessagePort to it, because the app's fuses stop core from
 *             running Node scripts itself.
 *
 * All three give the same Transport, so the bridge does not know which ran.
 */
import { fork } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { Transport, Wire } from "./rpc.js";
import { processTransport } from "./rpc.js";
import {
  hasParentChannel,
  onParentMessage,
  sendToParent,
} from "../../utils/parent-channel.js";

export const SANDBOX_MESSAGE = "tmx-sandbox";

export interface SpawnRequest {
  pluginId: string;
  /** The child runtime script. */
  runtimePath: string;
  execArgv: string[];
  env: Record<string, string>;
  /** The data folder the plugin may write, made and handed to its user. */
  dataDir: string;
  /** Firewall rule for the plugin's user (launcher only). */
  firewall: "deny" | "allow-all";
}

export interface SpawnedChild {
  transport: Transport;
  pid?: number;
  /** Lines the child wrote to stdout or stderr. */
  onOutput(listener: (stream: "out" | "err", line: string) => void): void;
  onExit(listener: (code: number | null, signal: string | null) => void): void;
  kill(): void;
}

export type SpawnMode = "fork" | "launcher" | "electron";

export interface Spawner {
  readonly mode: SpawnMode;
  spawn(request: SpawnRequest): Promise<SpawnedChild>;
}

function splitLines(
  stream: Readable | null | undefined,
  kind: "out" | "err",
  emit: (stream: "out" | "err", line: string) => void,
): void {
  if (!stream) return;
  let buffer = "";
  stream.setEncoding?.("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 64 * 1024) {
      emit(kind, buffer.slice(0, 64 * 1024));
      buffer = "";
    }
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      if (line) emit(kind, line);
      index = buffer.indexOf("\n");
    }
  });
}

/** core forks the child. */
export const forkSpawner: Spawner = {
  mode: "fork",
  async spawn(request) {
    const fs = await import("node:fs");
    fs.mkdirSync(request.dataDir, { recursive: true });
    const child = fork(request.runtimePath, [], {
      execArgv: request.execArgv,
      serialization: "advanced",
      env: request.env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    });
    const output = new EventEmitter();
    splitLines(child.stdout, "out", (s, l) => output.emit("line", s, l));
    splitLines(child.stderr, "err", (s, l) => output.emit("line", s, l));
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
    return {
      transport: processTransport(child),
      pid: child.pid,
      onOutput: (listener) => output.on("line", listener),
      onExit: (listener) => child.once("exit", listener),
      kill: () => {
        if (child.exitCode === null) child.kill("SIGKILL");
      },
    };
  },
};

type ParentReply = {
  type: typeof SANDBOX_MESSAGE;
  op: "spawned" | "error" | "msg" | "exit" | "log";
  id: string;
  pid?: number;
  message?: string;
  m?: Wire;
  code?: number | null;
  signal?: string | null;
  stream?: "out" | "err";
  line?: string;
};

interface RelayChild {
  emitter: EventEmitter;
  port?: MessagePortLike;
}

interface MessagePortLike {
  postMessage(message: unknown): void;
  on?(event: "message", listener: (event: { data: unknown }) => void): unknown;
  addEventListener?(
    event: "message",
    listener: (event: { data: unknown }) => void,
  ): unknown;
  start?(): void;
  close?(): void;
}

/**
 * The launcher and Electron main speak the same small protocol. The
 * launcher relays every message; Electron hands over a MessagePort instead.
 */
export function relaySpawner(mode: "launcher" | "electron"): Spawner {
  const children = new Map<string, RelayChild>();
  let listening = false;

  const listen = () => {
    if (listening) return;
    listening = true;
    onParentMessage((raw, ports) => {
      const message = raw as ParentReply;
      if (!message || message.type !== SANDBOX_MESSAGE) return;
      const child = children.get(String(message.id));
      if (!child) return;
      switch (message.op) {
        case "spawned":
          if (ports?.[0]) child.port = ports[0] as MessagePortLike;
          child.emitter.emit("spawned", message.pid);
          return;
        case "error":
          child.emitter.emit(
            "failed",
            new Error(message.message ?? "spawn failed"),
          );
          return;
        case "msg":
          if (message.m) child.emitter.emit("wire", message.m);
          return;
        case "log":
          child.emitter.emit(
            "line",
            message.stream === "err" ? "err" : "out",
            String(message.line ?? ""),
          );
          return;
        case "exit":
          children.delete(String(message.id));
          child.emitter.emit(
            "exit",
            message.code ?? null,
            message.signal ?? null,
          );
          return;
      }
    });
  };

  return {
    mode,
    async spawn(request) {
      listen();
      const id = randomUUID();
      const emitter = new EventEmitter();
      const child: RelayChild = { emitter };
      children.set(id, child);
      sendToParent({
        type: SANDBOX_MESSAGE,
        op: "spawn",
        id,
        pluginId: request.pluginId,
        execArgv: request.execArgv,
        env: request.env,
        dataDir: request.dataDir,
        firewall: request.firewall,
      });
      const pid = await new Promise<number | undefined>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("The plugin process did not start")),
          15_000,
        );
        emitter.once("spawned", (value: number | undefined) => {
          clearTimeout(timer);
          resolve(value);
        });
        emitter.once("failed", (error: Error) => {
          clearTimeout(timer);
          children.delete(id);
          reject(error);
        });
      });

      let transport: Transport;
      if (mode === "electron") {
        const port = child.port;
        if (!port) throw new Error("The desktop app sent no channel");
        transport = {
          send: (message) => port.postMessage(message),
          onMessage: (handler) => {
            const listener = (event: { data: unknown }) =>
              handler(event.data as Wire);
            if (port.on) port.on("message", listener);
            else port.addEventListener?.("message", listener);
            port.start?.();
          },
        };
      } else {
        transport = {
          send: (message) =>
            void sendToParent({
              type: SANDBOX_MESSAGE,
              op: "msg",
              id,
              m: message,
            }),
          onMessage: (handler) => emitter.on("wire", handler),
        };
      }
      return {
        transport,
        pid,
        onOutput: (listener) => emitter.on("line", listener),
        onExit: (listener) =>
          emitter.once("exit", (code: number | null, signal: string | null) => {
            child.port?.close?.();
            listener(code, signal);
          }),
        kill: () => {
          sendToParent({ type: SANDBOX_MESSAGE, op: "kill", id });
        },
      };
    },
  };
}

let chosen: Spawner | null = null;

/** Test seam. */
export function setSpawner(spawner: Spawner | null): void {
  chosen = spawner;
}

export function getSpawner(): Spawner {
  if (chosen) return chosen;
  const parentPort = (process as unknown as { parentPort?: unknown })
    .parentPort;
  if (process.env.ELECTRON_EMBEDDED === "true" && parentPort) {
    chosen = relaySpawner("electron");
  } else if (process.env.TERMIX_PLUGIN_LAUNCHER === "1" && hasParentChannel()) {
    chosen = relaySpawner("launcher");
  } else {
    chosen = forkSpawner;
  }
  return chosen;
}
