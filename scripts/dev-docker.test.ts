import { describe, expect, it } from "vitest";
import {
  SERVICES,
  appRunArgs,
  serviceEnv,
  serviceRunArgs,
} from "./lib/dev-docker.mjs";
import { parseDevArgs } from "./lib/dev-runner.mjs";

describe("serviceRunArgs", () => {
  it("runs a service on the dev network with its port, env and volume", () => {
    const args = serviceRunArgs(SERVICES.postgres);
    expect(args.slice(0, 6)).toEqual([
      "run",
      "-d",
      "--name",
      "termix-dev-postgres",
      "--network",
      "termix-dev",
    ]);
    expect(args).toContain("55432:5432");
    expect(args).toContain("POSTGRES_PASSWORD=termix");
    expect(args).toContain("termix-dev-postgres:/var/lib/postgresql/data");
    expect(args.at(-1)).toBe("postgres:16");
  });

  it("adds no volume for guacd", () => {
    expect(serviceRunArgs(SERVICES.guacd)).not.toContain("-v");
  });
});

describe("serviceEnv", () => {
  it("is empty for plain sqlite", () => {
    expect(serviceEnv(parseDevArgs([]), false)).toEqual({});
  });

  it("points a local backend at the published ports", () => {
    expect(
      serviceEnv(parseDevArgs(["--db", "postgres", "--guacd"]), false),
    ).toEqual({
      DATABASE_DIALECT: "postgres",
      DATABASE_URL: "postgres://termix:termix@127.0.0.1:55432/termix",
      GUACD_HOST: "127.0.0.1",
      GUACD_PORT: "4822",
    });
  });

  it("points a container at the other containers by name", () => {
    expect(
      serviceEnv(parseDevArgs(["--db", "mysql", "--guacd"]), true),
    ).toEqual({
      DATABASE_DIALECT: "mysql",
      DATABASE_URL: "mysql://root:termix@termix-dev-mysql:3306/termix",
      GUACD_HOST: "termix-dev-guacd",
      GUACD_PORT: "4822",
    });
  });
});

describe("appRunArgs", () => {
  it("mounts the data and the staged plugins", () => {
    const args = appRunArgs({
      port: 9000,
      env: { GUACD_HOST: "termix-dev-guacd" },
      dataMount: "termix-dev-data",
      pluginsDir: "/repo/dist/plugins",
    });
    expect(args).toContain("9000:8080");
    expect(args).toContain("GUACD_HOST=termix-dev-guacd");
    expect(args).toContain("termix-dev-data:/app/data");
    expect(args).toContain("/repo/dist/plugins:/app/dist/plugins");
    expect(args.at(-1)).toBe("termix:dev");
  });
});
