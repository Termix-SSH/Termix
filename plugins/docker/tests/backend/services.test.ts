import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DockerEvent,
  DockerEventsV1,
  DockerServiceV1,
} from "../../src/backend/index.js";
import { startServer, type TestServer } from "./server";

let server: TestServer | null = null;

afterEach(async () => {
  vi.useRealTimers();
  await server?.close();
  server = null;
});

const psState = (state: string, status = "Up") =>
  `{"name":"web","state":"${state}","status":"${status}"}\n`;

describe("docker.containers service", () => {
  it("lists containers and runs actions as the caller", async () => {
    server = await startServer();
    const docker = server.mock.services.get(
      "docker.containers",
    ) as DockerServiceV1;

    const containers = await server.mock.ctx.asUser("user-1", () =>
      docker.listContainers(7),
    );
    expect(containers).toEqual([
      expect.objectContaining({ id: "abc123", name: "web" }),
    ]);

    await server.mock.ctx.asUser("user-1", () =>
      docker.action(7, "web", "restart"),
    );
    expect(server.client.commands.at(-1)).toMatch(/ docker restart web$/);
    expect(server.mock.sshConnections.at(-1)).toMatchObject({
      host: 7,
      pool: "docker",
    });

    await expect(
      server.mock.ctx.asUser("user-1", () =>
        docker.action(7, "web; rm -rf /", "stop"),
      ),
    ).rejects.toThrow(/Invalid container name/);
  });

  it("needs a calling user", async () => {
    server = await startServer();
    const docker = server.mock.services.get(
      "docker.containers",
    ) as DockerServiceV1;
    await expect(docker.listContainers(7)).rejects.toThrow(/calling user/);
  });
});

describe("docker.events service", () => {
  it("reports state changes between polls to every subscriber", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    server = await startServer();
    const events = server.mock.services.get("docker.events") as DockerEventsV1;
    const seen: DockerEvent[] = [];
    const listener = (event: DockerEvent) => seen.push(event);

    const unsubscribe = await server.mock.ctx.asUser("user-1", () =>
      events.subscribe(7, listener),
    );
    // Subscribing the same listener again is a no-op.
    await server.mock.ctx.asUser("user-1", () => events.subscribe(7, listener));

    const poll = async (output: string) => {
      server!.client.reply(/ ps -a --format/, { stdout: output });
      vi.setSystemTime(Date.now() + 61_000);
      await server!.mock.runScheduled();
    };

    await poll(psState("running"));
    expect(seen).toEqual([]);

    await poll(psState("exited", "Exited (1)"));
    expect(seen).toEqual([{ hostId: 7, container: "web", event: "exited" }]);

    await poll(psState("running", "Up 1 second (unhealthy)"));
    expect(seen.slice(1)).toEqual([
      { hostId: 7, container: "web", event: "started" },
      { hostId: 7, container: "web", event: "unhealthy" },
    ]);

    unsubscribe();
    const before = server.client.commands.length;
    await poll(psState("exited"));
    expect(server.client.commands.length).toBe(before);
    expect(seen).toHaveLength(3);
  });

  it("stops polling once the plugin is disposed", async () => {
    server = await startServer();
    const events = server.mock.services.get("docker.events") as DockerEventsV1;
    await server.mock.ctx.asUser("user-1", () => events.subscribe(7, () => {}));
    for (const dispose of [...server.mock.disposals].reverse()) await dispose();
    expect(server.mock.scheduled.every((job) => job.stopped)).toBe(true);
  });
});
