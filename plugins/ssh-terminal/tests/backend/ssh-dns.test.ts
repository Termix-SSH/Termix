import { describe, expect, it, vi } from "vitest";
import {
  pickSshAddress,
  resolveHostForSshConnect,
} from "../../src/backend/helpers.js";

describe("resolveHostForSshConnect", () => {
  it("prefers IPv4 over IPv6", async () => {
    const lookup = vi.fn().mockResolvedValue([
      { address: "fe80::1", family: 6 },
      { address: "192.168.1.20", family: 4 },
    ]);
    const result = await resolveHostForSshConnect("nas", lookup);
    expect(result.host).toBe("192.168.1.20");
  });

  it("keeps an IPv6-only answer", () => {
    expect(pickSshAddress({ address: "2001:db8::5", family: 6 })).toBe(
      "2001:db8::5",
    );
  });
});
