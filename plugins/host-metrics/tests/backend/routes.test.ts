import { afterEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./server";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const ROUTES: Array<[string, string, unknown?]> = [
  ["GET", "/defaults"],
  ["GET", "/metrics/7"],
  ["POST", "/metrics/start/7"],
  ["POST", "/metrics/stop/7", {}],
  ["POST", "/metrics/connect-totp", { sessionId: "x", totpCode: "1" }],
  ["POST", "/metrics/heartbeat", { viewerSessionId: "x" }],
  ["POST", "/metrics/register-viewer", { hostId: 7 }],
  ["POST", "/metrics/unregister-viewer", { hostId: 7, viewerSessionId: "x" }],
  ["GET", "/metrics/history/7"],
  ["GET", "/host-metrics/preferences/7"],
  ["POST", "/host-metrics/preferences/7", { slots: [], columns: 3 }],
  ["GET", "/host-metrics/platform/7"],
  ["POST", "/host-metrics/managers/health/7/config", { checks: [] }],
];

describe("permissions", () => {
  it.each(ROUTES)(
    "%s %s answers 403 without host-metrics.use",
    async (method, path, body) => {
      server = await startServer({ permissions: [] });
      const response = await server.request(method, path, { body });
      expect(response.status).toBe(403);
    },
  );
});

describe("defaults", () => {
  it("tells any user whether new hosts start with metrics on", async () => {
    server = await startServer();
    expect((await server.request("GET", "/defaults")).body).toEqual({
      enabledForNewHosts: true,
    });
    await server.mock.ctx.settings.set("enabledForNewHosts", false);
    expect((await server.request("GET", "/defaults")).body).toEqual({
      enabledForNewHosts: false,
    });
  });
});

describe("metrics", () => {
  it("answers 404 until a sample exists", async () => {
    server = await startServer();
    const response = await server.request("GET", "/metrics/7");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Metrics not available");
  });

  it("refuses a host the user cannot see", async () => {
    server = await startServer();
    const response = await server.request("GET", "/metrics/99");
    expect(response.status).toBe(403);
  });

  it("rejects a bad host id", async () => {
    server = await startServer();
    expect((await server.request("GET", "/metrics/abc")).status).toBe(400);
  });
});

describe("viewers", () => {
  it("registers, heartbeats and unregisters a viewer", async () => {
    server = await startServer();
    const registered = await server.request(
      "POST",
      "/metrics/register-viewer",
      {
        body: { hostId: 7 },
      },
    );
    expect(registered.status).toBe(200);
    const viewerSessionId = registered.body.viewerSessionId as string;
    expect(viewerSessionId).toMatch(/^viewer-/);

    expect(
      (
        await server.request("POST", "/metrics/heartbeat", {
          body: { viewerSessionId },
        })
      ).status,
    ).toBe(200);
    // Another user cannot keep or drop someone else's viewer.
    expect(
      (
        await server.request("POST", "/metrics/heartbeat", {
          user: "user-2",
          body: { viewerSessionId },
        })
      ).status,
    ).toBe(404);

    await server.request("POST", "/metrics/unregister-viewer", {
      body: { hostId: 7, viewerSessionId },
    });
    expect(
      (
        await server.request("POST", "/metrics/heartbeat", {
          body: { viewerSessionId },
        })
      ).status,
    ).toBe(404);
  });

  it("skips a host with metrics turned off", async () => {
    server = await startServer();
    await server.mock.ctx.settings.setHost(7, "metricsEnabled", false);
    const response = await server.request("POST", "/metrics/register-viewer", {
      body: { hostId: 7 },
    });
    expect(response.body).toEqual({
      success: true,
      skipped: true,
      reason: "metrics_disabled",
    });
  });

  it("skips a host it cannot find", async () => {
    server = await startServer();
    const response = await server.request("POST", "/metrics/register-viewer", {
      body: { hostId: 99 },
    });
    expect(response.body.reason).toBe("host_not_found");
  });
});

describe("history", () => {
  it("returns stored samples in the range", async () => {
    server = await startServer();
    const now = new Date();
    const ts = now.toISOString().slice(0, 19).replace("T", " ");
    server.db.sqlite
      .prepare(
        "INSERT INTO p_host_metrics_host_metrics_history (host_id, ts, cpu_percent) VALUES (?, ?, ?)",
      )
      .run(7, ts, 42);

    const response = await server.request("GET", "/metrics/history/7?range=1h");
    expect(response.status).toBe(200);
    expect(response.body.rows).toEqual([
      expect.objectContaining({ ts, cpu_percent: 42 }),
    ]);
  });

  it("rejects an unknown range", async () => {
    server = await startServer();
    const response = await server.request("GET", "/metrics/history/7?range=2y");
    expect(response.status).toBe(400);
  });
});

describe("layout preferences", () => {
  it("defaults from the host's enabled widgets", async () => {
    server = await startServer();
    await server.mock.ctx.settings.setHost(7, "enabledWidgets", ["cpu"]);
    const response = await server.request("GET", "/host-metrics/preferences/7");
    expect(response.body.layout.slots.map((s: { id: string }) => s.id)).toEqual(
      ["cpu"],
    );
  });

  it("saves a layout and keeps the owner's enabled widgets in step", async () => {
    server = await startServer();
    const layout = {
      columns: 2,
      slots: [
        { id: "memory", order: 0, colSpan: 1, height: null },
        { id: "service_manager", order: 1, colSpan: 2, height: null },
      ],
    };
    expect(
      (
        await server.request("POST", "/host-metrics/preferences/7", {
          body: layout,
        })
      ).status,
    ).toBe(200);

    const read = await server.request("GET", "/host-metrics/preferences/7");
    expect(read.body.layout).toEqual(layout);
    expect(await server.mock.ctx.settings.getHost(7, "enabledWidgets")).toEqual(
      ["memory"],
    );
  });

  it("rejects a malformed layout", async () => {
    server = await startServer();
    const response = await server.request(
      "POST",
      "/host-metrics/preferences/7",
      { body: { columns: 2 } },
    );
    expect(response.status).toBe(400);
  });
});

describe("health checks", () => {
  it("saves a user's checks for a host", async () => {
    server = await startServer();
    const checks = [
      { id: "web", name: "Web", type: "tcp", target: "x", port: 80 },
    ];
    const response = await server.request(
      "POST",
      "/host-metrics/managers/health/7/config",
      { body: { checks, intervalSeconds: 120 } },
    );
    expect(response.status).toBe(200);
    expect(
      server.db.sqlite
        .prepare(
          "SELECT user_id, checks, interval_seconds FROM p_host_metrics_host_health_checks",
        )
        .all(),
    ).toEqual([
      {
        user_id: "user-1",
        checks: JSON.stringify(checks),
        interval_seconds: 120,
      },
    ]);
  });

  it("rejects invalid checks", async () => {
    server = await startServer();
    const response = await server.request(
      "POST",
      "/host-metrics/managers/health/7/config",
      { body: { checks: [{ id: "x" }] } },
    );
    expect(response.status).toBe(400);
  });
});
