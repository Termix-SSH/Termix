import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  computeReconnectDelay,
  useConnectionRetry,
} from "../../lib/useConnectionRetry.ts";

describe("connection retry delay", () => {
  it("uses exponential backoff with bounded jitter", () => {
    expect(computeReconnectDelay(1, 2000, 8000, () => 0.5)).toBe(2000);
    expect(computeReconnectDelay(2, 2000, 8000, () => 0)).toBe(3600);
    expect(computeReconnectDelay(2, 2000, 8000, () => 1)).toBe(4400);
  });

  it("never exceeds the configured cap", () => {
    expect(computeReconnectDelay(8, 2000, 8000, () => 1)).toBe(8000);
  });
});

describe("useConnectionRetry", () => {
  it("turns a rejected async connection into a failed state", async () => {
    const connect = vi.fn().mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() =>
      useConnectionRetry({ connect, enabled: false }),
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(connect).toHaveBeenCalledOnce();
  });
});
