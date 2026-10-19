import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";

const fetchMock = vi.hoisted(() => vi.fn());
const testKey = vi.hoisted(() => ({ value: null as null | object }));

vi.mock("../../utils/safe-outbound-fetch.js", () => ({
  safeOutboundFetch: fetchMock,
}));

vi.mock("../../utils/app-version.js", () => ({
  getLocalVersion: () => "26.10.3",
}));

vi.mock("../../plugins/trust.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../plugins/trust.js")>();
  return {
    ...actual,
    // The built in official keys are swapped for the test key. Keys a
    // caller passes for another registry are used as they are.
    verifyPluginArtifact: (
      buffer: Buffer,
      sha256: string,
      signature: string,
      keys?: readonly unknown[],
    ) =>
      actual.verifyPluginArtifact(
        buffer,
        sha256,
        signature,
        keys && keys !== actual.TRUSTED_PLUGIN_KEYS
          ? (keys as never)
          : [testKey.value as never],
      ),
  };
});

import {
  communitySource,
  downloadRelease,
  fetchRegistryIndex,
  fetchRegistryStats,
  findRelease,
  latestOnChannel,
  getStatsUrl,
  canRunRelease,
  isApiCompatible,
  neededTermix,
  parseRegistryIndex,
  parseRegistryStats,
  resetRegistryCache,
  type RegistrySource,
  type RegistryVersion,
} from "../../plugins/registry-index.js";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
testKey.value = {
  id: "test",
  publicKey: publicKey
    .export({ format: "der", type: "spki" })
    .subarray(12)
    .toString("base64"),
  addedIn: "26.10.0",
};

function sign(buffer: Buffer) {
  const digest = crypto.createHash("sha256").update(buffer).digest();
  return {
    sha256: digest.toString("hex"),
    signature: crypto.sign(null, digest, privateKey).toString("base64"),
  };
}

function response(body: string | Buffer, status = 200, headers = {}) {
  return new Response(status >= 300 && status < 400 ? null : body, {
    status,
    headers,
  });
}

function version(overrides: Partial<RegistryVersion> = {}) {
  return {
    version: "1.0.0",
    api: "1",
    url: "https://example.com/p-1.0.0.tmxplug",
    sha256: "a".repeat(64),
    signature: "sig",
    size: 10,
    capabilities: ["kv:own"],
    publishedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-registry-"));
  process.env.DATA_DIR = dataDir;
  fetchMock.mockReset();
  resetRegistryCache();
});

afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("parseRegistryIndex publicKey", () => {
  const key = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(12)
    .toString("base64");

  it("keeps a valid key and drops anything else", () => {
    expect(parseRegistryIndex({ publicKey: key, plugins: [] }).publicKey).toBe(
      key,
    );
    expect(
      parseRegistryIndex({ publicKey: "not a key", plugins: [] }).publicKey,
    ).toBeUndefined();
    expect(
      parseRegistryIndex({ publicKey: 42, plugins: [] }).publicKey,
    ).toBeUndefined();
  });
});

describe("parseRegistryIndex", () => {
  it("keeps valid entries and sorts versions newest first", () => {
    const index = parseRegistryIndex({
      registry: "official",
      plugins: [
        {
          id: "docker",
          name: "Docker",
          versions: [version(), version({ version: "1.2.0" })],
        },
      ],
    });
    expect(index.plugins).toHaveLength(1);
    expect(index.plugins[0].versions.map((v) => v.version)).toEqual([
      "1.2.0",
      "1.0.0",
    ]);
  });

  it("drops entries with a bad id, no https url or a malformed sha256", () => {
    const index = parseRegistryIndex({
      plugins: [
        { id: "../evil", versions: [version()] },
        { id: "plain", versions: [version({ url: "http://x/y.tmxplug" })] },
        { id: "short", versions: [version({ sha256: "abc" })] },
        { id: "ok", versions: [version()] },
      ],
    });
    expect(index.plugins.map((p) => p.id)).toEqual(["ok"]);
  });

  it("keeps release notes and only a YouTube video id", () => {
    const NOTES = "### Added\n- Thing";
    const index = parseRegistryIndex({
      plugins: [
        {
          id: "docker",
          video: "https://youtu.be/dQw4w9WgXcQ",
          versions: [version({ notes: NOTES })],
        },
        {
          id: "other",
          video: "https://evil.example/watch?v=dQw4w9WgXcQ",
          versions: [version({ notes: "x".repeat(30_000) })],
        },
      ],
    });
    expect(index.plugins[0].videoId).toBe("dQw4w9WgXcQ");
    expect(index.plugins[0].versions[0].notes).toBe(NOTES);
    expect(index.plugins[1].videoId).toBeUndefined();
    expect(index.plugins[1].versions[0].notes).toHaveLength(20_000);
  });

  it("keeps only usable feature lines", () => {
    const index = parseRegistryIndex({
      plugins: [
        { id: "docker", features: ["Logs", 5, ""], versions: [version()] },
        { id: "other", features: "Logs", versions: [version()] },
      ],
    });
    expect(index.plugins[0].features).toEqual(["Logs"]);
    expect(index.plugins[1].features).toEqual([]);
  });

  it("keeps only https docs links", () => {
    const index = parseRegistryIndex({
      plugins: [
        {
          id: "docker",
          docs: "https://docs.termix.site/plugins/docker/",
          versions: [version()],
        },
        { id: "other", docs: "javascript:alert(1)", versions: [version()] },
      ],
    });
    expect(index.plugins[0].docs).toBe(
      "https://docs.termix.site/plugins/docker",
    );
    expect(index.plugins[1].docs).toBeUndefined();
  });

  it("refuses something that is not an index", () => {
    expect(() => parseRegistryIndex({ nope: true })).toThrow(/no plugins/);
  });
});

