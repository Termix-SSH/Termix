import { describe, expect, it } from "vitest";
import {
  compare,
  extractMetricValue,
  hasDwelled,
  isCoolingDown,
  metricStateKey,
  severityForValue,
  type MetricsSnapshot,
} from "../../automations/conditions.js";

const metrics: MetricsSnapshot = {
  cpu: { percent: 42.5, load: [1.5, 1.2, 0.9] },
  memory: { percent: 61, usedGiB: 7.5 },
  disk: {
    percent: 30,
    filesystems: [
      { mount: "/", percent: 30, availableBytes: 100 },
      { mount: "/data", percent: 93.4, availableBytes: 25 },
    ],
  },
  network: {
    interfaces: [
      { name: "eth0", rxBytes: "1000", txBytes: "2000" },
      { name: "eth1", rxBytes: "50", txBytes: "60" },
    ],
  },
  temperature: { highestCelsius: 71 },
  uptime: { seconds: 86400 },
  processes: { total: 210 },
};

describe("extractMetricValue", () => {
  it("reads simple scalar paths", () => {
    expect(extractMetricValue(metrics, { path: "cpu.percent" })).toBe(42.5);
    expect(extractMetricValue(metrics, { path: "memory.percent" })).toBe(61);
    expect(
      extractMetricValue(metrics, { path: "temperature.highestCelsius" }),
    ).toBe(71);
    expect(extractMetricValue(metrics, { path: "uptime.seconds" })).toBe(86400);
    expect(extractMetricValue(metrics, { path: "processes.total" })).toBe(210);
  });

  it("reads load averages positionally", () => {
    expect(extractMetricValue(metrics, { path: "cpu.load1" })).toBe(1.5);
    expect(extractMetricValue(metrics, { path: "cpu.load15" })).toBe(0.9);
  });

  it("reads a specific mount rather than the aggregate", () => {
    // The motivating case: /data is nearly full while / is fine.
    expect(
      extractMetricValue(metrics, { path: "disk.percent", mount: "/data" }),
    ).toBe(93.4);
    expect(extractMetricValue(metrics, { path: "disk.percent" })).toBe(30);
  });

  it("returns null for a mount that is not present", () => {
    expect(
      extractMetricValue(metrics, { path: "disk.percent", mount: "/nope" }),
    ).toBeNull();
  });

  it("selects a named interface and coerces string counters", () => {
    expect(
      extractMetricValue(metrics, { path: "network.rxBytes", iface: "eth1" }),
    ).toBe(50);
    expect(extractMetricValue(metrics, { path: "network.rxBytes" })).toBe(1000);
  });

  it("returns null for missing metrics rather than throwing", () => {
    expect(extractMetricValue(null, { path: "cpu.percent" })).toBeNull();
    expect(extractMetricValue({}, { path: "cpu.percent" })).toBeNull();
    expect(
      extractMetricValue({ cpu: { percent: null } }, { path: "cpu.percent" }),
    ).toBeNull();
  });
});

describe("metricStateKey", () => {
  it("scopes state per mount so dwell tracks one filesystem", () => {
    expect(metricStateKey(7, { path: "disk.percent" })).toBe("7");
    expect(metricStateKey(7, { path: "disk.percent", mount: "/data" })).toBe(
      "7:/data",
    );
    expect(metricStateKey(7, { path: "network.rxBytes", iface: "eth1" })).toBe(
      "7:eth1",
    );
  });
});

describe("compare", () => {
  it("handles numeric operators", () => {
    expect(compare(93, ">", 90)).toBe(true);
    expect(compare(90, ">", 90)).toBe(false);
    expect(compare(90, ">=", 90)).toBe(true);
    expect(compare(10, "<", 90)).toBe(true);
    expect(compare(90, "<=", 90)).toBe(true);
  });

  it("compares numeric strings numerically", () => {
    expect(compare("93", ">", "90")).toBe(true);
    // Lexically "9" > "10", so this would be wrong as a string compare.
    expect(compare("9", "<", "10")).toBe(true);
  });

  it("falls back to string equality for non-numeric values", () => {
    expect(compare("running", "==", "running")).toBe(true);
    expect(compare("running", "!=", "exited")).toBe(true);
  });

  it("handles containment", () => {
    expect(compare("disk full", "contains", "full")).toBe(true);
    expect(compare("disk full", "not_contains", "full")).toBe(false);
    expect(compare("all good", "not_contains", "error")).toBe(true);
  });

  it("treats changed as inequality of the rendered values", () => {
    expect(compare("online", "changed", "offline")).toBe(true);
    expect(compare("online", "changed", "online")).toBe(false);
  });

  it("is false when a numeric comparison has a non-numeric side", () => {
    expect(compare("abc", ">", 5)).toBe(false);
  });
});

describe("isCoolingDown", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");

  it("is false when nothing has fired yet", () => {
    expect(isCoolingDown(null, 15, now)).toBe(false);
  });

  it("is true inside the window and false outside it", () => {
    expect(isCoolingDown("2026-01-01T11:50:00.000Z", 15, now)).toBe(true);
    expect(isCoolingDown("2026-01-01T11:40:00.000Z", 15, now)).toBe(false);
  });

  it("treats a zero cooldown as always ready", () => {
    expect(isCoolingDown("2026-01-01T11:59:59.000Z", 0, now)).toBe(false);
  });
});

describe("hasDwelled", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");

  it("fires immediately when no window is configured", () => {
    expect(hasDwelled(null, undefined, now)).toBe(true);
    expect(hasDwelled(null, 0, now)).toBe(true);
  });

  it("requires the window to have elapsed", () => {
    expect(hasDwelled("2026-01-01T11:49:00.000Z", 600, now)).toBe(true);
    expect(hasDwelled("2026-01-01T11:55:00.000Z", 600, now)).toBe(false);
  });

  it("is false when a window is set but no breach is open", () => {
    expect(hasDwelled(null, 600, now)).toBe(false);
  });
});

describe("severityForValue", () => {
  it("escalates at 95 and honours an explicit override", () => {
    expect(severityForValue(96)).toBe("critical");
    expect(severityForValue(90)).toBe("warning");
    expect(severityForValue(96, "info")).toBe("info");
  });
});
