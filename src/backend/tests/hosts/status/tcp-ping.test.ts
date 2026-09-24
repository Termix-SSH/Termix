import type { Client } from "ssh2";
import { describe, expect, it, vi } from "vitest";
import { tcpPingThroughJumpHost } from "../../../hosts/status/tcp-ping.js";

describe("tcpPingThroughJumpHost", () => {
  it("reports the final destination online when forwarding succeeds", async () => {
    const stream = { destroy: vi.fn() };
    const jumpClient = {
      end: vi.fn(),
      forwardOut: vi.fn((_src, _srcPort, host, port, callback) => {
        expect(host).toBe("private.example");
        expect(port).toBe(22);
        callback(undefined, stream);
      }),
    } as unknown as Pick<Client, "forwardOut" | "end">;

    await expect(
      tcpPingThroughJumpHost(jumpClient, "private.example", 22),
    ).resolves.toBe(true);
    expect(stream.destroy).toHaveBeenCalledOnce();
    expect(jumpClient.end).toHaveBeenCalledOnce();
  });

  it("reports the final destination offline when forwarding fails", async () => {
    const jumpClient = {
      end: vi.fn(),
      forwardOut: vi.fn((_src, _srcPort, _host, _port, callback) => {
        callback(new Error("Connection refused"));
      }),
    } as unknown as Pick<Client, "forwardOut" | "end">;

    await expect(
      tcpPingThroughJumpHost(jumpClient, "private.example", 22),
    ).resolves.toBe(false);
    expect(jumpClient.end).toHaveBeenCalledOnce();
  });

  it("reports the final destination offline when forwarding times out", async () => {
    vi.useFakeTimers();
    const jumpClient = {
      end: vi.fn(),
      forwardOut: vi.fn(),
    } as unknown as Pick<Client, "forwardOut" | "end">;

    const result = tcpPingThroughJumpHost(
      jumpClient,
      "private.example",
      22,
      5000,
    );
    await vi.advanceTimersByTimeAsync(5000);

    await expect(result).resolves.toBe(false);
    expect(jumpClient.end).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
