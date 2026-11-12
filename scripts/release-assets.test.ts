import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  UPLOADING_LINE,
  addUploadingLine,
  collectFiles,
  compareAssets,
  createClient,
  expectedAssets,
  releaseState,
  stripUploadingLine,
  uploadOrder,
  uploadToDraft,
} = require("./release-assets.cjs");

type Asset = { name: string; state: string; digest: string };
type Release = { id: number; tag_name: string; draft: boolean };

function fakeClient(releases: Release[], assets: Asset[] = []) {
  const uploads: string[] = [];
  return {
    uploads,
    listReleases: async () => releases,
    getRelease: async (id: number) => releases.find((r) => r.id === id),
    listAssets: async () => assets,
    uploadAsset: async (_id: number, name: string) => {
      uploads.push(name);
    },
  };
}

const files = (names: string[]) =>
  new Map(names.map((name) => [name, `/tmp/${name}`]));

describe("release-assets", () => {
  it("lists the stable and beta files", () => {
    const stable = expectedAssets("stable");
    const beta = expectedAssets("beta");
    expect(stable).toContain("latest.yml");
    expect(stable).toContain("termix_macos_universal_mas.pkg");
    expect(stable).toContain("termix.rb");
    expect(stable).not.toContain("beta.yml");
    expect(beta).toContain("beta-linux-arm64.yml");
    expect(beta).not.toContain("termix.rb");
    expect(beta).not.toContain("termix_macos_universal_mas.pkg");
    expect(new Set(stable).size).toBe(stable.length);
    expect(() => expectedAssets("nightly")).toThrow();
  });

  it("reports missing and unexpected files", () => {
    const names = expectedAssets("beta").filter(
      (n: string) => n !== "beta.yml",
    );
    expect(compareAssets("beta", [...names, "stray.txt"])).toEqual({
      missing: ["beta.yml"],
      unexpected: ["stray.txt"],
    });
    expect(compareAssets("beta", expectedAssets("beta"))).toEqual({
      missing: [],
      unexpected: [],
    });
  });

  it("adds the uploading line once and strips it", () => {
    const added = addUploadingLine("## Notes\n- a");
    expect(added.startsWith(UPLOADING_LINE)).toBe(true);
    expect(addUploadingLine(added)).toBe(added);
    expect(stripUploadingLine(added)).toBe("## Notes\n- a");
    expect(stripUploadingLine("## Notes")).toBe("## Notes");
  });

  it("puts update files last", () => {
    expect(
      uploadOrder(["latest.yml", "b.exe", "a.dmg", "beta-mac.yml"]),
    ).toEqual(["a.dmg", "b.exe", "beta-mac.yml", "latest.yml"]);
  });

  it("finds a draft and refuses a published release", async () => {
    expect((await releaseState(fakeClient([]), "v1.0.0")).state).toBe("none");
    const draft = { id: 1, tag_name: "v1.0.0", draft: true };
    expect((await releaseState(fakeClient([draft]), "v1.0.0")).state).toBe(
      "draft",
    );
    const published = { id: 2, tag_name: "v1.0.0", draft: false };
    expect(
      (await releaseState(fakeClient([draft, published]), "v1.0.0")).state,
    ).toBe("published");
    await expect(
      releaseState(fakeClient([draft, { ...draft, id: 3 }]), "v1.0.0"),
    ).rejects.toThrow(/more than one draft/);
  });

  it("never uploads to a published release", async () => {
    const client = fakeClient([{ id: 2, tag_name: "v1.0.0", draft: false }]);
    await expect(
      uploadToDraft(client, {
        tag: "v1.0.0",
        files: files(["a.exe"]),
        log: () => {},
        hash: () => "x",
        read: () => Buffer.from(""),
      }),
    ).rejects.toThrow(/already published/);
    expect(client.uploads).toEqual([]);
  });

  it("skips a file already uploaded with the same hash", async () => {
    const client = fakeClient(
      [{ id: 1, tag_name: "v1.0.0", draft: true }],
      [{ name: "a.exe", state: "uploaded", digest: "sha256:aaa" }],
    );
    const result = await uploadToDraft(client, {
      tag: "v1.0.0",
      files: files(["a.exe", "latest.yml"]),
      log: () => {},
      hash: () => "aaa",
      read: () => Buffer.from(""),
    });
    expect(result).toEqual({ uploaded: ["latest.yml"], skipped: ["a.exe"] });
    expect(client.uploads).toEqual(["latest.yml"]);
  });

  it("fails instead of replacing a file from another build", async () => {
    const client = fakeClient(
      [{ id: 1, tag_name: "v1.0.0", draft: true }],
      [{ name: "a.exe", state: "uploaded", digest: "sha256:old" }],
    );
    await expect(
      uploadToDraft(client, {
        tag: "v1.0.0",
        files: files(["a.exe"]),
        log: () => {},
        hash: () => "new",
        read: () => Buffer.from(""),
      }),
    ).rejects.toThrow(/another build/);
    expect(client.uploads).toEqual([]);
  });

  it("stops when the release is published mid upload", async () => {
    const release = { id: 1, tag_name: "v1.0.0", draft: true };
    const client = fakeClient([release]);
    client.getRelease = async () => ({ ...release, draft: false });
    await expect(
      uploadToDraft(client, {
        tag: "v1.0.0",
        files: files(["a.exe"]),
        log: () => {},
        hash: () => "x",
        read: () => Buffer.from(""),
      }),
    ).rejects.toThrow(/published during the upload/);
  });

  it("collects artifact files by name", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-assets-"));
    try {
      fs.mkdirSync(path.join(dir, "one"));
      fs.mkdirSync(path.join(dir, "two"));
      fs.writeFileSync(path.join(dir, "one", "a.exe"), "a");
      fs.writeFileSync(path.join(dir, "two", "b.yml"), "b");
      expect([...collectFiles(dir).keys()].sort()).toEqual(["a.exe", "b.yml"]);
      fs.writeFileSync(path.join(dir, "two", "a.exe"), "c");
      expect(() => collectFiles(dir)).toThrow(/more than one artifact/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends uploads to the release by id with auth", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = createClient({
      token: "t",
      repo: "o/r",
      fetchImpl: async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: 201, json: async () => ({}) };
      },
    });
    await client.uploadAsset(7, "a b.exe", Buffer.from("x"));
    expect(calls[0].url).toBe(
      "https://uploads.github.com/repos/o/r/releases/7/assets?name=a%20b.exe",
    );
    expect(calls[0].init.method).toBe("POST");
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer t");
    expect(() => createClient({ token: "", repo: "o/r" })).toThrow();
  });
});
