import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ granted: new Set<string>() }));

vi.mock("../../plugins/permissions.js", async () => {
  const { PluginCapabilityError } = await import("@termix/plugin-sdk/backend");
  return {
    assertCapability: async (
      pluginId: string,
      capability: string,
      declared: readonly string[],
    ) => {
      if (!declared.includes(capability) || !h.granted.has(capability)) {
        throw new PluginCapabilityError(pluginId, capability);
      }
    },
  };
});

const { createPluginProcess } = await import("../../plugins/ctx-process.js");
const { DisposableBag } = await import("../../plugins/disposables.js");
const { PluginCapabilityError } = await import("@termix/plugin-sdk/backend");

const DECLARED = ["process:spawn", "network:outbound"];

function manifest(capabilities: string[] = DECLARED) {
  return {
    id: "fixture",
    name: "Fixture",
    version: "1.0.0",
    capabilities,
  } as never;
}

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

let dir: string;
let audits: Array<{ action: string; success: boolean }>;

function create(
  options: { capabilities?: string[]; fetch?: typeof fetch } = {},
) {
  const bag = new DisposableBag("fixture");
  const process = createPluginProcess({
    manifest: manifest(options.capabilities),
    bag,
    audit: async (action, _details, outcome) => {
      audits.push({ action, success: outcome.success });
    },
    binDir: () => path.join(dir, "bin"),
    fetch: options.fetch,
  });
  return { process, bag };
}

beforeEach(async () => {
  h.granted = new Set(DECLARED);
  audits = [];
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-process-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("ctx.process.run", () => {
  it("runs a program and streams its output", async () => {
    const { process: proc } = create();
    const child = await proc.run(globalThis.process.execPath, [
      "-e",
      "process.stdout.write('hello'); process.stderr.write('oops')",
    ]);
    let out = "";
    let err = "";
    child.onStdout((chunk) => (out += chunk));
    child.onStderr((chunk) => (err += chunk));
    await expect(child.exited).resolves.toEqual({ code: 0, signal: null });
    expect(out).toBe("hello");
    expect(err).toBe("oops");
    expect(audits).toContainEqual({ action: "process_run", success: true });
  });

  it("refuses without process:spawn, and audits the refusal", async () => {
    h.granted = new Set();
    const { process: proc } = create();
    await expect(
      proc.run(globalThis.process.execPath, ["-e", ""]),
    ).rejects.toBeInstanceOf(PluginCapabilityError);
    expect(audits).toContainEqual({ action: "process_run", success: false });
  });

  it("kills what is still running on deactivate", async () => {
    const { process: proc, bag } = create();
    const child = await proc.run(globalThis.process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    await bag.disposeAll();
    const exit = await child.exited;
    expect(exit.code === null || exit.signal !== null).toBe(true);
  });
});

describe("ctx.process.ensureBinary", () => {
  const contents = "#!/bin/sh\necho hi\n";

  it("uses a prebuilt copy whose checksum matches, without downloading", async () => {
    const prebuilt = path.join(dir, "prebuilt-tool");
    await fs.writeFile(prebuilt, contents);
    const fetch = vi.fn();
    const { process: proc } = create({ fetch: fetch as never });
    await expect(
      proc.ensureBinary({
        name: "tool",
        version: "1",
        url: "https://example.test/tool",
        sha256: sha256(contents),
        prebuilt: [path.join(dir, "missing"), prebuilt],
      }),
    ).resolves.toBe(prebuilt);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("downloads once, verifies it and reuses the copy", async () => {
    const fetch = vi.fn(async () => new Response(contents));
    const { process: proc } = create({ fetch: fetch as never });
    const spec = {
      name: "tool",
      version: "1",
      url: "https://example.test/tool",
      sha256: sha256(contents),
    };
    const first = await proc.ensureBinary(spec);
    expect(first).toBe(path.join(dir, "bin", "tool"));
    expect(await fs.readFile(first, "utf8")).toBe(contents);
    await proc.ensureBinary(spec);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("refuses a download whose checksum does not match", async () => {
    const fetch = vi.fn(async () => new Response("tampered"));
    const { process: proc } = create({ fetch: fetch as never });
    await expect(
      proc.ensureBinary({
        name: "tool",
        version: "1",
        url: "https://example.test/tool",
        sha256: sha256(contents),
        prebuilt: [],
      }),
    ).rejects.toThrow(/Checksum mismatch/);
    await expect(fs.access(path.join(dir, "bin", "tool"))).rejects.toThrow();
  });

  it("needs network:outbound only to download", async () => {
    h.granted = new Set(["process:spawn"]);
    const { process: proc } = create({
      fetch: vi.fn(async () => new Response(contents)) as never,
    });
    await expect(
      proc.ensureBinary({
        name: "tool",
        version: "1",
        url: "https://example.test/tool",
        sha256: sha256(contents),
      }),
    ).rejects.toBeInstanceOf(PluginCapabilityError);
  });

  it("refuses plain http and odd file names", async () => {
    const { process: proc } = create({
      fetch: vi.fn(async () => new Response(contents)) as never,
    });
    await expect(
      proc.ensureBinary({
        name: "tool",
        version: "1",
        url: "http://example.test/tool",
        sha256: sha256(contents),
      }),
    ).rejects.toThrow(/https/);
    await expect(
      proc.ensureBinary({
        name: "../tool",
        version: "1",
        url: "https://example.test/tool",
        sha256: sha256(contents),
      }),
    ).rejects.toThrow(/Invalid binary name/);
  });
});
