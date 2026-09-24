import { describe, expect, it } from "vitest";
import type { SSHHostWithStatus } from "@/main-axios";
import { sshHostToHost } from "@/sidebar/HostManagerData";

describe("sshHostToHost", () => {
  it.each(["local", "remote"] as const)(
    "preserves the %s connection origin for editing",
    (connectionOrigin) => {
      const host = sshHostToHost({
        id: 1,
        name: "server",
        ip: "192.168.0.10",
        port: 22,
        username: "root",
        connectionOrigin,
      } as SSHHostWithStatus);

      expect(host.connectionOrigin).toBe(connectionOrigin);
    },
  );

  it("preserves remote shared-host identity for local connection auth", () => {
    const host = sshHostToHost({
      id: -12,
      name: "shared",
      ip: "10.0.0.2",
      port: 22,
      username: "root",
      isShared: true,
    } as SSHHostWithStatus);

    expect(host.id).toBe("-12");
    expect(host.isShared).toBe(true);
  });
});
