import { describe, expect, it } from "vitest";
import { toHostRecord } from "@/plugin-host/bridge";

describe("toHostRecord", () => {
  it("copies only the fields the SDK types", () => {
    const record = toHostRecord({
      id: 7,
      name: "web",
      ip: "10.0.0.7",
      port: 22,
      username: "root",
      parentHostId: 3,
      jumpHosts: [{ hostId: 2 }],
      pluginSettings: { docker: { enableDocker: true } },
      authOverrides: { ssh: { required: true, ownerAuthShared: false } },
      password: "secret",
      terminalConfig: { fontSize: 14 },
      enableDocker: true,
    } as never);

    expect(record).toMatchObject({
      id: "7",
      name: "web",
      parentHostId: "3",
      jumpHosts: [{ hostId: 2 }],
      pluginSettings: { docker: { enableDocker: true } },
      authOverrides: { ssh: { required: true, ownerAuthShared: false } },
    });
    const loose = record as unknown as Record<string, unknown>;
    expect(loose).not.toHaveProperty("password");
    expect(loose).not.toHaveProperty("terminalConfig");
    expect(loose).not.toHaveProperty("enableDocker");
  });
});