describe("findRelease", () => {
  const index = parseRegistryIndex({
    plugins: [
      {
        id: "docker",
        versions: [
          version({ version: "2.0.0", api: "2" }),
          version({ version: "1.1.0" }),
          version(),
        ],
      },
    ],
  });

  it("picks the newest release this build can run", () => {
    expect(isApiCompatible("1")).toBe(true);
    expect(isApiCompatible("2")).toBe(false);
    expect(findRelease(index, "docker")?.release.version).toBe("1.1.0");
  });

  it("finds an exact version", () => {
    expect(findRelease(index, "docker", "1.0.0")?.release.version).toBe(
      "1.0.0",
    );
    expect(findRelease(index, "docker", "9.9.9")).toBeNull();
    expect(findRelease(index, "missing")).toBeNull();
  });
});

describe("engine ranges", () => {
  const engine = (termix: string, api = "^1.0") => ({ api, termix });

  it("reads gated releases into versions and prereleases", () => {
    const index = parseRegistryIndex({
      plugins: [
        {
          id: "classic-layout",
          versions: [],
          gated: [
            version({ version: "1.1.0-beta.1", engine: engine(">=26.10.3") }),
            version({ version: "1.0.0", engine: engine(">=26.10.3") }),
          ],
          contributes: ["layouts", "tabs", "not valid"],
        },
      ],
    });
    const [plugin] = index.plugins;
    expect(plugin.versions.map((v) => v.version)).toEqual(["1.0.0"]);
    expect(plugin.prereleases.map((v) => v.version)).toEqual(["1.1.0-beta.1"]);
    expect(plugin.contributes).toEqual(["layouts", "tabs"]);
  });

  it("checks engine.termix and the full engine.api", () => {
    expect(canRunRelease(version({ engine: engine(">=26.10.3") }))).toBe(true);
    expect(canRunRelease(version({ engine: engine(">=26.11.0") }))).toBe(false);
    expect(neededTermix(version({ engine: engine(">=26.11.0") }))).toBe(
      ">=26.11.0",
    );
    expect(neededTermix(version({ engine: engine(">=26.10.0") }))).toBeNull();
    expect(
      canRunRelease(version({ engine: engine(">=26.10.0", "^1.99") })),
    ).toBe(false);
    expect(canRunRelease(version())).toBe(true);
  });

  it("skips a release this build is too old for", () => {
    const index = parseRegistryIndex({
      plugins: [
        {
          id: "docker",
          versions: [version({ version: "1.0.0" })],
          gated: [version({ version: "1.1.0", engine: engine(">=26.11.0") })],
        },
      ],
    });
    expect(findRelease(index, "docker")?.release.version).toBe("1.0.0");
  });
});

