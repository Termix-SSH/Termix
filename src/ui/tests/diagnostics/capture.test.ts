import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  connectFrameCapture,
  formatConsoleArgs,
  installFrameCapture,
  installPageCapture,
  resetFrameCapture,
  type FrameDiagBatch,
} from "@/diagnostics/capture";
import {
  captureSnapshot,
  LIMITS,
  addConsole,
  resetCaptureStore,
} from "@/diagnostics/store";
import {
  receiveFrameDiag,
  resetFrameDiagBudgets,
} from "@/diagnostics/frame-diag";

beforeEach(() => {
  resetCaptureStore();
  resetFrameDiagBudgets();
});

describe("formatConsoleArgs", () => {
  it("fills holes and describes values", () => {
    expect(formatConsoleArgs(["%s failed %d", "load", 3, { a: 1 }])).toBe(
      'load failed 3 {"a":1}',
    );
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(formatConsoleArgs([loop])).toBe('{"self":"[circular]"}');
    expect(formatConsoleArgs([{ password: "x" }])).toBe(
      '{"password":"[MASKED]"}',
    );
  });
});

describe("store", () => {
  it("caps lists and counts what it dropped", () => {
    for (let i = 0; i < LIMITS.console + 5; i++) {
      addConsole({ level: "log", source: "page", text: `n${i}` });
    }
    const snapshot = captureSnapshot();
    expect(snapshot.console).toHaveLength(LIMITS.console);
    expect(snapshot.dropped.console).toBe(5);
    expect(snapshot.console[0].text).toBe("n5");
  });

  it("masks text on the way in", () => {
    addConsole({ level: "log", source: "page", text: "Bearer secret123" });
    expect(captureSnapshot().console[0].text).toBe("Bearer [MASKED]");
  });
});

describe("page capture", () => {
  const fetchMock = vi.fn(
    async () =>
      new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  );

  beforeAll(() => {
    console.warn = vi.fn() as unknown as typeof console.warn;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    installPageCapture(window);
  });

  it("records console calls and still calls through", () => {
    console.warn("careful", 1);
    expect(captureSnapshot().console.at(-1)).toMatchObject({
      level: "warn",
      source: "page",
      text: "careful 1",
    });
  });

  it("records fetches with masked URLs", async () => {
    const response = await fetch("/plugin-assets/ai/frontend.js?token=abc");
    expect(response.status).toBe(200);
    const entry = captureSnapshot().network.at(-1)!;
    expect(entry).toMatchObject({
      via: "fetch",
      method: "GET",
      status: 200,
      contentType: "text/html",
    });
    expect(entry.url).toContain("/plugin-assets/ai/frontend.js?token=...");
  });

  it("records uncaught errors and rejections", () => {
    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("boom"), message: "boom" }),
    );
    const rejection = new Event("unhandledrejection") as Event & {
      reason: unknown;
    };
    rejection.reason = new Error("nope");
    window.dispatchEvent(rejection);
    const errors = captureSnapshot().errors;
    expect(errors.map((e) => e.kind)).toEqual(["error", "rejection"]);
    expect(errors[0].message).toBe("Error: boom");
  });
});

describe("frames", () => {
  afterEach(() => resetFrameCapture());

  it("queues until connected, then sends batches", async () => {
    vi.useFakeTimers();
    const frameWindow = {
      console: {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      },
      addEventListener: vi.fn(),
      document: { addEventListener: vi.fn() },
    } as unknown as Window & typeof globalThis;
    installFrameCapture(frameWindow);
    frameWindow.console.error("frame broke");
    const sent: FrameDiagBatch[] = [];
    connectFrameCapture((batch) => sent.push(batch));
    await vi.advanceTimersByTimeAsync(1100);
    expect(sent).toHaveLength(1);
    expect(sent[0].console?.[0]).toMatchObject({
      level: "error",
      text: "frame broke",
    });
    vi.useRealTimers();
  });

  it("tags frame lines with the connection's plugin and caps them", () => {
    receiveFrameDiag("docker", {
      console: [
        { level: "warn", text: "hi", source: "core" },
        { level: "bogus", text: "x" },
        { level: "log" },
      ],
      errors: [
        { kind: "csp", message: "Blocked", blocked: "chrome-extension://x" },
      ],
    });
    const snapshot = captureSnapshot();
    expect(snapshot.console).toEqual([
      expect.objectContaining({ source: "docker", text: "hi", level: "warn" }),
    ]);
    expect(snapshot.errors[0]).toMatchObject({ source: "docker", kind: "csp" });

    for (let i = 0; i < 10; i++) {
      receiveFrameDiag("spam", {
        console: Array.from({ length: 50 }, () => ({
          level: "log",
          text: "x",
        })),
      });
    }
    const spam = captureSnapshot().console.filter((c) => c.source === "spam");
    expect(spam.length).toBe(300);
  });

  it("ignores junk", () => {
    receiveFrameDiag("a", null);
    receiveFrameDiag("a", "text");
    receiveFrameDiag("a", { console: "no" });
    expect(captureSnapshot().console).toHaveLength(0);
  });
});
