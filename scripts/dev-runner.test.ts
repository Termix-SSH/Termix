import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDebouncer,
  createSerialQueue,
  dataDirFor,
  findBuildablePlugins,
  isPluginSourceChange,
  needsDocker,
  parseDevArgs,
  parseTscStatus,
} from "./lib/dev-runner.mjs";

const cleanups: Array<() => void> = [];

afterEach(() => {
  vi.useRealTimers();
  while (cleanups.length) cleanups.pop()!();
});

describe("parseTscStatus", () => {
  it("reads the error count from a watch summary", () => {
    expect(
      parseTscStatus(
        "12:00:00 PM - Found 0 errors. Watching for file changes.",
      ),
    ).toBe(0);
    expect(parseTscStatus("Found 1 error. Watching for file changes.")).toBe(1);
    expect(parseTscStatus("src/a.ts(1,1): error TS2304: x")).toBeNull();
  });
});

describe("isPluginSourceChange", () => {
  it("accepts sources and skips build output", () => {
    expect(
      isPluginSourceChange(["src", "backend", "index.ts"].join("\\")),
    ).toBe(true);
    expect(isPluginSourceChange("locales/en.json")).toBe(true);
    expect(isPluginSourceChange("manifest.json")).toBe(true);
    expect(isPluginSourceChange("dist/backend.js")).toBe(false);
    expect(isPluginSourceChange("node_modules/x/index.js")).toBe(false);
    expect(isPluginSourceChange("notes.txt")).toBe(false);
    expect(isPluginSourceChange(null)).toBe(false);
  });
});

describe("findBuildablePlugins", () => {
  it("lists repos with a manifest and installed dependencies", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-dev-"));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const make = (name: string, id: string, deps = true) => {
      const repo = path.join(dir, name);
      fs.mkdirSync(repo);
      fs.writeFileSync(
        path.join(repo, "manifest.json"),
        JSON.stringify({ id }),
      );
      if (deps) fs.mkdirSync(path.join(repo, "node_modules"));
    };
    make("Plugin-B", "b");
    make("Plugin-A", "a");
    make("Plugin-C", "c", false);
    fs.mkdirSync(path.join(dir, "notes"));

    expect(findBuildablePlugins(dir).map((p) => p.id)).toEqual(["a", "b"]);
    expect(findBuildablePlugins(null)).toEqual([]);
  });
});

describe("createSerialQueue", () => {
  it("runs one task at a time and survives a failure", async () => {
    const queue = createSerialQueue();
    const order: string[] = [];
    const first = queue(async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push("first");
      throw new Error("boom");
    });
    const second = queue(async () => order.push("second"));
    await expect(first).rejects.toThrow("boom");
    await second;
    expect(order).toEqual(["first", "second"]);
  });
});

describe("createDebouncer", () => {
  it("fires once per quiet key and again for a change mid-run", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const calls: string[] = [];
    const trigger = createDebouncer(100, async (key: string) => {
      calls.push(key);
      if (calls.length === 1) await new Promise<void>((r) => (release = r));
    });

    trigger("a");
    trigger("a");
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual(["a"]);

    trigger("a");
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual(["a"]);
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual(["a", "a"]);
    trigger.cancel();
  });
});

describe("parseDevArgs", () => {
  it("defaults to the web target with sqlite and local plugins", () => {
    expect(parseDevArgs([])).toMatchObject({
      target: "web",
      db: "sqlite",
      local: true,
      guacd: false,
      fresh: false,
      port: 8081,
    });
  });

  it("reads a target and options in any order", () => {
    expect(
      parseDevArgs(["--db", "Postgres", "electron", "--guacd", "--fresh"]),
    ).toMatchObject({
      target: "electron",
      db: "postgres",
      guacd: true,
      fresh: true,
    });
    expect(
      parseDevArgs(["docker", "--port", "9000", "--no-cache", "--no-local"]),
    ).toMatchObject({
      target: "docker",
      port: 9000,
      noCache: true,
      local: false,
    });
    expect(parseDevArgs(["--plugins", "../x"]).pluginsDir).toBe("../x");
  });

  it("refuses unknown or incomplete options", () => {
    expect(() => parseDevArgs(["--bogus"])).toThrow(/Unknown option/);
    expect(() => parseDevArgs(["--db", "oracle"])).toThrow(/--db/);
    expect(() => parseDevArgs(["--db"])).toThrow(/needs a value/);
    expect(() => parseDevArgs(["--port", "abc"])).toThrow(/port/);
    expect(() => parseDevArgs(["--fresh", "--data", "x"])).toThrow(/together/);
  });
});

describe("dataDirFor", () => {
  it("keeps each engine and fresh runs in their own folder", () => {
    expect(dataDirFor(parseDevArgs([]))).toBeNull();
    expect(dataDirFor(parseDevArgs(["--db", "mysql"]))).toBe("db/data-mysql");
    expect(dataDirFor(parseDevArgs(["--fresh"]))).toBe("db/data-fresh");
    expect(dataDirFor(parseDevArgs(["--fresh", "--db", "postgres"]))).toBe(
      "db/data-fresh-postgres",
    );
    expect(dataDirFor(parseDevArgs(["--data", "x"]))).toBe("x");
    expect(dataDirFor(parseDevArgs(["electron"]))).toBe("db/data-desktop");
    expect(dataDirFor(parseDevArgs(["electron", "--db", "mysql"]))).toBe(
      "db/data-desktop-mysql",
    );
    expect(dataDirFor(parseDevArgs(["electron", "--fresh"]))).toBe(
      "db/data-fresh-desktop",
    );
  });
});

describe("needsDocker", () => {
  it("is only true when something runs in a container", () => {
    expect(needsDocker(parseDevArgs([]))).toBe(false);
    expect(needsDocker(parseDevArgs(["electron"]))).toBe(false);
    expect(needsDocker(parseDevArgs(["docker"]))).toBe(true);
    expect(needsDocker(parseDevArgs(["--db", "postgres"]))).toBe(true);
    expect(needsDocker(parseDevArgs(["--guacd"]))).toBe(true);
  });
});
