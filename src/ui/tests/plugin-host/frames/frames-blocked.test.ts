import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
vi.mock("@/i18n/i18n", () => ({ default: { t: (key: string) => key } }));

import {
  frameBlockedReason,
  framesBlocked,
  resetFramesBlocked,
} from "@/plugin-host/frames/frames-blocked";

const fetchMock = vi.fn();

beforeEach(() => {
  resetFramesBlocked();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("framesBlocked", () => {
  it.each([
    [{ type: "opaqueredirect", status: 0 }],
    [{ type: "basic", status: 401 }],
    [{ type: "basic", status: 403 }],
  ])("blames a proxy for %o", async (response) => {
    fetchMock.mockResolvedValue(response);
    expect(await framesBlocked("demo")).toBe(true);
  });

  it("asks without cookies and does not follow redirects", async () => {
    fetchMock.mockResolvedValue({ type: "basic", status: 200 });
    expect(await framesBlocked("demo")).toBe(false);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/plugin-assets/demo/_frame/frame.html");
    expect(init).toMatchObject({ credentials: "omit", redirect: "manual" });
  });

  it("says nothing when the check itself fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await framesBlocked("demo")).toBe(false);
  });

  it("checks once and warns once", async () => {
    fetchMock.mockResolvedValue({ type: "opaqueredirect", status: 0 });
    expect(await frameBlockedReason("a")).toBe("plugins.framesBlocked");
    expect(await frameBlockedReason("b")).toBe("plugins.framesBlocked");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toasts.error).toHaveBeenCalledTimes(1);
  });

  it("gives no reason when nothing is in the way", async () => {
    fetchMock.mockResolvedValue({ type: "basic", status: 200 });
    expect(await frameBlockedReason("a")).toBeNull();
    expect(toasts.error).not.toHaveBeenCalled();
  });
});
