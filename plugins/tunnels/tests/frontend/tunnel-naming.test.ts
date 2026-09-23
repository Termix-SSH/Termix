import { describe, expect, it } from "vitest";
import {
  clientTunnelName,
  serverTunnelName,
} from "../../src/shared/tunnel-naming";
import { connectRequestFor } from "../../src/frontend/host-tunnels";

const host = { id: "7", name: "web", username: "root", ip: "10.0.0.5" };
const tunnel = {
  scope: "s2s" as const,
  mode: "local" as const,
  sourcePort: 8080,
  endpointHost: " db ",
  endpointPort: 5432,
  maxRetries: 3,
  retryInterval: 10,
  autoStart: false,
};

describe("tunnel names", () => {
  it("builds a server tunnel name the connect request carries unchanged", () => {
    const name = serverTunnelName(host, 0, tunnel);
    expect(name).toBe("7::0::web::8080::db::5432");
    const request = connectRequestFor(host, 0, tunnel);
    expect(request.name).toBe(name);
    // The backend checks the name against these fields, so they must agree.
    expect(request.endpointHost).toBe("db");
    expect(request.sourceHostId).toBe(7);
  });

  it("falls back to user@ip for an unnamed host", () => {
    expect(serverTunnelName({ ...host, name: "" }, 1, tunnel)).toBe(
      "7::1::root@10.0.0.5::8080::db::5432",
    );
  });

  it("names a client tunnel the way the desktop app tracks it", () => {
    expect(
      clientTunnelName(
        {
          sourceHostId: 3,
          mode: "remote",
          localAddress: "",
          remoteAddress: "10.0.0.1",
          sourcePort: 9000,
          endpointPort: 80,
        },
        2,
      ),
    ).toBe("c2s::2::3::remote::127.0.0.1::10.0.0.1::9000::80");
  });
});