describe("prereleases", () => {
  const index = parseRegistryIndex({
    plugins: [
      {
        id: "docker",
        versions: [
          version({ version: "1.1.0" }),
          version({ version: "1.2.0-beta.1" }),
        ],
        prereleases: [
          version({ version: "1.2.0-beta.1" }),
          version({ version: "1.2.0-beta.10" }),
          version({ version: "1.3.0" }),
        ],
      },
      { id: "only-beta", prereleases: [version({ version: "0.1.0-beta.1" })] },
    ],
  });
  const docker = index.plugins[0];

  it("keeps betas out of the stable list and stable out of betas", () => {
    expect(docker.versions.map((v) => v.version)).toEqual(["1.1.0"]);
    expect(docker.prereleases.map((v) => v.version)).toEqual([
      "1.2.0-beta.10",
      "1.2.0-beta.1",
    ]);
    expect(docker.prereleases.every((v) => v.prerelease)).toBe(true);
    expect(index.plugins[1].versions).toEqual([]);
  });

  it("picks by channel and finds a beta by exact version", () => {
    expect(latestOnChannel(docker, "stable")?.version).toBe("1.1.0");
    expect(latestOnChannel(docker, "beta")?.version).toBe("1.2.0-beta.10");
    expect(findRelease(index, "docker")?.release.version).toBe("1.1.0");
    expect(
      findRelease(index, "docker", undefined, "beta")?.release.version,
    ).toBe("1.2.0-beta.10");
    expect(findRelease(index, "docker", "1.2.0-beta.1")?.release.version).toBe(
      "1.2.0-beta.1",
    );
    expect(findRelease(index, "only-beta")).toBeNull();
  });

  it("prefers a newer stable over an older beta", () => {
    const later = parseRegistryIndex({
      plugins: [
        {
          id: "docker",
          versions: [version({ version: "1.2.0" })],
          prereleases: [version({ version: "1.2.0-beta.3" })],
        },
      ],
    });
    expect(latestOnChannel(later.plugins[0], "beta")?.version).toBe("1.2.0");
  });
});

describe("fetchRegistryIndex", () => {
  const body = JSON.stringify({
    plugins: [{ id: "docker", versions: [version()] }],
  });

  it("follows redirects and caches the result", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response("", 302, { location: "https://cdn.example.com/index.json" }),
      )
      .mockResolvedValueOnce(response(body));

    const first = await fetchRegistryIndex();
    const second = await fetchRegistryIndex();
    expect(first.plugins[0].id).toBe("docker");
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://cdn.example.com/index.json",
    );
  });

  it("serves the stale copy when a refresh fails", async () => {
    fetchMock.mockResolvedValueOnce(response(body));
    const first = await fetchRegistryIndex();
    fetchMock.mockResolvedValueOnce(response("down", 503));
    expect(await fetchRegistryIndex(undefined, { force: true })).toBe(first);
  });

  it("caches each registry on its own", async () => {
    const other: RegistrySource = {
      id: "mine",
      name: "Mine",
      url: "https://example.com/mine/index.json",
      tier: "custom",
      keys: [],
    };
    fetchMock
      .mockResolvedValueOnce(response(body))
      .mockResolvedValueOnce(
        response(JSON.stringify({ registry: "mine", plugins: [] })),
      );
    const official = await fetchRegistryIndex();
    const mine = await fetchRegistryIndex(other);
    expect(official.plugins).toHaveLength(1);
    expect(mine.plugins).toHaveLength(0);
    expect(fetchMock.mock.calls[1][0]).toBe(other.url);
    expect(await fetchRegistryIndex(other)).toBe(mine);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when there is nothing cached", async () => {
    fetchMock.mockResolvedValueOnce(response("down", 503));
    await expect(fetchRegistryIndex()).rejects.toThrow(/503/);
  });
});

