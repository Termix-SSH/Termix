import { describe, expect, it } from "vitest";
import type { SSHHostWithStatus } from "@/main-axios";
import { sshHostToHost } from "@/sidebar/HostManagerData";

describe("sshHostToHost", () => {
  it("preserves the Wake-on-LAN broadcast address for editing", () => {
    const host = sshHostToHost({
      id: 1,
      name: "server",
      ip: "192.168.0.10",
      port: 22,
      username: "root",
      wolBroadcastAddress: "192.168.0.255",
    } as SSHHostWithStatus);

    expect(host.wolBroadcastAddress).toBe("192.168.0.255");
  });
});
