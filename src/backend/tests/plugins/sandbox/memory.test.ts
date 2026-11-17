import { afterEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as unknown[]);
vi.mock("../../../notify/core-notify.js", () => ({
  sendCoreAlert: vi.fn(async (notification: unknown) => {
    sent.push(notification);
  }),
}));

import {
  buildMemoryReport,
  checkMemoryOnce,
  readMemoryLimit,
  resetMemoryAlerts,
  type PluginMemoryReport,
} from "../../../plugins/sandbox/memory.js";

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

afterEach(() => {
  sent.length = 0;
  resetMemoryAlerts();
});

describe("memory limit", () => {
  const files = (map: Record<string, string>) => (file: string) => {
    if (file in map) return map[file];
    throw new Error("ENOENT");
  };

  it("uses a cgroup v2 container limit", () => {
    expect(
      readMemoryLimit(
        files({ "/sys/fs/cgroup/memory.max": String(2 * GB) }),
        16 * GB,
      ),
    ).toEqual({ mb: 2048, source: "container" });
  });

  it("uses a cgroup v1 limit", () => {
    expect(
      readMemoryLimit(
        files({
          "/sys/fs/cgroup/memory/memory.limit_in_bytes": String(512 * MB),
        }),
        16 * GB,
      ),
    ).toEqual({ mb: 512, source: "container" });
  });

  it("falls back to the machine when there is no limit", () => {
    expect(
      readMemoryLimit(files({ "/sys/fs/cgroup/memory.max": "max" }), 8 * GB),
    ).toEqual({ mb: 8192, source: "system" });
    expect(
      readMemoryLimit(
        files({
          "/sys/fs/cgroup/memory/memory.limit_in_bytes": "9223372036854771712",
        }),
        8 * GB,
      ),
    ).toEqual({ mb: 8192, source: "system" });
    expect(readMemoryLimit(files({}), 4 * GB)).toEqual({
      mb: 4096,
      source: "system",
    });
  });
});

describe("memory report", () => {
  const status = (pluginId: string, rssMb: number | null, ready = true) => ({
    pluginId,
    state: ready ? ("ready" as const) : ("stopped" as const),
    alwaysOn: false,
    keepOnReason: null,
    rssMb,
    crashes: 0,
  });

  it("adds Termix and running plugins and warns past 80 percent", () => {
    const report = buildMemoryReport(
      [status("a", 50), status("b", null, false), status("c", 70)],
      200 * MB,
      { mb: 400, source: "container" },
    );
    expect(report.totalMb).toBe(320);
    expect(report.pluginsMb).toBe(120);
    expect(report.running).toBe(2);
    expect(report.plugins.map((p) => p.pluginId)).toEqual(["c", "a", "b"]);
    expect(report.low).toBe(false);
    expect(report.plugins.every((p) => p.busy === null)).toBe(true);

    const tight = buildMemoryReport([status("a", 150)], 200 * MB, {
      mb: 400,
      source: "container",
    });
    expect(tight.low).toBe(true);
  });
});

describe("memory alert", () => {
  const report = (low: boolean): PluginMemoryReport => ({
    core: { rssMb: 300 },
    plugins: [],
    totalMb: 900,
    pluginsMb: 600,
    running: 10,
    limitMb: 1000,
    limitSource: "container",
    low,
  });

  it("tells admins once a day while memory stays low", async () => {
    let now = 1_000_000;
    const clock = () => now;
    await expect(
      checkMemoryOnce(async () => report(true), clock),
    ).resolves.toBe(true);
    now += 60 * 60_000;
    await expect(
      checkMemoryOnce(async () => report(true), clock),
    ).resolves.toBe(false);
    now += 24 * 60 * 60_000;
    await expect(
      checkMemoryOnce(async () => report(true), clock),
    ).resolves.toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ audience: "admins", severity: "warning" });
    expect(String((sent[0] as { body: string }).body)).toContain(
      "900 MB of 1000 MB",
    );
  });

  it("stays quiet with enough memory", async () => {
    await expect(checkMemoryOnce(async () => report(false))).resolves.toBe(
      false,
    );
    expect(sent).toHaveLength(0);
  });
});
