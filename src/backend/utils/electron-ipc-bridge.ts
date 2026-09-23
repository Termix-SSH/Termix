/**
 * Request/response layer over the fork IPC channel between the embedded
 * backend and Electron's main process (electron/main.cjs forks this backend
 * with stdio: [..., "ipc"]). Main already sends a one-way "shutdown" message
 * on this channel; this adds a matching request/response shape so the
 * backend can ask main to do something only main can do - open a real
 * BrowserWindow - and get a typed result back.
 *
 * Not available outside Electron: process.send is undefined for a plain
 * `node` or Docker start, and ELECTRON_EMBEDDED distinguishes the embedded
 * backend from a standalone one that happens to run under a process manager
 * that also sets stdio to "ipc".
 */

import crypto from "node:crypto";
import { systemLogger } from "./logger.js";

const REQUEST_TIMEOUT_MS = 15_000;

interface ElectronIpcRequestMessage {
  type: "backend-request";
  id: string;
  channel: string;
  payload: unknown;
}

interface ElectronIpcResponseMessage {
  type: "backend-response";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

function isResponseMessage(msg: unknown): msg is ElectronIpcResponseMessage {
  return (
    !!msg &&
    typeof msg === "object" &&
    (msg as { type?: unknown }).type === "backend-response"
  );
}

export function isElectronIpcAvailable(): boolean {
  return (
    process.env.ELECTRON_EMBEDDED === "true" &&
    typeof process.send === "function"
  );
}

const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

let listening = false;

function ensureListening(): void {
  if (listening) return;
  listening = true;
  process.on("message", (msg: unknown) => {
    if (!isResponseMessage(msg)) return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.ok) waiter.resolve(msg.result);
    else waiter.reject(new Error(msg.error || "Electron IPC request failed"));
  });
}

/**
 * Sends a request to Electron's main process over the fork IPC channel and
 * waits for its response. Rejects if main never answers (main.cjs is where
 * a killed or hung renderer would surface, not here) or process.send is
 * unavailable.
 */
export async function requestFromElectronMain<T = unknown>(
  channel: string,
  payload: unknown,
): Promise<T> {
  if (!isElectronIpcAvailable()) {
    throw new Error("Electron IPC is only available in the desktop app");
  }
  ensureListening();

  const id = crypto.randomUUID();
  const message: ElectronIpcRequestMessage = {
    type: "backend-request",
    id,
    channel,
    payload,
  };

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Electron IPC request "${channel}" timed out`));
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value as T);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });

    try {
      process.send?.(message);
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      systemLogger.warn("Failed to send Electron IPC request", {
        operation: "electron_ipc_send_failed",
        channel,
        error: error instanceof Error ? error.message : String(error),
      });
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
