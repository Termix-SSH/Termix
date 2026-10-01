import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  keygen,
  sign,
  verify,
} from "../packages/plugin-sdk/cli/commands/sign.mjs";
import {
  generateKeyPair,
  keyId,
  loadPrivateKey,
  signArtifact,
  verifyArtifact,
} from "../packages/plugin-sdk/cli/lib/signing.mjs";

const cleanups: Array<() => void> = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-sign-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (cleanups.length) cleanups.pop()?.();
});

describe("signing helpers", () => {
  const artifact = Buffer.from("plugin bytes");

  it("verifies a signature from the matching key", () => {
    const pair = generateKeyPair();
    const signature = signArtifact(artifact, loadPrivateKey(pair.privateKey));
    expect(verifyArtifact(artifact, signature, [pair.publicKey])).toBe(
      pair.keyId,
    );
    expect(keyId(pair.publicKey)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("rejects a tampered artifact", () => {
    const pair = generateKeyPair();
    const signature = signArtifact(artifact, loadPrivateKey(pair.privateKey));
    expect(
      verifyArtifact(Buffer.from("plugin bytez"), signature, [pair.publicKey]),
    ).toBeNull();
  });

  it("rejects the wrong key", () => {
    const signer = generateKeyPair();
    const other = generateKeyPair();
    const signature = signArtifact(artifact, loadPrivateKey(signer.privateKey));
    expect(verifyArtifact(artifact, signature, [other.publicKey])).toBeNull();
    expect(
      verifyArtifact(artifact, signature, [other.publicKey, signer.publicKey]),
    ).toBe(signer.keyId);
  });

  it("refuses a missing or non-Ed25519 key", () => {
    expect(() => loadPrivateKey(undefined)).toThrow(/not set/);
    expect(() => loadPrivateKey("not a key")).toThrow();
  });
});

describe("keygen, sign and verify commands", () => {
  it("round trips and never prints the private key", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = tempDir();
    const file = path.join(dir, "demo-1.0.0.tmxplug");
    fs.writeFileSync(file, "archive");

    const { keyFile, publicKey } = await keygen({
      cwd: dir,
      args: ["--out", dir],
    });
    const privateKey = fs.readFileSync(keyFile, "utf8").trim();
    expect(log.mock.calls.flat().join("\n")).not.toContain(privateKey);

    await sign({
      cwd: dir,
      args: [file],
      env: { TERMIX_PLUGIN_SIGNING_KEY: privateKey },
    });
    expect(fs.existsSync(`${file}.sig`)).toBe(true);
    await expect(
      verify({ cwd: dir, args: [file, "--key", publicKey] }),
    ).resolves.toMatch(/^[0-9a-f]{16}$/);

    fs.writeFileSync(file, "archivE");
    await expect(
      verify({ cwd: dir, args: [file, "--key", publicKey] }),
    ).rejects.toThrow(/not valid/);
  });

  it("refuses to sign without the key env var", async () => {
    const dir = tempDir();
    const file = path.join(dir, "demo-1.0.0.tmxplug");
    fs.writeFileSync(file, "archive");
    await expect(sign({ cwd: dir, args: [file], env: {} })).rejects.toThrow(
      /TERMIX_PLUGIN_SIGNING_KEY is not set/,
    );
  });

  it("will not overwrite an existing key file", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = tempDir();
    await keygen({ cwd: dir, args: ["--out", dir] });
    await expect(keygen({ cwd: dir, args: ["--out", dir] })).rejects.toThrow(
      /already exists/,
    );
  });
});
