import { describe, expect, it } from "vitest";
import {
  counterRate,
  parseNetworkCounters,
} from "../../../../hosts/metrics/widgets/network-collector.js";

const PROC_NET = `Inter-|   Receive                                                |  Transmit
 face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed
  eth0: 1024 1 0 0 0 0 0 0 2048 2 0 0 0 0 0 0
    lo: 4096 4 0 0 0 0 0 0 4096 4 0 0 0 0 0 0`;

describe("network counters", () => {
  it("parses Linux proc counters", () => {
    expect(parseNetworkCounters(PROC_NET).get("eth0")).toEqual({
      rx: "1024",
      tx: "2048",
    });
  });

  it("calculates bytes per second and rejects counter resets", () => {
    expect(counterRate("1000", "2500", 0.5)).toBe(3000);
    expect(counterRate("2500", "1000", 0.5)).toBeNull();
  });
});
