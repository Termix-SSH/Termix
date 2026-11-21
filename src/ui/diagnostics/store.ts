/**
 * What the page saw since it loaded, kept in capped lists for a diagnostics
 * report. Everything is masked on the way in.
 */
import { redactText } from "./redact";

export type ConsoleLevel = "debug" | "log" | "info" | "warn" | "error";

export interface ConsoleEntry {
  at: string;
  level: ConsoleLevel;
  /** "page" or the plugin id of the frame it came from. */
  source: string;
  text: string;
}

export interface ErrorEntry {
  at: string;
  kind: "error" | "rejection" | "csp" | "react";
  source: string;
  message: string;
  stack?: string;
  where?: string;
  /** CSP: the directive and the blocked address. */
  directive?: string;
  blocked?: string;
}

export interface NetworkEntry {
  at: string;
  via: "fetch" | "xhr" | "frame";
  source: string;
  method: string;
  url: string;
  status: number | null;
  ms: number | null;
  contentType?: string | null;
  redirected?: boolean;
  finalUrl?: string;
  bytes?: number | null;
  error?: string;
}

export interface SocketEntry {
  at: string;
  url: string;
  event: "open" | "close" | "error";
  code?: number;
  reason?: string;
  clean?: boolean;
  afterMs?: number;
}

export const LIMITS = {
  console: 500,
  errors: 200,
  network: 300,
  sockets: 150,
  text: 2000,
};

export interface CaptureSnapshot {
  startedAt: string;
  console: ConsoleEntry[];
  errors: ErrorEntry[];
  network: NetworkEntry[];
  sockets: SocketEntry[];
  dropped: {
    console: number;
    errors: number;
    network: number;
    sockets: number;
  };
}

const startedAt = new Date().toISOString();
const consoleList: ConsoleEntry[] = [];
const errorList: ErrorEntry[] = [];
const networkList: NetworkEntry[] = [];
const socketList: SocketEntry[] = [];
const dropped = { console: 0, errors: 0, network: 0, sockets: 0 };

function push<T>(
  list: T[],
  item: T,
  max: number,
  key: keyof typeof dropped,
): void {
  list.push(item);
  if (list.length > max) {
    list.shift();
    dropped[key]++;
  }
}

export function clip(text: string, max = LIMITS.text): string {
  const masked = redactText(text);
  return masked.length > max ? `${masked.slice(0, max)}...(cut)` : masked;
}

export function now(): string {
  return new Date().toISOString();
}

export function addConsole(entry: Omit<ConsoleEntry, "at"> & { at?: string }) {
  push(
    consoleList,
    { ...entry, at: entry.at ?? now(), text: clip(entry.text) },
    LIMITS.console,
    "console",
  );
}

export function addError(entry: Omit<ErrorEntry, "at"> & { at?: string }) {
  push(
    errorList,
    {
      ...entry,
      at: entry.at ?? now(),
      message: clip(entry.message),
      ...(entry.stack ? { stack: clip(entry.stack, 4000) } : {}),
    },
    LIMITS.errors,
    "errors",
  );
}

export function addNetwork(entry: Omit<NetworkEntry, "at">) {
  push(networkList, { ...entry, at: now() }, LIMITS.network, "network");
}

export function addSocket(entry: Omit<SocketEntry, "at">) {
  push(socketList, { ...entry, at: now() }, LIMITS.sockets, "sockets");
}

export function captureSnapshot(): CaptureSnapshot {
  return {
    startedAt,
    console: [...consoleList],
    errors: [...errorList],
    network: [...networkList],
    sockets: [...socketList],
    dropped: { ...dropped },
  };
}

/** Test seam. */
export function resetCaptureStore(): void {
  consoleList.length = 0;
  errorList.length = 0;
  networkList.length = 0;
  socketList.length = 0;
  dropped.console = dropped.errors = dropped.network = dropped.sockets = 0;
}
