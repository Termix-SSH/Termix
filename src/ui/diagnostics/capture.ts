/**
 * Hooks that record console output, errors, CSP violations, requests and
 * sockets for a diagnostics report. The page installs them before anything
 * else runs; plugin frames install the console and error part and send what
 * they see to the shell. Every hook calls through to the real thing.
 */
import { redactData, redactUrl } from "./redact";
import {
  addConsole,
  addError,
  addNetwork,
  addSocket,
  clip,
  type ConsoleEntry,
  type ConsoleLevel,
  type ErrorEntry,
} from "./store";

const LEVELS: ConsoleLevel[] = ["debug", "log", "info", "warn", "error"];

/** A JSON-safe copy with loops cut, so masking can walk it. */
function plainCopy(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (!value || typeof value !== "object") {
    return typeof value === "bigint" ? String(value) : value;
  }
  if (seen.has(value)) return "[circular]";
  if (depth > 6) return "[deep]";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.slice(0, 50).map((item) => plainCopy(item, seen, depth + 1));
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).slice(0, 50)) {
      out[key] = plainCopy(
        (value as Record<string, unknown>)[key],
        seen,
        depth + 1,
      );
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    return value.stack?.includes(value.message)
      ? value.stack
      : `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  }
  if (value === undefined) return "undefined";
  if (typeof value === "function") return `[function ${value.name || ""}]`;
  if (typeof value !== "object" || value === null) return String(value);
  if (typeof Element !== "undefined" && value instanceof Element) {
    return `<${value.tagName.toLowerCase()}${value.id ? `#${value.id}` : ""}>`;
  }
  try {
    const text = JSON.stringify(redactData(plainCopy(value)));
    return text && text.length > 800 ? `${text.slice(0, 800)}...` : text;
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/** Console arguments as one line, with %s style holes filled in. */
export function formatConsoleArgs(args: unknown[]): string {
  if (typeof args[0] === "string" && /%[sdifoOc]/.test(args[0])) {
    let rest = args.slice(1);
    const head = args[0].replace(/%([sdifoOc])/g, (match, kind: string) => {
      if (!rest.length) return match;
      const [next, ...others] = rest;
      rest = others;
      return kind === "c" ? "" : describeValue(next);
    });
    return [head, ...rest.map(describeValue)].join(" ");
  }
  return args.map(describeValue).join(" ");
}

function errorFields(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: `${error.name}: ${error.message}`, stack: error.stack };
  }
  return { message: describeValue(error) };
}

type Sink = {
  console: (entry: Omit<ConsoleEntry, "at" | "source">) => void;
  error: (entry: Omit<ErrorEntry, "at" | "source">) => void;
};

function hookConsoleAndErrors(target: Window & typeof globalThis, sink: Sink) {
  let inside = false;
  for (const level of LEVELS) {
    const original = target.console[level] as (...args: unknown[]) => void;
    if (typeof original !== "function") continue;
    target.console[level] = (...args: unknown[]) => {
      if (!inside) {
        inside = true;
        try {
          sink.console({ level, text: formatConsoleArgs(args) });
        } catch {
          // Recording must never break logging.
        } finally {
          inside = false;
        }
      }
      original.apply(target.console, args);
    };
  }

  target.addEventListener(
    "error",
    (event: Event) => {
      const element = event.target as Element | null;
      if (element && element !== (target as unknown) && "tagName" in element) {
        const src =
          (element as HTMLScriptElement).src ||
          (element as HTMLLinkElement).href ||
          "";
        sink.error({
          kind: "error",
          message: `Failed to load ${element.tagName.toLowerCase()}`,
          where: src ? redactUrl(src) : undefined,
        });
        return;
      }
      const errorEvent = event as ErrorEvent;
      const fields = errorFields(errorEvent.error ?? errorEvent.message);
      sink.error({
        kind: "error",
        ...fields,
        where: errorEvent.filename
          ? `${redactUrl(errorEvent.filename)}:${errorEvent.lineno}:${errorEvent.colno}`
          : undefined,
      });
    },
    true,
  );

  target.addEventListener("unhandledrejection", (event) => {
    sink.error({ kind: "rejection", ...errorFields(event.reason) });
  });

  target.document?.addEventListener("securitypolicyviolation", (event) => {
    const blocked = event.blockedURI || "";
    sink.error({
      kind: "csp",
      message: `Blocked by ${event.effectiveDirective || event.violatedDirective}`,
      directive: event.effectiveDirective || event.violatedDirective,
      // Keeps extension and scheme names, which say what tried to load.
      blocked: /^[a-z-]+:\/\//i.test(blocked)
        ? redactUrl(blocked)
        : blocked.slice(0, 100),
      where: event.sourceFile ? redactUrl(event.sourceFile) : undefined,
    });
  });
}

function sizeOf(value: string | null): number | null {
  const n = value === null ? NaN : Number(value);
  return Number.isFinite(n) ? n : null;
}

function hookFetch(target: Window & typeof globalThis) {
  const original = target.fetch;
  if (typeof original !== "function") return;
  target.fetch = async function capturedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    const started = performance.now();
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (
      init?.method ??
      (typeof input === "object" && "method" in input ? input.method : "GET")
    ).toUpperCase();
    try {
      const response = await original.call(target, input, init);
      try {
        addNetwork({
          via: "fetch",
          source: "page",
          method,
          url: redactUrl(raw),
          status: response.type === "opaqueredirect" ? 0 : response.status,
          ms: Math.round(performance.now() - started),
          contentType: response.headers.get("content-type"),
          redirected: response.redirected || response.type === "opaqueredirect",
          ...(response.url && response.url !== new URL(raw, location.href).href
            ? { finalUrl: redactUrl(response.url) }
            : {}),
          bytes: sizeOf(response.headers.get("content-length")),
        });
      } catch {
        // Never break the request over a record.
      }
      return response;
    } catch (error) {
      addNetwork({
        via: "fetch",
        source: "page",
        method,
        url: redactUrl(raw),
        status: null,
        ms: Math.round(performance.now() - started),
        error: clip(error instanceof Error ? error.message : String(error)),
      });
      throw error;
    }
  } as typeof fetch;
}

const xhrInfo = new WeakMap<
  XMLHttpRequest,
  { method: string; url: string; started: number }
>();

function hookXhr(target: Window & typeof globalThis) {
  const proto = target.XMLHttpRequest?.prototype;
  if (!proto) return;
  const open = proto.open;
  const send = proto.send;
  proto.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    xhrInfo.set(this, {
      method: String(method).toUpperCase(),
      url: String(url),
      started: 0,
    });
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof proto.open;
  proto.send = function (this: XMLHttpRequest, body?: unknown) {
    const info = xhrInfo.get(this);
    if (info) {
      info.started = performance.now();
      this.addEventListener("loadend", () => {
        try {
          const finalUrl = this.responseURL;
          addNetwork({
            via: "xhr",
            source: "page",
            method: info.method,
            url: redactUrl(info.url),
            status: this.status || null,
            ms: Math.round(performance.now() - info.started),
            contentType: this.status
              ? this.getResponseHeader("content-type")
              : null,
            ...(finalUrl && finalUrl !== new URL(info.url, location.href).href
              ? { finalUrl: redactUrl(finalUrl), redirected: true }
              : {}),
            bytes: this.status
              ? sizeOf(this.getResponseHeader("content-length"))
              : null,
            ...(this.status === 0
              ? { error: "No answer (network or CORS)" }
              : {}),
          });
        } catch {
          // Never break the request over a record.
        }
      });
    }
    return send.call(this, body as XMLHttpRequestBodyInit);
  };
}

function hookWebSocket(target: Window & typeof globalThis) {
  const Base = target.WebSocket;
  if (typeof Base !== "function") return;
  class CapturedWebSocket extends Base {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const opened = performance.now();
      const shown = redactUrl(String(url));
      this.addEventListener("open", () =>
        addSocket({
          url: shown,
          event: "open",
          afterMs: Math.round(performance.now() - opened),
        }),
      );
      this.addEventListener("close", (event) =>
        addSocket({
          url: shown,
          event: "close",
          code: event.code,
          reason: clip(event.reason || "", 200),
          clean: event.wasClean,
          afterMs: Math.round(performance.now() - opened),
        }),
      );
      this.addEventListener("error", () =>
        addSocket({ url: shown, event: "error" }),
      );
    }
  }
  Object.defineProperty(target, "WebSocket", {
    value: CapturedWebSocket,
    configurable: true,
    writable: true,
  });
}

let pageInstalled = false;

/** Records everything for the shell page. Safe to call more than once. */
export function installPageCapture(
  target: Window & typeof globalThis = window,
): void {
  if (pageInstalled) return;
  pageInstalled = true;
  hookConsoleAndErrors(target, {
    console: (entry) => addConsole({ ...entry, source: "page" }),
    error: (entry) => addError({ ...entry, source: "page" }),
  });
  hookFetch(target);
  hookXhr(target);
  hookWebSocket(target);
}

/** One batch a frame sends to the shell. */
export interface FrameDiagBatch {
  console?: Array<{ level: string; text: string; at: string }>;
  errors?: Array<Omit<ErrorEntry, "source">>;
}

const FRAME_QUEUE_MAX = 200;
const FRAME_BATCH_MAX = 50;
const FRAME_FLUSH_MS = 1000;

let frameInstalled = false;
let frameQueue: FrameDiagBatch = { console: [], errors: [] };
let frameSend: ((batch: FrameDiagBatch) => void) | null = null;
let frameTimer: ReturnType<typeof setTimeout> | null = null;

function flushFrame() {
  frameTimer = null;
  if (!frameSend) return;
  const batch: FrameDiagBatch = {
    console: frameQueue.console!.splice(0, FRAME_BATCH_MAX),
    errors: frameQueue.errors!.splice(0, FRAME_BATCH_MAX),
  };
  if (batch.console!.length || batch.errors!.length) {
    try {
      frameSend(batch);
    } catch {
      // The shell went away; nothing to do.
    }
  }
  if (frameQueue.console!.length || frameQueue.errors!.length) scheduleFrame();
}

function scheduleFrame() {
  if (frameTimer || !frameSend) return;
  frameTimer = setTimeout(flushFrame, FRAME_FLUSH_MS);
}

function queueFrame<K extends "console" | "errors">(
  key: K,
  item: NonNullable<FrameDiagBatch[K]>[number],
) {
  const list = frameQueue[key] as unknown[];
  list.push(item);
  if (list.length > FRAME_QUEUE_MAX) list.shift();
  scheduleFrame();
}

/** Records console and errors in a plugin frame until the shell is there. */
export function installFrameCapture(
  target: Window & typeof globalThis = window,
): void {
  if (frameInstalled) return;
  frameInstalled = true;
  hookConsoleAndErrors(target, {
    console: (entry) =>
      queueFrame("console", {
        level: entry.level,
        text: clip(entry.text),
        at: new Date().toISOString(),
      }),
    error: (entry) =>
      queueFrame("errors", {
        ...entry,
        message: clip(entry.message),
        ...(entry.stack ? { stack: clip(entry.stack, 4000) } : {}),
        at: new Date().toISOString(),
      }),
  });
}

/** Starts sending what the frame recorded to the shell. */
export function connectFrameCapture(send: (batch: FrameDiagBatch) => void) {
  frameSend = send;
  scheduleFrame();
}

/** Test seam. */
export function resetFrameCapture(): void {
  frameInstalled = false;
  frameQueue = { console: [], errors: [] };
  frameSend = null;
  if (frameTimer) clearTimeout(frameTimer);
  frameTimer = null;
}
