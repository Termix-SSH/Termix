import { describe, expect, it } from "vitest";
import {
  classifyRuntimeError,
  composeArgsFor,
  containerCommand,
  countContainers,
  diffContainerStates,
  dockerArgs,
  parseComposeProjects,
  parseContainerList,
  parseContainerStates,
  parseContainerStats,
  parseRuntimeVersion,
  parseServices,
  parseStackStatus,
  stackStateFromServices,
} from "@termix-ssh/plugin-sdk/host-scripts";

describe("containerCommand", () => {
  it("extends PATH on POSIX hosts", () => {
    const command = containerCommand("podman", "ps");
    expect(command.startsWith('PATH="')).toBe(true);
    expect(command.endsWith(" podman ps")).toBe(true);
  });

  it("runs the plain CLI on Windows hosts", () => {
    expect(containerCommand("docker", "ps -a", true)).toBe("docker ps -a");
  });

  it("falls back to docker for an unknown runtime", () => {
    expect(containerCommand(undefined, "ps", true)).toBe("docker ps");
  });
});

describe("dockerArgs", () => {
  it("builds the container commands", () => {
    expect(dockerArgs.inspect("web")).toBe("inspect web");
    expect(dockerArgs.action("restart", "web")).toBe("restart web");
    expect(dockerArgs.remove("web", true)).toBe("rm -f web");
    expect(dockerArgs.list(true)).toContain("ps -a --format '{");
    expect(dockerArgs.stats("web")).toContain("stats web --no-stream");
  });

  it("refuses container ids that could break the command line", () => {
    expect(() => dockerArgs.inspect("web; rm -rf /")).toThrow();
    expect(() => dockerArgs.logs("$(id)")).toThrow();
    expect(() => dockerArgs.action("restart", "-rf")).toThrow();
    expect(() => dockerArgs.action("kill" as never, "web")).toThrow();
  });

  it("only passes sane log filters", () => {
    expect(
      dockerArgs.logs("web", {
        tail: 50.7,
        timestamps: true,
        since: "2026-10-01T00:00:00Z",
      }),
    ).toBe("logs web --tail 50 --timestamps --since 2026-10-01T00:00:00Z 2>&1");
    expect(dockerArgs.logs("web", { since: "1h; id" })).toBe("logs web 2>&1");
  });
});

describe("docker parsing", () => {
  it("reads the version and sorts errors", () => {
    expect(parseRuntimeVersion("Docker version 27.3.1, build ce12230")).toBe(
      "27.3.1",
    );
    expect(parseRuntimeVersion("podman version 5.2.0")).toBe("5.2.0");
    expect(parseRuntimeVersion("nope")).toBe("unknown");
    expect(classifyRuntimeError("bash: docker: command not found")).toBe(
      "NOT_INSTALLED",
    );
    expect(
      classifyRuntimeError(
        "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
      ),
    ).toBe("DAEMON_NOT_RUNNING");
    expect(
      classifyRuntimeError("permission denied while trying to connect"),
    ).toBe("PERMISSION_DENIED");
    expect(classifyRuntimeError("something else")).toBe("DOCKER_ERROR");
  });

  it("skips lines that are not JSON in the list", () => {
    const rows = parseContainerList(
      '{"id":"a","name":"web"}\nWARNING: x\n{"id":"b","name":"db"}\n',
    );
    expect(rows.map((r) => r.name)).toEqual(["web", "db"]);
  });

  it("splits the stats columns", () => {
    const stats = parseContainerStats(
      '{"cpu":"1.5%","memory":"10MiB / 1GiB","memoryPercent":"1%","netIO":"1kB / 2kB","blockIO":"0B / 0B","pids":"3"}',
    );
    expect(stats).toMatchObject({
      cpu: "1.5%",
      memoryUsed: "10MiB",
      memoryLimit: "1GiB",
      netInput: "1kB",
      netOutput: "2kB",
      pids: "3",
    });
  });

  const ps = [
    `{"name":"web","state":"running","status":"Up 2 hours"}`,
    `{"name":"db","state":"running","status":"Up 2 hours (unhealthy)"}`,
    `{"name":"old","state":"exited","status":"Exited (0)"}`,
  ].join("\n");

  it("counts running, stopped and unhealthy containers", () => {
    expect(countContainers(ps)).toEqual({
      running: 2,
      stopped: 1,
      unhealthy: 1,
      total: 3,
    });
  });

  it("turns two snapshots into events", () => {
    const before = parseContainerStates(ps);
    const after = parseContainerStates(
      [
        `{"name":"web","state":"exited","status":"Exited (1)"}`,
        `{"name":"db","state":"running","status":"Up (unhealthy)"}`,
        `{"name":"old","state":"running","status":"Up 1 second"}`,
        `{"name":"new","state":"running","status":"Up"}`,
      ].join("\n"),
    );
    expect(diffContainerStates(before, after)).toEqual([
      { container: "web", event: "exited" },
      { container: "old", event: "started" },
    ]);
  });
});

describe("compose", () => {
  it("reads stack status text", () => {
    expect(parseStackStatus("running(2), exited(1)")).toEqual({
      state: "partial",
      running: 2,
      total: 3,
    });
    expect(parseStackStatus("paused(2)")).toMatchObject({ state: "paused" });
    expect(parseStackStatus("")).toMatchObject({ state: "not-deployed" });
  });

  it("reads projects from compose ls", () => {
    const stacks = parseComposeProjects(
      JSON.stringify([
        {
          Name: "web",
          Status: "running(2)",
          ConfigFiles: "/opt/stacks/web/compose.yaml",
        },
        { Name: "Bad Name", Status: "running(1)", ConfigFiles: "" },
      ]),
    );
    expect(stacks).toEqual([
      {
        name: "web",
        managed: false,
        state: "running",
        running: 2,
        total: 2,
        composeFile: "/opt/stacks/web/compose.yaml",
      },
    ]);
  });

  it("reads services from compose ps, one line or one array", () => {
    const row = {
      Service: "app",
      Name: "web-app-1",
      ID: "abc",
      Image: "nginx",
      State: "running",
      Status: "Up",
      Health: "",
      Publishers: [
        { PublishedPort: 8080, TargetPort: 80 },
        { PublishedPort: 8080, TargetPort: 80 },
        { PublishedPort: 0, TargetPort: 443 },
      ],
    };
    const lines = parseServices(JSON.stringify(row));
    expect(lines[0]).toMatchObject({ service: "app", ports: "8080:80" });
    expect(
      parseServices(JSON.stringify([row, { ...row, State: "exited" }])),
    ).toHaveLength(2);
    expect(
      stackStateFromServices(
        parseServices(JSON.stringify([row, { ...row, State: "exited" }])),
      ),
    ).toEqual({
      state: "partial",
      running: 1,
      total: 2,
    });
  });

  it("maps actions to compose commands", () => {
    expect(composeArgsFor("redeploy", "app", {})).toEqual([
      "pull app",
      "up -d --remove-orphans app",
    ]);
    expect(
      composeArgsFor("destroy", undefined, { removeVolumes: true }),
    ).toEqual(["down --remove-orphans -v"]);
  });
});
