import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSummary } from "@/api/plugins-api";

vi.mock("@/auth/StepUpPrompt", () => ({ requestStepUp: vi.fn() }));

import {
  connectFrame,
  resetFrameConnections,
} from "@/plugin-host/frames/frame-connection";
import {
  parseSerialOptions,
  resetSerialBridge,
} from "@/plugin-host/frames/serial-bridge";
import {
  resetPluginStore,
  setPluginSummaries,
} from "@/plugin-host/plugin-store";
import { FRAME_CHANNEL } from "@/plugin-frame/protocol";

const summary = (id: string, capabilities: string[]): PluginSummary =>
  ({
    id,
    name: id,
    version: "1.0.0",
    enabled: true,
    state: "active",
    frontend: true,
    frontendIsolation: "frame",
    capabilities,
    contributes: {},
  }) as unknown as PluginSummary;

interface FakePort {
  opened: Record<string, unknown> | null;
  closed: boolean;
  written: Uint8Array[];
  push: (bytes: Uint8Array) => void;
  open: (options: Record<string, unknown>) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

function fakePort(): FakePort {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const port: FakePort = {
    opened: null,
    closed: false,
    written: [],
    push: (bytes) => controller.enqueue(bytes),
    open: async (options) => {
      port.opened = options;
    },
    close: async () => {
      port.closed = true;
    },
    readable: new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        port.written.push(chunk);
      },
    }),
  };
  return port;
}

let iframe: HTMLIFrameElement;
let frameCalls: Array<Record<string, unknown>>;
let replies: Array<Record<string, unknown>>;
let port: FakePort;
let requestPort: ReturnType<typeof vi.fn>;
let active = true;

function send(data: unknown, source: unknown = iframe.contentWindow) {
  window.dispatchEvent(
    new MessageEvent("message", { data, source: source as Window }),
  );
}

async function call(method: string, args: unknown[] = []) {
  const id = Math.floor(Math.random() * 1e9);
  send({ ch: FRAME_CHANNEL, t: "call", id, method, args });
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reply = replies.find((entry) => entry.id === id);
    if (reply) return reply;
  }
  throw new Error(`no reply to ${method}`);
}

function hello(pluginId: string) {
  connectFrame(iframe, pluginId, "view", `tab:${pluginId}`, {});
  send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: `tab:${pluginId}` });
}

const click = () =>
  send({ ch: FRAME_CHANNEL, t: "event", name: "pointer", data: null });

const OPTIONS = { baudRate: 115200, dataBits: 8, stopBits: 1, parity: "none" };
const CALLBACKS = [{ $fn: "f1" }, { $fn: "f2" }];

beforeEach(() => {
  resetPluginStore();
  setPluginSummaries([
    summary("serial", ["device:serial"]),
    summary("snoop", ["network:outbound"]),
  ]);
  port = fakePort();
  requestPort = vi.fn(async () => port);
  active = true;
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: { requestPort },
  });
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    get: () => ({ isActive: active }),
  });
  iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  replies = [];
  frameCalls = [];
  vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(
    (message: unknown) => {
      const entry = message as Record<string, unknown>;
      if (entry.t === "reply") replies.push(entry);
      if (entry.t === "call") frameCalls.push(entry);
    },
  );
});

afterEach(() => {
  resetFrameConnections();
  resetSerialBridge();
  iframe.remove();
  vi.restoreAllMocks();
  delete (navigator as unknown as Record<string, unknown>).serial;
  delete (navigator as unknown as Record<string, unknown>).userActivation;
});

describe("serial bridge", () => {
  it("opens only the port the person picked and hands back a handle", async () => {
    hello("serial");
    click();
    const reply = await call("port.request", [OPTIONS, ...CALLBACKS]);
    expect(reply).toMatchObject({ ok: true });
    const handle = reply.value as string;
    expect(handle).toMatch(/^serial-\d+$/);
    expect(port.opened).toEqual({
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
    });

    port.push(new Uint8Array([104, 105]));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const data = frameCalls.find(
      (entry) => (entry.args as unknown[])[0] === "f1",
    );
    expect(data).toBeTruthy();

    expect(
      await call("port.write", [handle, new Uint8Array([1, 2])]),
    ).toMatchObject({ ok: true });
    expect(port.written).toHaveLength(1);
    expect(await call("port.close", [handle])).toMatchObject({ ok: true });
    expect(port.closed).toBe(true);
  });

  it("refuses a plugin without device:serial", async () => {
    hello("snoop");
    click();
    expect(await call("port.request", [OPTIONS, ...CALLBACKS])).toMatchObject({
      ok: false,
    });
    expect(requestPort).not.toHaveBeenCalled();
  });

  it("refuses without real user activation, even if the frame says it was clicked", async () => {
    hello("serial");
    expect(await call("port.request", [OPTIONS, ...CALLBACKS])).toMatchObject({
      ok: false,
    });
    active = false;
    click();
    expect(await call("port.request", [OPTIONS, ...CALLBACKS])).toMatchObject({
      ok: false,
    });
    expect(requestPort).not.toHaveBeenCalled();
  });

  it("refuses handles it never gave this frame", async () => {
    hello("serial");
    click();
    const reply = await call("port.request", [OPTIONS, ...CALLBACKS]);
    const handle = reply.value as string;

    const other = document.createElement("iframe");
    document.body.appendChild(other);
    const otherReplies: Array<Record<string, unknown>> = [];
    vi.spyOn(other.contentWindow!, "postMessage").mockImplementation(
      (message: unknown) => {
        const entry = message as Record<string, unknown>;
        if (entry.t === "reply") otherReplies.push(entry);
      },
    );
    connectFrame(other, "serial", "view", "tab:serial2", {});
    send(
      { ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:serial2" },
      other.contentWindow,
    );
    send(
      {
        ch: FRAME_CHANNEL,
        t: "call",
        id: 7,
        method: "port.write",
        args: [handle, new Uint8Array([1])],
      },
      other.contentWindow,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(otherReplies.find((entry) => entry.id === 7)).toMatchObject({
      ok: false,
    });
    expect(port.written).toHaveLength(0);
    other.remove();
  });

  it("closes the frame's ports when it reloads", async () => {
    hello("serial");
    click();
    await call("port.request", [OPTIONS, ...CALLBACKS]);
    send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:serial" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(port.closed).toBe(true);
  });

  it("reports a closed picker as no port", async () => {
    requestPort.mockRejectedValueOnce(
      Object.assign(new Error("none"), { name: "NotFoundError" }),
    );
    hello("serial");
    click();
    expect(await call("port.request", [OPTIONS, ...CALLBACKS])).toMatchObject({
      ok: true,
      value: null,
    });
  });
});

describe("parseSerialOptions", () => {
  it("takes only known settings", () => {
    expect(parseSerialOptions({ baudRate: 9600 })).toEqual({
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
    });
    expect(parseSerialOptions({ baudRate: 12345 })).toBeNull();
    expect(parseSerialOptions({ baudRate: 9600, parity: "mark" })).toBeNull();
    expect(
      parseSerialOptions({ baudRate: 9600, filters: [{ usbProductId: 1 }] }),
    ).toBeNull();
    expect(
      parseSerialOptions({
        baudRate: 9600,
        filters: [{ usbVendorId: 0x2341, extra: "x" }],
      }),
    ).toEqual({
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      filters: [{ usbVendorId: 0x2341 }],
    });
    expect(parseSerialOptions(null)).toBeNull();
  });
});
