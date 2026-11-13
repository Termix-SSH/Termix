/**
 * The capability to process flag table: every plugin process gets the fence,
 * and only a granted capability opens anything.
 */
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_PROCESS_GRANTS,
  CAPABILITY_CATALOG,
} from "@termix-ssh/plugin-sdk/capabilities";
import { buildChildFlags } from "../../../plugins/sandbox/capability-flags.js";

const base = {
  readPaths: ["/app/dist/plugins/x"],
  dataDir: "/app/data/plugin-data/x",
  hardenPath: "/app/dist/backend/backend/plugins/sandbox/child/harden.js",
  nodeMajor: 26,
};

describe("buildChildFlags", () => {
  it("fences a plugin with no process capabilities completely", () => {
    const flags = buildChildFlags({
      ...base,
      granted: ["kv:own", "ssh:connect"],
    });
    expect(flags.execArgv[0]).toBe("--permission");
    expect(flags.execArgv).toContain("--disable-sigusr1");
    expect(flags.execArgv.some((a) => a.startsWith("--allow-fs-write"))).toBe(
      false,
    );
    for (const flag of [
      "--allow-net",
      "--allow-child-process",
      "--allow-addons",
      "--allow-worker",
      "--allow-wasi",
    ]) {
      expect(flags.execArgv).not.toContain(flag);
    }
    expect(flags.execArgv.at(-1)).toMatch(/^--import=file:.*harden\.js$/);
    expect(flags.firewall).toBe("deny");
  });

  it("opens only what each granted capability names", () => {
    const flags = buildChildFlags({
      ...base,
      granted: [
        "network:sockets",
        "process:spawn",
        "device:serial",
        "files:own",
      ],
    });
    expect(flags.execArgv).toEqual(
      expect.arrayContaining([
        "--allow-net",
        "--allow-child-process",
        "--allow-addons",
        "--allow-fs-write=/app/data/plugin-data/x",
      ]),
    );
    expect(flags.firewall).toBe("allow-all");
  });

  it("leaves --allow-net out on Node 24, which has no network fence", () => {
    const flags = buildChildFlags({
      ...base,
      nodeMajor: 24,
      granted: ["network:sockets"],
    });
    expect(flags.execArgv).not.toContain("--allow-net");
    expect(flags.allowNet).toBe(true);
    expect(flags.unenforced).toEqual(["network"]);
  });

  it("caps the heap at the plugin's memory limit", () => {
    const flags = buildChildFlags({ ...base, granted: [], heapMb: 512 });
    expect(flags.execArgv).toContain("--max-old-space-size=512");
  });

  it("names only real catalog capabilities and never grants workers", () => {
    const known = new Set(CAPABILITY_CATALOG.map((c) => c.id));
    for (const [capability, grant] of Object.entries(
      CAPABILITY_PROCESS_GRANTS,
    )) {
      expect(known.has(capability)).toBe(true);
      expect(grant.flags).not.toContain("--allow-worker");
      expect(grant.flags).not.toContain("--allow-wasi");
    }
  });
});
