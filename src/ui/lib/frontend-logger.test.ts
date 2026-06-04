import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiLogger } from "./frontend-logger.js";

// The formatting helpers (status/performance icons, URL sanitization) are
// private, so we exercise them through the public request* methods and assert
// on what gets written to the console.
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let groupSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
  vi.spyOn(console, "groupEnd").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function allLoggedText(): string {
  return logSpy.mock.calls
    .concat(errorSpy.mock.calls)
    .concat(groupSpy.mock.calls)
    .map((args) => args.join(" "))
    .join("\n");
}

describe("frontend logger request success", () => {
  it("includes the success status icon and a fast-performance icon", () => {
    apiLogger.requestSuccess("get", "https://x.test/api", 200, 50);
    const text = allLoggedText();
    expect(text).toContain("✅"); // 2xx status icon
    expect(text).toContain("⚡"); // <100ms performance icon
    expect(text).toContain("200");
  });

  it("uses the slow-performance icon for long requests", () => {
    apiLogger.requestSuccess("get", "https://x.test/api", 200, 4000);
    expect(allLoggedText()).toContain("🐌");
  });
});

describe("frontend logger error mapping", () => {
  it("uses a client-error icon for 4xx responses", () => {
    apiLogger.requestError("get", "https://x.test/api", 404, "Not Found", 30);
    expect(allLoggedText()).toContain("⚠️");
  });

  it("uses a server-error icon for 5xx responses", () => {
    apiLogger.requestError("get", "https://x.test/api", 500, "Boom", 30);
    expect(allLoggedText()).toContain("❌");
  });
});

describe("frontend logger URL sanitization", () => {
  it("strips password/token query params from logged URLs", () => {
    apiLogger.requestStart("get", "https://x.test/login?password=hunter2");
    const text = allLoggedText();
    expect(text).not.toContain("hunter2");
  });

  it("keeps a normal URL intact", () => {
    apiLogger.requestStart("get", "https://x.test/api/hosts");
    expect(allLoggedText()).toContain("x.test/api/hosts");
  });
});
