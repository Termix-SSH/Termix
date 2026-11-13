/**
 * The desktop starts each plugin backend as its own utility process, only
 * when the request passes the same checks the Docker launcher makes.
 */
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import * as policy from "../src/backend/plugins/sandbox/launcher/policy.js";

const require = createRequire(import.meta.url);
const { createPluginSandboxHost } = require("../electron/plugin-sandbox.cjs");

const backendDir = path.resolve("/app/dist/backend/backend");
const dataRoot = path.resolve("/data");
const harden = path.join(
  backendDir,
  "plugins",
  "sandbox",
  "child",
  "harden.js",
);

function setup() {
  const forks: Array<{ script: string; options: Record<string, unknown> }> = [];
  const posted: Array<{
    message: Record<string, unknown>;
    transfer: unknown[];
  }> = [];
  const childPosts: unknown[] = [];
  const utilityProcess = {
    fork: (
      script: string,
      _args: string[],
      options: Record<string, unknown>,
    ) => {
      forks.push({ script, options });
      const child = Object.assign(new EventEmitter(), {
        pid: 4321,
        stdout: null,
        stderr: null,
        postMessage: (m: unknown, t: unknown[]) => childPosts.push([m, t]),
        kill: vi.fn(),
      });
      setImmediate(() => child.emit("spawn"));
      return child;
    },
  };
  class MessageChannelMain {
    port1 = { name: "core side" };
    port2 = { name: "plugin side" };
  }
  const backend = {
    postMessage: (message: Record<string, unknown>, transfer: unknown[]) =>
      posted.push({ message, transfer }),
  };
  const host = createPluginSandboxHost({
    utilityProcess,
    MessageChannelMain,
    backendDir,
    dataRoot,
    loadPolicy: () => policy,
  });
  return { host, backend, forks, posted, childPosts };
}

function spawnMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: "tmx-sandbox",
    op: "spawn",
    id: "r1",
    pluginId: "docker",
    dataDir: path.join(dataRoot, "plugin-data", "docker"),
    env: { NODE_ENV: "production", TERMIX_SANDBOX_PLUGIN: "docker" },
    execArgv: [
      "--permission",
      "--allow-fs-read=/app/dist/plugins/docker",
      "--max-old-space-size=256",
      `--import=${pathToFileURL(harden).href}`,
    ],
    ...overrides,
  };
}

describe("desktop plugin sandbox host", () => {
  it("starts the runtime as a utility process and hands each side a port", async () => {
    const { host, backend, forks, posted, childPosts } = setup();
    vi.spyOn(require("fs"), "mkdirSync").mockImplementation(() => undefined);
    expect(host.handle(spawnMessage(), backend)).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(forks[0].script).toBe(
      path.join(backendDir, "plugins", "sandbox", "child", "runtime.js"),
    );
    expect(forks[0].options.execArgv).toContain("--permission");
    expect(forks[0].options.env).toEqual({
      NODE_ENV: "production",
      TERMIX_SANDBOX_PLUGIN: "docker",
    });
    expect(posted[0].message).toMatchObject({
      op: "spawned",
      id: "r1",
      pid: 4321,
    });
    expect(posted[0].transfer).toEqual([{ name: "core side" }]);
    expect(childPosts[0]).toEqual([
      { type: "tmx-sandbox", op: "port" },
      [{ name: "plugin side" }],
    ]);
  });

  it("refuses a core secret or a Node option in the env", () => {
    const { host, backend, forks } = setup();
    for (const extra of [{ JWT_SECRET: "x" }, { NODE_OPTIONS: "--inspect" }]) {
      host.handle(
        spawnMessage({
          id: Math.random().toString(),
          env: {
            NODE_ENV: "production",
            TERMIX_SANDBOX_PLUGIN: "docker",
            ...extra,
          },
        }),
        backend,
      );
    }
    expect(forks).toHaveLength(0);
  });

  it("refuses a request the launcher policy refuses", () => {
    const { host, backend, forks, posted } = setup();
    host.handle(spawnMessage({ execArgv: ["--inspect"] }), backend);
    expect(forks).toHaveLength(0);
    expect(posted[0].message).toMatchObject({ op: "error", id: "r1" });
  });

  it("ignores messages that are not for it", () => {
    const { host, backend } = setup();
    expect(host.handle({ type: "backend-request" }, backend)).toBe(false);
  });

  it("stays out of the main window's IPC: only the backend can ask", async () => {
    const { readFileSync } = await import("node:fs");
    const main = readFileSync("electron/main.cjs", "utf8");
    expect(main).toContain("pluginSandbox?.handle(msg, spawned)");
    expect(main).not.toMatch(/ipcMain\.\w+\([^)]*tmx-sandbox/);
  });
});
