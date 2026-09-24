import { afterEach, describe, expect, it } from "vitest";
import { definition, startServer, type TestServer } from "./helpers";

/**
 * The engine as activate() wires it: the ctx.schedule tick, the services it
 * reaches, and what happens when a plugin an automation needs is off.
 */

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

async function create(
  s: TestServer,
  name: string,
  body: ReturnType<typeof definition>,
): Promise<number> {
  const created = await s.request("POST", "/", {
    body: { name, definition: body },
  });
  expect(created.status).toBe(201);
  return created.body.id;
}

function makeDue(s: TestServer, automationId: number) {
  s.db.sqlite
    .prepare(
      "UPDATE p_automations_schedules SET next_due_at = ? WHERE automation_id = ?",
    )
    .run(new Date(Date.now() - 60_000).toISOString(), automationId);
}

describe("scheduled automations", () => {
  it("fire from the ctx.schedule tick and notify as the owner", async () => {
    server = await startServer();
    const id = await create(
      server,
      "Every five minutes",
      definition({ kind: "schedule", intervalSeconds: 300 }, [
        {
          id: "n",
          type: "notify",
          channelIds: [1],
          title: "Ping {{trigger.type}}",
          body: "hello",
        },
      ]),
    );
    makeDue(server, id);

    // The tick is registered through ctx.schedule, never a bare timer.
    expect(server.mock.scheduled.filter((job) => !job.stopped).length).toBe(2);
    await server.mock.runScheduled();

    expect(await server.waitForRun(id)).toEqual({
      status: "success",
      error: null,
    });
    expect(server.mock.notifications).toEqual([
      {
        actor: "alice",
        channelIds: [1],
        notification: expect.objectContaining({
          title: "Ping schedule",
          body: "hello",
        }),
      },
    ]);

    // The next due time moved forward, so the next tick does not re-run it.
    const due = server.db.sqlite
      .prepare(
        "SELECT next_due_at FROM p_automations_schedules WHERE automation_id = ?",
      )
      .get(id) as { next_due_at: string };
    expect(new Date(due.next_due_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("are skipped with a reason while the docker plugin is off, and the engine keeps going", async () => {
    server = await startServer();
    const needsDocker = await create(
      server,
      "Restart app",
      definition({ kind: "schedule", intervalSeconds: 300 }, [
        {
          id: "d",
          type: "docker",
          action: "restart",
          container: "app",
          hostSelector: { kind: "host", hostId: 1 },
        },
      ]),
    );
    const plain = await create(
      server,
      "Plain",
      definition({ kind: "schedule", intervalSeconds: 300 }),
    );
    makeDue(server, needsDocker);
    makeDue(server, plain);

    await server.mock.runScheduled();

    expect(await server.waitForRun(needsDocker)).toEqual({
      status: "skipped",
      error: "Needs the docker plugin",
    });
    expect(await server.waitForRun(plain)).toEqual({
      status: "success",
      error: null,
    });

    // A manual run says the same thing instead of throwing.
    const manual = await server.request("POST", `/${needsDocker}/run`, {
      body: {},
    });
    expect(manual.status).toBe(200);
    expect(manual.body).toMatchObject({
      status: "skipped",
      error: "Needs the docker plugin",
    });
  });

  it("run once docker is back", async () => {
    const actions: unknown[] = [];
    server = await startServer({
      services: {
        "docker.containers": {
          action: async (...args: unknown[]) => {
            actions.push(args);
          },
        },
      },
    });
    const id = await create(
      server,
      "Restart app",
      definition({ kind: "schedule", intervalSeconds: 300 }, [
        {
          id: "d",
          type: "docker",
          action: "restart",
          container: "app",
          hostSelector: { kind: "host", hostId: 1 },
        },
      ]),
    );
    const outcome = await server.request("POST", `/${id}/run`, { body: {} });
    // Host 1 does not resolve here, so the step has no target, but the
    // automation is no longer skipped for a missing plugin.
    expect(outcome.body.status).not.toBe("skipped");
  });
});

describe("automations.access", () => {
  it("lists, reads, creates disabled and runs as the caller", async () => {
    server = await startServer();
    const service = server.service;

    const created = await server.mock.ctx.asUser("alice", () =>
      service.create({
        name: "From the assistant",
        definition: definition({ kind: "schedule", intervalSeconds: 600 }),
      }),
    );
    const listed = await server.mock.ctx.asUser("alice", () => service.list());
    expect(listed).toEqual([
      expect.objectContaining({
        id: created.id,
        enabled: false,
        triggerKind: "schedule",
        missingPlugins: [],
      }),
    ]);

    const one = await server.mock.ctx.asUser("alice", () =>
      service.get(created.id),
    );
    expect(one?.definition?.trigger.kind).toBe("schedule");
    expect(
      await server.mock.ctx.asUser("bob", () => service.get(created.id)),
    ).toBeNull();

    const outcome = await server.mock.ctx.asUser("alice", () =>
      service.run(created.id, { dryRun: true }),
    );
    expect(outcome.status).toBe("success");
  });

  it("refuses an invalid definition", async () => {
    server = await startServer();
    await expect(
      server.mock.ctx.asUser("alice", () =>
        server!.service.create({ name: "x", definition: { steps: [] } }),
      ),
    ).rejects.toThrow(/trigger/);
  });
});

describe("optional steps", () => {
  it("fail the step cleanly while the tunnels plugin is off", async () => {
    server = await startServer();
    const id = await create(
      server,
      "Tunnel",
      definition({ kind: "webhook" }, [
        { id: "t", type: "tunnel", action: "connect", tunnelName: "db" },
      ]),
    );
    const outcome = await server.request("POST", `/${id}/run`, { body: {} });
    expect(outcome.body).toMatchObject({
      status: "skipped",
      error: "Needs the tunnels plugin",
    });
  });

  it("start a tunnel through tunnels.access", async () => {
    const started: string[] = [];
    server = await startServer({
      services: {
        "tunnels.access": {
          start: async (name: string) => {
            started.push(name);
          },
          stop: async () => {},
        },
      },
    });
    const id = await create(
      server,
      "Tunnel",
      definition({ kind: "webhook" }, [
        { id: "t", type: "tunnel", action: "connect", tunnelName: "db" },
      ]),
    );
    const outcome = await server.request("POST", `/${id}/run`, { body: {} });
    expect(outcome.body.status).toBe("success");
    expect(started).toEqual(["db"]);
  });

  it("wake a host through the wake-on-lan service", async () => {
    const woken: number[] = [];
    server = await startServer({
      services: {
        "wake-on-lan.send": {
          wake: async (hostId: number) => {
            woken.push(hostId);
          },
        },
      },
    });
    const id = await create(
      server,
      "Wake",
      definition({ kind: "webhook" }, [{ id: "w", type: "wol", hostId: 2 }]),
    );
    const outcome = await server.request("POST", `/${id}/run`, { body: {} });
    expect(outcome.body.status).toBe("success");
    expect(woken).toEqual([2]);
  });
});

describe("watchers", () => {
  it("subscribe to docker.events as the owner and fire docker_event triggers", async () => {
    let listener: ((event: unknown) => void) | null = null;
    const subscribedAs: Array<string | undefined> = [];
    server = await startServer({
      services: {
        "docker.events": {
          subscribe: async (_hostId: number, fn: (event: unknown) => void) => {
            listener = fn;
            subscribedAs.push(server?.mock.ctx.currentActor());
            return () => {
              listener = null;
            };
          },
        },
      },
    });
    const id = await create(
      server,
      "Container died",
      definition({
        kind: "docker_event",
        hostSelector: { kind: "host", hostId: 1 },
        container: "app",
        event: "exited",
        cooldownMinutes: 0,
      }),
    );

    await server.mock.runScheduled();
    expect(subscribedAs).toEqual(["alice"]);
    expect(listener).not.toBeNull();

    listener!({ hostId: 1, container: "app", event: "exited" });
    expect(await server.waitForRun(id)).toEqual({
      status: "success",
      error: null,
    });
  });

  it("keep headless metrics viewers registered as the owner", async () => {
    const registered: Array<[number, string | undefined]> = [];
    let beats = 0;
    server = await startServer({
      services: {
        "host-metrics.viewers": {
          register: async (hostId: number) => {
            registered.push([hostId, server?.mock.ctx.currentActor()]);
            return { viewerSessionId: `v${hostId}` };
          },
          heartbeat: () => {
            beats++;
            return true;
          },
          unregister: () => {},
        },
      },
    });
    await create(
      server,
      "CPU",
      definition({
        kind: "metric_threshold",
        hostSelector: { kind: "hosts", hostIds: [1, 2] },
        metric: { path: "cpu.percent" },
        operator: ">",
        value: 90,
        cooldownMinutes: 15,
      }),
    );

    await server.mock.runScheduled();
    expect(registered).toEqual([
      [1, "alice"],
      [2, "alice"],
    ]);
    const before = beats;
    await server.mock.runScheduled();
    // Each tick heartbeats both viewers and registers nothing new.
    expect(beats).toBeGreaterThan(before);
    expect((beats - before) % 2).toBe(0);
    expect(registered).toHaveLength(2);
  });

  it("fire a metric trigger from a host-metrics snapshot event", async () => {
    server = await startServer({
      services: {
        "host-metrics.viewers": {
          register: async () => ({ viewerSessionId: "v" }),
          heartbeat: () => true,
          unregister: () => {},
        },
      },
    });
    const id = await create(
      server,
      "CPU",
      definition({
        kind: "metric_threshold",
        hostSelector: { kind: "host", hostId: 1 },
        metric: { path: "cpu.percent" },
        operator: ">",
        value: 90,
        cooldownMinutes: 15,
      }),
    );

    server.mock.ctx.events.emit("plugin.host-metrics.snapshot", {
      hostId: 1,
      ownerUserId: "alice",
      metrics: { cpu: { percent: 97 } },
    });
    expect(await server.waitForRun(id)).toEqual({
      status: "success",
      error: null,
    });
  });
});
