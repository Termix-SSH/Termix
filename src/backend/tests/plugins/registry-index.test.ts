import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fetchMock = vi.hoisted(() => vi.fn());
const testKey = vi.hoisted(() => ({ value: null as null | object }));

vi.mock("../../utils/safe-outbound-fetch.js", () => ({
  safeOutboundFetch: fetchMock,
}));

vi.mock("../../plugins/trust.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../plugins/trust.js")>();
  return {
    ...actual,
    verifyPluginArtifact: (buffer: Buffer, sha256: string, signature: string) =>
      actual.verifyPluginArtifact(buffer, sha256, signature, [
        testKey.value as never,
      ]),
  };
});

import {
  downloadRelease,
  fetchRegistryIndex,
  findRelease,
  isApiCompatible,
  parseRegistryIndex,
  resetRegistryCache,
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
    expect(await fetchRegistryIndex({ force: true })).toBe(first);
  });

  it("throws when there is nothing cached", async () => {
    fetchMock.mockResolvedValueOnce(response("down", 503));
    await expect(fetchRegistryIndex()).rejects.toThrow(/503/);
  });
});

describe("downloadRelease", () => {
  const artifact = Buffer.from("plugin archive bytes");

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

  it("refuses a file that does not match its signature", async () => {
    const signed = sign(artifact);
    fetchMock.mockResolvedValueOnce(response(Buffer.from("something else!!!")));
    await expect(
      downloadRelease("docker", version({ ...signed, size: 0 })),
    ).rejects.toThrow(/sha256/);
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
