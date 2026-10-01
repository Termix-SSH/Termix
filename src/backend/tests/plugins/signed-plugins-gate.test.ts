/**
 * TERMIX_REQUIRE_SIGNED_PLUGINS against the real loader and real archives.
 * The pinned key list is swapped for a test key; nothing else is mocked.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { createFixturePlugin } from "./fixture-plugin.js";
import { PluginLoader } from "../../plugins/loader.js";

const testKey = vi.hoisted(() => ({
  privateKey: null as crypto.KeyObject | null,
  key: { id: "test", publicKey: "", addedIn: "2.9.0" },
}));

vi.mock("../../plugins/trust.js", async (importActual) => {
  const actual = await importActual<typeof import("../../plugins/trust.js")>();
  return {
    ...actual,
    verifyPluginArtifact: (buffer: Buffer, sha256: string, signature: string) =>
      actual.verifyPluginArtifact(buffer, sha256, signature, [testKey.key]),
  };
});

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginStorageRepository: () => ({
    get: async () => null,
    set: async () => {},
    delete: async () => false,
    listKeys: async () => [],
  }),
}));

{
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  testKey.privateKey = privateKey;
  testKey.key.publicKey = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(12)
    .toString("base64");
}

const cleanups: Array<() => void> = [];

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Bundled root with one plugin, and an empty user plugins dir. */
function setup() {
  const bundled = tempRoot("termix-bundled-");
  const data = tempRoot("termix-data-");
  const userDir = path.join(data, "plugins");
  fs.mkdirSync(userDir, { recursive: true });
  createFixturePlugin({ id: "bundled-one", root: bundled });
  process.env.TERMIX_BUNDLED_PLUGINS_DIR = bundled;
  process.env.DATA_DIR = data;
  return { userDir };
}

/** Writes <id>-1.0.0.tmxplug into `dir`, optionally with a .sig. */
async function writeArtifact(
  dir: string,
  id: string,
  sig: "valid" | "wrong-key" | "none",
  version = "1.0.0",
): Promise<string> {
  const build = tempRoot("termix-build-");
  createFixturePlugin({ id, root: build, manifestOverrides: { version } });
  const file = path.join(dir, `${id}-${version}.tmxplug`);
  await tar.c({ gzip: true, file, cwd: path.join(build, id) }, [
    "manifest.json",
    "backend",
  ]);
  if (sig !== "none") {
    const signer =
      sig === "valid"
        ? testKey.privateKey
        : crypto.generateKeyPairSync("ed25519").privateKey;
    const digest = crypto
      .createHash("sha256")
      .update(fs.readFileSync(file))
      .digest();
    fs.writeFileSync(
      `${file}.sig`,
      crypto.sign(null, digest, signer).toString("base64"),
    );
  }
  return file;
}

afterEach(() => {
  delete process.env.TERMIX_BUNDLED_PLUGINS_DIR;
  delete process.env.DATA_DIR;
  delete process.env.TERMIX_REQUIRE_SIGNED_PLUGINS;
  while (cleanups.length) cleanups.pop()?.();
});

async function loadedIds(): Promise<string[]> {
  const loader = new PluginLoader();
  const loaded = await loader.loadAll();
  return loaded.map((plugin) => plugin.id).sort();
}

describe("signed plugins gate off", () => {
  it("loads a user folder, an unsigned archive and a signed archive", async () => {
    const { userDir } = setup();
    createFixturePlugin({ id: "folder-one", root: userDir });
    await writeArtifact(userDir, "unsigned-one", "none");
    await writeArtifact(userDir, "signed-one", "valid");

    expect(await loadedIds()).toEqual([
      "bundled-one",
      "folder-one",
      "signed-one",
      "unsigned-one",
    ]);
    expect(
      fs.existsSync(
        path.join(userDir, ".unpacked", "signed-one", "manifest.json"),
      ),
    ).toBe(true);
  });

  it("still blocks an archive whose .sig does not verify", async () => {
    const { userDir } = setup();
    await writeArtifact(userDir, "forged-one", "wrong-key");
    expect(await loadedIds()).toEqual(["bundled-one"]);
  });
});

describe("signed plugins gate on", () => {
  it("blocks user folders and unsigned archives, keeps bundled plugins", async () => {
    const { userDir } = setup();
    process.env.TERMIX_REQUIRE_SIGNED_PLUGINS = "true";
    createFixturePlugin({ id: "folder-one", root: userDir });
    await writeArtifact(userDir, "unsigned-one", "none");
    await writeArtifact(userDir, "forged-one", "wrong-key");
    await writeArtifact(userDir, "signed-one", "valid");

    expect(await loadedIds()).toEqual(["bundled-one", "signed-one"]);
  });

  it("refuses a signed archive of a bundled id that is not newer", async () => {
    const { userDir } = setup();
    process.env.TERMIX_REQUIRE_SIGNED_PLUGINS = "true";
    await writeArtifact(userDir, "bundled-one", "valid");
    const loader = new PluginLoader();
    const loaded = await loader.loadAll();
    expect(loaded.map((plugin) => plugin.id)).toEqual(["bundled-one"]);
    expect(loader.get("bundled-one")?.artifact).toBeUndefined();
  });
});

describe("updating a bundled plugin", () => {
  it("loads a signed, newer archive in place of the bundled copy", async () => {
    const { userDir } = setup();
    const file = await writeArtifact(userDir, "bundled-one", "valid", "1.0.1");
    const loader = new PluginLoader();
    const loaded = await loader.loadAll();

    expect(loaded.map((plugin) => plugin.id)).toEqual(["bundled-one"]);
    const plugin = loader.get("bundled-one");
    expect(plugin?.manifest.version).toBe("1.0.1");
    expect(plugin?.source).toBe("bundled");
    expect(plugin?.artifact).toBe(file);
    expect(plugin?.signedBy).toBe("test");
  });

  it("keeps the bundled copy for an unsigned newer archive", async () => {
    const { userDir } = setup();
    await writeArtifact(userDir, "bundled-one", "none", "2.0.0");
    const loader = new PluginLoader();
    await loader.loadAll();
    expect(loader.get("bundled-one")?.manifest.version).toBe("1.0.0");
  });

  it("keeps the bundled copy for a signed older archive", async () => {
    const { userDir } = setup();
    await writeArtifact(userDir, "bundled-one", "valid", "0.9.0");
    const loader = new PluginLoader();
    await loader.loadAll();
    expect(loader.get("bundled-one")?.manifest.version).toBe("1.0.0");
  });

  it("refuses a downgrade after the bundled copy was unloaded", async () => {
    const { userDir } = setup();
    const loader = new PluginLoader();
    await loader.loadAll();
    loader.forget("bundled-one");
    const file = await writeArtifact(userDir, "bundled-one", "valid", "0.5.0");

    await expect(
      loader.loadArtifact(file, loader.bundledIds()),
    ).rejects.toThrow(/not newer than the bundled 1\.0\.0/);
  });
});
