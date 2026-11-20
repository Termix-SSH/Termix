import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
vi.mock("@/i18n/i18n", () => ({
  default: {
    t: (key: string, options?: { count?: number; names?: string }) =>
      options ? `${key}:${options.count}:${options.names}` : key,
  },
}));

import {
  reportFrameFailure,
  resetFrameFailures,
} from "@/plugin-host/frames/frame-failures";

beforeEach(() => {
  resetFrameFailures();
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("reportFrameFailure", () => {
  it("groups failures close together into one toast", () => {
    reportFrameFailure("Docker", "activate() did not finish within 20s");
    reportFrameFailure("Alerts", "other");
    expect(toasts.error).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_500);
    expect(toasts.error).toHaveBeenCalledOnce();
    expect(toasts.error).toHaveBeenCalledWith(
      "plugins.framesFailed:2:Docker, Alerts",
      expect.objectContaining({
        description: "activate() did not finish within 20s",
      }),
    );
  });

  it("tells about each plugin only once", () => {
    reportFrameFailure("Docker", "x");
    vi.advanceTimersByTime(1_500);
    reportFrameFailure("Docker", "x");
    vi.advanceTimersByTime(1_500);
    expect(toasts.error).toHaveBeenCalledOnce();
  });

  it("stays quiet when the login proxy message already showed", () => {
    reportFrameFailure("Docker", "plugins.framesBlocked");
    vi.advanceTimersByTime(1_500);
    expect(toasts.error).not.toHaveBeenCalled();
  });
});
