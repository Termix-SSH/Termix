import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import {
  parseBundledPlugins,
  loadBundledPlugins,
  fetchArtifact,
  extractArtifact,
  pinsFromIndex,
} from "./lib/bundled-plugins.cjs";

const cleanups: Array<() => void> = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-bundled-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

const SHA = "a".repeat(64);

async function artifactFor(id: string): Promise<Buffer> {
  const src = tempDir();
  fs.writeFileSync(path.join(src, "manifest.json"), JSON.stringify({ id }));
  fs.mkdirSync(path.join(src, "dist"));
  fs.writeFileSync(path.join(src, "dist", "backend.js"), "export {}\n");
  const file = path.join(tempDir(), `${id}.tmxplug`);
  await tar.c({ gzip: true, file, cwd: src }, ["manifest.json", "dist"]);
  return fs.readFileSync(file);
}

const sha256 = (buffer: Buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");

describe("parseBundledPlugins", () => {
  it("accepts tmxplug entries", () => {
    const { plugins, problems } = parseBundledPlugins({
      plugins: [
        {
          id: "two",
          source: "tmxplug",
          url: "https://x/two.tmxplug",
          sha256: SHA,
        },
        {
          id: "three",
          source: "tmxplug",
          path: "vendor/three.tmxplug",
          sha256: SHA,
        },
      ],
    });
    expect(problems).toEqual([]);
    expect(plugins.map((p: { id: string }) => p.id)).toEqual(["two", "three"]);
  });

  it("reports bad entries", () => {
    const { problems } = parseBundledPlugins({
      plugins: [
        { id: "nohash", source: "tmxplug", url: "https://x" },
        { id: "plain", source: "tmxplug", url: "http://x", sha256: SHA },
        { id: "ok", source: "tmxplug", path: "a", sha256: SHA },
        { id: "ok", source: "tmxplug", path: "a", sha256: SHA },
        { id: "odd", source: "workspace" },
      ],
    });
    expect(problems).toEqual([
      "nohash needs a lowercase hex sha256",
      "plain needs exactly one of an https url or a path",
      "ok is listed twice",
      'odd has an unknown source "workspace"',
    ]);
  });

  it("reads the list in this repo", () => {
    const root = path.resolve(__dirname, "..");
    expect(() => loadBundledPlugins(root)).not.toThrow();
  });
});

describe("tmxplug entries", () => {
  it("unpacks an artifact that matches its pinned sha256", async () => {
    const root = tempDir();
    const buffer = await artifactFor("demo");
    fs.writeFileSync(path.join(root, "demo.tmxplug"), buffer);

    const fetched = await fetchArtifact(
      { id: "demo", path: "demo.tmxplug", sha256: sha256(buffer) },
      root,
    );
    const out = path.join(root, "dist", "plugins", "demo");
    await extractArtifact(fetched, out, "demo");
    expect(fs.existsSync(path.join(out, "dist", "backend.js"))).toBe(true);
  });

  it("refuses an artifact whose sha256 differs", async () => {
    const root = tempDir();
    fs.writeFileSync(
      path.join(root, "demo.tmxplug"),
      await artifactFor("demo"),
    );
    await expect(
      fetchArtifact({ id: "demo", path: "demo.tmxplug", sha256: SHA }, root),
    ).rejects.toThrow(/bundled-plugins.json pins/);
  });

  it("downloads once and reuses the cache", async () => {
    const root = tempDir();
    const buffer = await artifactFor("demo");
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      return new Response(buffer);
    };
    const entry = {
      id: "demo",
      url: "https://example.test/demo.tmxplug",
      sha256: sha256(buffer),
    };
    await fetchArtifact(entry, root, fakeFetch);
    await fetchArtifact(entry, root, fakeFetch);
    expect(calls).toBe(1);
  });

  it("refuses an artifact for a different id", async () => {
    const out = path.join(tempDir(), "demo");
    await expect(
      extractArtifact(await artifactFor("other"), out, "demo"),
    ).rejects.toThrow(/is for "other"/);
  });
});

describe("pinsFromIndex", () => {
  const index = {
    plugins: [
      {
        id: "beta",
        versions: [
          {
            version: "1.1.0",
            url: "https://example.test/beta-1.1.0.tmxplug",
            sha256: "b".repeat(64),
          },
          {
            version: "1.0.0",
            url: "https://example.test/beta-1.0.0.tmxplug",
            sha256: SHA,
          },
        ],
      },
      {
        id: "alpha",
        versions: [
          {
            version: "1.0.0",
            url: "https://example.test/alpha-1.0.0.tmxplug",
            sha256: "c".repeat(64),
          },
        ],
      },
    ],
  };

  it("pins the newest version of every plugin, sorted by id", () => {
    const pins = pinsFromIndex(index, null);
    expect(pins.map((pin) => pin.id)).toEqual(["alpha", "beta"]);
    expect(pins[1]).toEqual({
      id: "beta",
      source: "tmxplug",
      url: "https://example.test/beta-1.1.0.tmxplug",
      sha256: "b".repeat(64),
    });
    expect(parseBundledPlugins({ plugins: pins }).problems).toEqual([]);
  });

  it("pins only the ids asked for", () => {
    expect(pinsFromIndex(index, ["beta"]).map((pin) => pin.id)).toEqual([
      "beta",
    ]);
  });

  it("refuses an id the index does not list", () => {
    expect(() => pinsFromIndex(index, ["gamma"])).toThrow(
      /not in the registry/,
    );
  });
});
