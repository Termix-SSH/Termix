import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  isElectronIpcAvailable,
  requestFromElectronMain,
} from "../../utils/electron-ipc-bridge.js";

const originalEnv = process.env.ELECTRON_EMBEDDED;
const originalSend = process.send;

beforeEach(() => {
  process.env.ELECTRON_EMBEDDED = "true";
});

afterEach(() => {
  process.env.ELECTRON_EMBEDDED = originalEnv;
  process.send = originalSend;
});

describe("isElectronIpcAvailable", () => {
  it("is false outside the embedded desktop backend", () => {
    delete process.env.ELECTRON_EMBEDDED;
    process.send = (() => true) as typeof process.send;
    expect(isElectronIpcAvailable()).toBe(false);
  });

  it("is false when there is no fork IPC channel", () => {
    process.send = undefined;
    expect(isElectronIpcAvailable()).toBe(false);
  });

  it("is true when embedded with a live channel", () => {
    process.send = (() => true) as typeof process.send;
    expect(isElectronIpcAvailable()).toBe(true);
  });
});

describe("requestFromElectronMain", () => {
  it("refuses when Electron IPC is unavailable", async () => {
    process.send = undefined;
    await expect(
      requestFromElectronMain("open-isolated-window", {}),
    ).rejects.toThrow(/desktop app/);
  });

  // The module attaches its "message" listener to the real process.on only
  // once, the first time requestFromElectronMain actually reaches that point
  // (ensureListening's module-scoped flag mirrors how a real forked
  // process's IPC channel is a single persistent thing it listens on for the
  // process lifetime). vi.spyOn(process, "on") does not reliably intercept
  // that call in this environment, so this replaces process.on directly for
  // the one call the module makes and hands the captured listener a plain
  // function this file can invoke to simulate a message from main -
  // simpler and more direct than getting a spy to survive across a Node
  // global.
  let deliver: (msg: unknown) => void = () => {};

  beforeAll(() => {
    const originalOn = process.on.bind(process);
    process.on = ((event: string, listener: (...args: unknown[]) => void) => {
      if (event === "message") {
        deliver = listener;
        return process;
      }
      return originalOn(event, listener);
    }) as typeof process.on;
  });

  let sent: unknown[] = [];

  beforeEach(() => {
    sent = [];
    process.send = ((msg: unknown) => {
      sent.push(msg);
      return true;
    }) as typeof process.send;
  });

  it("resolves with main's response, matched by request id", async () => {
    const pending = requestFromElectronMain<{ success: true }>(
      "open-isolated-window",
      { url: "https://example.test" },
    );
    const [message] = sent as Array<{
      type: string;
      id: string;
      channel: string;
      payload: unknown;
    }>;
    expect(message).toMatchObject({
      type: "backend-request",
      channel: "open-isolated-window",
      payload: { url: "https://example.test" },
    });

    deliver({
      type: "backend-response",
      id: message.id,
      ok: true,
      result: { success: true },
    });
    await expect(pending).resolves.toEqual({ success: true });
  });

  it("rejects with main's error", async () => {
    const pending = requestFromElectronMain("open-isolated-window", {});
    const [message] = sent as Array<{ id: string }>;

    deliver({
      type: "backend-response",
      id: message.id,
      ok: false,
      error: "refused",
    });
    await expect(pending).rejects.toThrow(/refused/);
  });

  it("ignores a response for a different request id", async () => {
    const pending = requestFromElectronMain("open-isolated-window", {});
    const [message] = sent as Array<{ id: string }>;

    deliver({ type: "backend-response", id: "other", ok: true, result: {} });
    deliver({
      type: "backend-response",
      id: message.id,
      ok: true,
      result: { success: true },
    });
    await expect(pending).resolves.toEqual({ success: true });
  });
});
