/**
 * The root launcher only starts plugin processes, fenced, as the plugin's own
 * user. A core that was taken over must not be able to use it for anything
 * else.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  allocateUid,
  UID_FIRST,
  validateSpawn,
} from "../../../../plugins/sandbox/launcher/policy.js";

const dataRoot = path.resolve("/app/data");
const hardenUrl =
  "file:///app/dist/backend/backend/plugins/sandbox/child/harden.js";
const expected = { hardenUrl, dataRoot };

function request(overrides: Record<string, unknown> = {}) {
  return {
    pluginId: "docker",
    dataDir: path.join(dataRoot, "plugin-data", "docker"),
    env: { NODE_ENV: "production", TERMIX_SANDBOX_PLUGIN: "docker" },
    execArgv: [
      "--permission",
      "--allow-fs-read=/app/dist/plugins/docker",
      "--max-semi-space-size=1",
      "--max-old-space-size=256",
      "--expose-gc",
      "--disable-sigusr1",
      `--import=${hardenUrl}`,
    ],
    firewall: "deny",
    ...overrides,
  };
}

describe("launcher spawn policy", () => {
  it("accepts a normal plugin start", () => {
    expect(validateSpawn(request(), expected)).toEqual({ ok: true });
  });

  // harden.js is always there and keeps every worker on the same flags.
  it("accepts a worker grant next to the harden preload", () => {
    expect(
      validateSpawn(
        request({ execArgv: [...request().execArgv, "--allow-worker"] }),
        expected,
      ),
    ).toEqual({ ok: true });
  });

  it("passes a variable the plugin's manifest lists", () => {
    expect(
      validateSpawn(
        request({
          env: {
            NODE_ENV: "production",
            TERMIX_SANDBOX_PLUGIN: "docker",
            SNIPPET_EXECUTION_TIMEOUT_SECONDS: "60",
          },
        }),
        expected,
      ),
    ).toEqual({ ok: true });
  });

  it.each([
    [
      "no permission model",
      {
        execArgv: [
          "--expose-gc",
          `--import=${hardenUrl}`,
          "--max-old-space-size=256",
        ],
      },
    ],
    [
      "an inspector flag",
      { execArgv: [...request().execArgv, "--inspect=0.0.0.0:9229"] },
    ],
    [
      "a worker grant without the harden preload",
      {
        execArgv: [
          ...request().execArgv.filter((a) => !a.startsWith("--import=")),
          "--allow-worker",
        ],
      },
    ],
    [
      "another preload",
      { execArgv: [...request().execArgv, "--import=file:///tmp/evil.js"] },
    ],
    [
      "a relative read grant",
      { execArgv: [...request().execArgv, "--allow-fs-read=../../"] },
    ],
    [
      "a wildcard read grant",
      { execArgv: [...request().execArgv, "--allow-fs-read=/app/*"] },
    ],
    [
      "writing core's data",
      { execArgv: [...request().execArgv, "--allow-fs-write=/app/data"] },
    ],
    [
      "writing another plugin's data",
      { dataDir: path.join(dataRoot, "plugin-data", "snippets") },
    ],
    ["a path in the plugin id", { pluginId: "../root" }],
    [
      "a Node option in the env",
      {
        env: {
          NODE_ENV: "production",
          TERMIX_SANDBOX_PLUGIN: "docker",
          NODE_OPTIONS: "--inspect",
        },
      },
    ],
    [
      "the addon switch only Electron gets",
      {
        env: {
          NODE_ENV: "production",
          TERMIX_SANDBOX_PLUGIN: "docker",
          TERMIX_SANDBOX_ADDONS: "1",
        },
      },
    ],
    [
      "a core secret in the env",
      {
        env: {
          NODE_ENV: "production",
          TERMIX_SANDBOX_PLUGIN: "docker",
          JWT_SECRET: "x",
        },
      },
    ],
    [
      "a database setting in the env",
      {
        env: {
          NODE_ENV: "production",
          TERMIX_SANDBOX_PLUGIN: "docker",
          DATABASE_URL: "x",
        },
      },
    ],
    [
      "a preload library in the env",
      {
        env: {
          NODE_ENV: "production",
          TERMIX_SANDBOX_PLUGIN: "docker",
          LD_PRELOAD: "/x.so",
        },
      },
    ],
    [
      "a mismatched plugin env",
      { env: { NODE_ENV: "production", TERMIX_SANDBOX_PLUGIN: "snippets" } },
    ],
    [
      "no heap cap",
      {
        execArgv: request().execArgv.filter((a) => !a.startsWith("--max-old")),
      },
    ],
    [
      "a missing preload",
      { execArgv: request().execArgv.filter((a) => !a.startsWith("--import")) },
    ],
    ["a made up firewall rule", { firewall: "open" }],
  ])("refuses %s", (_name, overrides) => {
    expect(validateSpawn(request(overrides), expected).ok).toBe(false);
  });

  it("gives each plugin its own stable user", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tmx-uids-"));
    const file = path.join(dir, "uids.json");
    const docker = allocateUid(file, "docker");
    const snippets = allocateUid(file, "snippets");
    expect(docker).toBe(UID_FIRST);
    expect(snippets).not.toBe(docker);
    expect(allocateUid(file, "docker")).toBe(docker);
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