/** A real .tmxplug holding only a manifest, enough for the checks. */
function pack(manifest: Record<string, unknown>): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-pack-"));
  try {
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    const file = path.join(dir, "out.tmxplug");
    tar.c({ gzip: true, sync: true, file, cwd: dir }, ["manifest.json"]);
    return fs.readFileSync(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("downloadRelease", () => {
  const artifact = pack({
    id: "docker",
    version: "1.0.0",
    capabilities: ["kv:own"],
  });

  it("writes a verified artifact and its signature to staging", async () => {
    const signed = sign(artifact);
    fetchMock.mockResolvedValueOnce(response(artifact));

    const result = await downloadRelease(
      "docker",
      version({ ...signed, size: artifact.length }),
    );
    expect(fs.readFileSync(result.file)).toEqual(artifact);
    expect(fs.readFileSync(result.signatureFile, "utf8")).toBe(
      signed.signature,
    );
    expect(
      result.file.startsWith(path.join(dataDir, "plugins", ".downloads")),
    ).toBe(true);
  });

  it("refuses a file signed by a key this build does not trust", async () => {
    const other = crypto.generateKeyPairSync("ed25519").privateKey;
    const digest = crypto.createHash("sha256").update(artifact).digest();
    fetchMock.mockResolvedValueOnce(response(artifact));
    await expect(
      downloadRelease(
        "docker",
        version({
          sha256: digest.toString("hex"),
          signature: crypto.sign(null, digest, other).toString("base64"),
          size: artifact.length,
        }),
      ),
    ).rejects.toThrow(/trusted key/);
  });

  it.each([
    ["another plugin id", { id: "evil" }, /archive is for/],
    ["another version", { version: "9.9.9" }, /archive is version/],
    [
      "more capabilities than the index lists",
      { capabilities: ["kv:own", "credentials:read"] },
      /different capabilities/,
    ],
  ])("refuses a signed file with %s", async (_label, override, error) => {
    const tampered = pack({
      id: "docker",
      version: "1.0.0",
      capabilities: ["kv:own"],
      ...override,
    });
    const signed = sign(tampered);
    fetchMock.mockResolvedValueOnce(response(tampered));
    await expect(
      downloadRelease("docker", version({ ...signed, size: tampered.length })),
    ).rejects.toThrow(error);
    expect(fs.existsSync(path.join(dataDir, "plugins", ".downloads"))).toBe(
      false,
    );
  });

  it("refuses a file that does not match its signature", async () => {
    const signed = sign(artifact);
    fetchMock.mockResolvedValueOnce(response(Buffer.from("something else!!!")));
    await expect(
      downloadRelease("docker", version({ ...signed, size: 0 })),
    ).rejects.toThrow(/sha256/);
  });

  it("checks against the keys of the registry it came from", async () => {
    const signed = sign(artifact);
    const own = crypto.generateKeyPairSync("ed25519");
    const ownKey = {
      id: "own",
      publicKey: own.publicKey
        .export({ format: "der", type: "spki" })
        .subarray(12)
        .toString("base64"),
      addedIn: "admin",
    };
    fetchMock.mockResolvedValueOnce(response(artifact));
    await expect(
      downloadRelease("docker", version({ ...signed, size: artifact.length }), [
        ownKey,
      ]),
    ).rejects.toThrow(/trusted key/);

    const digest = crypto.createHash("sha256").update(artifact).digest();
    fetchMock.mockResolvedValueOnce(response(artifact));
    const result = await downloadRelease(
      "docker",
      version({
        sha256: digest.toString("hex"),
        signature: crypto.sign(null, digest, own.privateKey).toString("base64"),
        size: artifact.length,
      }),
      [ownKey],
    );
    expect(fs.readFileSync(result.file)).toEqual(artifact);
  });

  it("refuses a release built for another plugin API", async () => {
    await expect(
      downloadRelease("docker", version({ api: "2" })),
    ).rejects.toThrow(/plugin API/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a download larger than the index says", async () => {
    const signed = sign(artifact);
    fetchMock.mockResolvedValueOnce(response(Buffer.alloc(3 * 1024 * 1024)));
    await expect(
      downloadRelease("docker", version({ ...signed, size: 10 })),
    ).rejects.toThrow(/larger than allowed/);
  });
});

describe("registry stats", () => {
  it("sits next to the index", () => {
    expect(getStatsUrl()).toBe(
      "https://raw.githubusercontent.com/Termix-SSH/Termix-Registry/main/official/stats.json",
    );
  });

  it("has a community stats file and none for custom registries", () => {
    expect(getStatsUrl(communitySource())).toBe(
      "https://raw.githubusercontent.com/Termix-SSH/Termix-Registry/main/community/stats.json",
    );
    expect(
      getStatsUrl({
        id: "mine",
        name: "Mine",
        url: "https://example.com/index.json",
        tier: "custom",
        keys: [],
      }),
    ).toBeNull();
  });

  it("keeps valid counts and drops the rest", () => {
    const stats = parseRegistryStats({
      plugins: {
        docker: { downloads: 120 },
        tunnels: { downloads: 7 },
        "../bad": { downloads: 1 },
        broken: { downloads: -3 },
      },
    });
    expect(Object.fromEntries(stats.plugins)).toEqual({
      docker: 120,
      tunnels: 7,
      broken: 0,
    });
  });

  it("fetches and parses stats.json", async () => {
    fetchMock.mockResolvedValueOnce(
      response(JSON.stringify({ plugins: { docker: { downloads: 3 } } })),
    );
    const stats = await fetchRegistryStats();
    expect(stats?.plugins.get("docker")).toBe(3);
  });
});
