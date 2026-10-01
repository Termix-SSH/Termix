import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { definition, startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const schedule = definition({ kind: "schedule", intervalSeconds: 300 });

describe("automation routes", () => {
  it("creates, lists, updates and deletes an automation", async () => {
    server = await startServer();

    const created = await server.request("POST", "/", {
      body: { name: " Nightly ", definition: schedule, channels: [1, 99] },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Nightly",
      enabled: 1,
      // 99 is not one of alice's channels, so it is not linked.
      channels: [1],
      missingPlugins: [],
    });
    const id = created.body.id;

    // A schedule trigger registers its next due time.
    const scheduleRow = server.db.sqlite
      .prepare(
        "SELECT next_due_at FROM p_automations_schedules WHERE automation_id = ?",
      )
      .get(id) as { next_due_at: string | null };
    expect(scheduleRow.next_due_at).toBeTruthy();

    const listed = await server.request("GET", "/");
    expect(listed.body.map((row: { id: number }) => row.id)).toEqual([id]);
    expect(listed.body[0].definition.trigger.kind).toBe("schedule");

    const updated = await server.request("PUT", `/${id}`, {
      body: { enabled: false, name: "Nightly job" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ enabled: 0, name: "Nightly job" });

    expect((await server.request("DELETE", `/${id}`)).status).toBe(200);
    expect((await server.request("GET", `/${id}`)).status).toBe(404);
    // The schedule goes with it.
    expect(
      server.db.sqlite
        .prepare("SELECT COUNT(*) AS n FROM p_automations_schedules")
        .get(),
    ).toEqual({ n: 0 });
  });

  it("never shows one user's automations to another", async () => {
    server = await startServer();
    const created = await server.request("POST", "/", {
      body: { name: "Mine", definition: schedule },
    });

    expect((await server.request("GET", "/", { user: "bob" })).body).toEqual(
      [],
    );
    expect(
      (await server.request("GET", `/${created.body.id}`, { user: "bob" }))
        .status,
    ).toBe(404);
    expect(
      (await server.request("DELETE", `/${created.body.id}`, { user: "bob" }))
        .status,
    ).toBe(404);
  });

  it("rejects an invalid definition", async () => {
    server = await startServer();
    const response = await server.request("POST", "/", {
      body: {
        name: "Bad",
        definition: {
          trigger: { kind: "schedule", intervalSeconds: 5 },
          steps: [],
        },
      },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/60 seconds/);
  });

  it("marks an automation that needs a plugin that is off", async () => {
    server = await startServer();
    const created = await server.request("POST", "/", {
      body: {
        name: "Restart app",
        definition: definition({ kind: "schedule", intervalSeconds: 300 }, [
          {
            id: "d",
            type: "docker",
            action: "restart",
            container: "app",
            hostSelector: { kind: "host", hostId: 1 },
          },
        ]),
      },
    });
    expect(created.body.missingPlugins).toEqual(["docker"]);
  });

  it("offers editor options and the running providers", async () => {
    server = await startServer({
      services: {
        "fleets.access": { list: async () => [{ id: 3, name: "web" }] },
      },
    });
    const response = await server.request("GET", "/editor-options");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      hosts: [
        { id: 1, name: "host-1" },
        { id: 2, name: "host-2" },
      ],
      snippets: [{ id: 5, name: "Restart nginx" }],
      fleets: [{ id: 3, name: "web" }],
      channels: [{ id: 1, name: "ops" }],
    });
    expect(response.body.providers).toMatchObject({
      snippets: true,
      fleets: true,
      docker: false,
      "host-metrics": false,
      "wake-on-lan": false,
    });
  });

  it("returns a webhook token once and runs the automation from it", async () => {
    server = await startServer();
    const created = await server.request("POST", "/", {
      body: { name: "Hook", definition: definition({ kind: "webhook" }) },
    });
    const token = created.body.webhookToken as string;
    expect(token).toHaveLength(64);
    expect(created.body.definition.trigger.tokenHash).toBe("");

    const stored = server.db.sqlite
      .prepare("SELECT definition FROM p_automations_automations WHERE id = ?")
      .get(created.body.id) as { definition: string };
    expect(JSON.parse(stored.definition).trigger.tokenHash).toBe(
      crypto.createHash("sha256").update(token).digest("hex"),
    );

    const fired = await server.request("POST", `/webhook/${token}`, {
      user: null,
      body: { hello: "world" },
    });
    expect(fired.status).toBe(202);
    expect(fired.body.status).toBe("success");

    const wrong = await server.request("POST", `/webhook/${"0".repeat(64)}`, {
      user: null,
      body: {},
    });
    expect(wrong.status).toBe(404);
  });

  it("runs now, records the steps and lists the run", async () => {
    server = await startServer();
    const created = await server.request("POST", "/", {
      body: { name: "Now", definition: schedule },
    });
    const outcome = await server.request("POST", `/${created.body.id}/run`, {
      body: { dryRun: true },
    });
    expect(outcome.body.status).toBe("success");

    const runs = await server.request("GET", "/runs/history");
    expect(runs.body[0]).toMatchObject({
      automation_id: created.body.id,
      automation_name: "Now",
      status: "success",
      dry_run: 1,
      trigger_type: "manual",
    });
    const steps = await server.request("GET", `/runs/${runs.body[0].id}/steps`);
    expect(steps.body).toMatchObject([
      { step_type: "set_var", status: "success" },
    ]);
    expect(
      (
        await server.request("GET", `/runs/${runs.body[0].id}/steps`, {
          user: "bob",
        })
      ).status,
    ).toBe(404);
  });
});

describe("permissions", () => {
  const routes: Array<[string, string, string]> = [
    ["GET", "/", "view"],
    ["GET", "/editor-options", "view"],
    ["GET", "/runs/history", "view"],
    ["GET", "/runs/1/steps", "view"],
    ["GET", "/1", "view"],
    ["POST", "/", "create"],
    ["PUT", "/1", "edit"],
    ["DELETE", "/1", "delete"],
    ["POST", "/1/run", "run"],
  ];

  it.each(routes)(
    "%s %s answers 403 without automations.%s",
    async (method, path) => {
      server = await startServer({ permissions: [] });
      const response = await server.request(method, path, { body: {} });
      expect(response.status).toBe(403);
    },
  );

  it("serves the webhook without a session", async () => {
    server = await startServer({ permissions: [] });
    const response = await server.request(
      "POST",
      `/webhook/${"a".repeat(64)}`,
      { user: null, body: {} },
    );
    expect(response.status).toBe(404);
  });
});
