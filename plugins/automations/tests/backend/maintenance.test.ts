import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer as createServer, host, type TestServer } from "./helpers";
import { createMaintenanceRepository } from "../../src/backend/maintenance-repository.js";
import { createMaintenanceService } from "../../src/backend/maintenance-service.js";

function startServer(options: Parameters<typeof createServer>[0] = {}) {
  return createServer({
    ...options,
    before: (db) => {
      db.exec("INSERT INTO ssh_data (id) VALUES (1), (2)");
      options.before?.(db);
    },
  });
}

let server: TestServer | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
  server = undefined;
});
const input = {
  action: "start",
  reason: "OS upgrade",
  durationMinutes: 60,
  graceMinutes: 20,
  notifyOverdue: true,
};

describe("host maintenance", () => {
  it("shows a shared host the owner's maintenance read only and enforces edit permission", async () => {
    // The mock serves every host to every user, as if alice shared host 1.
    server = await startServer({ hosts: [host(1), host(2, "bob")] });
    const started = await server.request("POST", "/maintenance/1", {
      body: input,
    });
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ owned: true });

    const listed = (
      await server.request("GET", "/maintenance", { user: "bob" })
    ).body as Array<{
      hostId: number;
      state: { owned: boolean; active: unknown };
    }>;
    expect(listed).toHaveLength(1);
    expect(listed[0].hostId).toBe(1);
    expect(listed[0].state.owned).toBe(false);
    expect(listed[0].state.active).toBeTruthy();

    const read = await server.request("GET", "/maintenance/1", { user: "bob" });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ owned: false });
    expect(
      (
        await server.request("POST", "/maintenance/1", {
          user: "bob",
          body: { action: "end" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await server.request("GET", "/maintenance/99", { user: "bob" })).status,
    ).toBe(404);
    expect(
      (await server.request("POST", "/maintenance/1x", { body: input })).status,
    ).toBe(400);
    expect(
      (await server.request("GET", "/maintenance/1", { user: null })).status,
    ).toBe(401);
    await server.close();
    server = await startServer({ permissions: ["automations.view"] });
    expect(
      (await server.request("POST", "/maintenance/1", { body: input })).status,
    ).toBe(403);
  });
  it("survives service restart, remains active beyond ETM, and reminds only once with fresh offline evidence", async () => {
    server = await startServer();
    let now = Date.parse("2026-01-01T12:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await server.request("POST", "/maintenance/1", { body: input });
    const repository = await createMaintenanceRepository(server.db.database);
    let service = createMaintenanceService(server.mock.ctx, repository);
    now = Date.parse("2026-01-01T13:21Z");
    server.mock.hostStatuses.set(1, {
      status: "offline",
      lastChecked: "2026-01-01T12:00Z",
    });
    await service.tick();
    expect(server.mock.notifications).toHaveLength(0);
    server.mock.hostStatuses.set(1, {
      status: "online",
      lastChecked: "2026-01-01T13:21Z",
    });
    await service.tick();
    expect(server.mock.notifications).toHaveLength(0);
    server.mock.hostStatuses.set(1, {
      status: "offline",
      lastChecked: "2026-01-01T13:21Z",
    });
    await service.tick();
    expect(server.mock.notifications).toHaveLength(1);
    expect(server.mock.notifications[0].actor).toBe("alice");
    service = createMaintenanceService(server.mock.ctx, repository);
    await service.tick();
    expect(server.mock.notifications).toHaveLength(1);
    expect((await service.read("alice", 1)).active).not.toBeNull();
    await service.edit("alice", 1, "end", {});
    expect(await service.isMaintaining("alice", 1)).toBe(false);
  });
  it("serializes concurrent starts and conflicting schedules without losing state", async () => {
    server = await startServer();
    const service = createMaintenanceService(
      server.mock.ctx,
      await createMaintenanceRepository(server.db.database),
    );
    const starts = await Promise.allSettled([
      service.edit("alice", 1, "start", input),
      service.edit("alice", 1, "start", input),
    ]);
    expect(starts.map((r) => r.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const start = new Date(
      Math.ceil((Date.now() + 86400000) / 60000) * 60000,
    ).toISOString();
    const schedules = await Promise.allSettled([
      service.edit("alice", 1, "schedule", {
        ...input,
        start,
        recurrence: "weekly",
      }),
      service.edit("alice", 1, "schedule", {
        ...input,
        start,
        recurrence: "monthly",
      }),
    ]);
    expect(schedules.map((r) => r.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect((await service.read("alice", 1)).plans).toHaveLength(1);
  });
  it("starts a due schedule before accepting status events and handles deletion", async () => {
    server = await startServer();
    let now = Date.parse("2026-01-01T12:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const service = createMaintenanceService(
      server.mock.ctx,
      await createMaintenanceRepository(server.db.database),
    );
    await service.edit("alice", 1, "schedule", {
      ...input,
      start: "2026-01-01T13:00:00Z",
      recurrence: "once",
    });
    expect(await service.isMaintaining("alice", 1)).toBe(false);
    now = Date.parse("2026-01-01T13:00Z");
    expect(await service.isMaintaining("alice", 1)).toBe(true);
    const state = await service.read("alice", 1);
    await service.edit("alice", 1, "remove", { id: state.plans[0].id });
    expect(await service.isMaintaining("alice", 1)).toBe(true);
    await service.wipeUser("alice");
    expect(await service.list("alice")).toEqual([]);
  });
  it("clears old dwell windows on start and end and cascades host deletion", async () => {
    server = await startServer();
    const created = await server.request("POST", "/", {
      body: {
        name: "CPU",
        definition: {
          version: 1,
          trigger: {
            kind: "metric_threshold",
            hostSelector: { kind: "host", hostId: 1 },
            metric: { path: "cpu.percent" },
            operator: ">",
            value: 90,
            forSeconds: 60,
            cooldownMinutes: 0,
          },
          steps: [],
        },
      },
    });
    expect(created.status).toBe(201);
    const { createAutomationRepository } =
      await import("../../src/backend/repository.js");
    const repository = await createAutomationRepository(
      server.db.database,
      async () => [],
    );
    const seed = () =>
      repository.upsertTriggerState({
        automationId: created.body.id,
        stateKey: "1",
        breachStartedAt: "2000-01-01T00:00:00Z",
      });
    await seed();
    expect(
      (await server.request("POST", "/maintenance/1", { body: input })).status,
    ).toBe(200);
    expect(
      (await repository.getTriggerState(created.body.id, "1"))?.breachStartedAt,
    ).toBeNull();
    await seed();
    expect(
      (
        await server.request("POST", "/maintenance/1", {
          body: { action: "end" },
        })
      ).status,
    ).toBe(200);
    expect(
      (await repository.getTriggerState(created.body.id, "1"))?.breachStartedAt,
    ).toBeNull();
    server.db.sqlite.prepare("DELETE FROM ssh_data WHERE id = 1").run();
    expect(
      await (await createMaintenanceRepository(server.db.database)).list(),
    ).toEqual([]);
  });
});
