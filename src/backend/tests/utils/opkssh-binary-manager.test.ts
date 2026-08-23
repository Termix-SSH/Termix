import crypto from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPKSSHBinaryManager } from "../../utils/opkssh-binary-manager.js";

const binaryName = "opkssh-linux-amd64";
let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "termix-opkssh-"));
  process.env.DATA_DIR = dataDir;
  process.env.OPKSSH_VERSION = "v-test";
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.DATA_DIR;
  delete process.env.OPKSSH_VERSION;
  delete process.env.OPKSSH_SHA256;
  await fs.rm(dataDir, { recursive: true, force: true });
});

function mockRelease(binary: Buffer): void {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tag_name: "v-test",
            assets: [
              { name: binaryName, browser_download_url: "https://asset.test" },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(binary, { status: 200 })),
  );
}

describe("OPKSSHBinaryManager download integrity", () => {
  it("installs a release only after its configured checksum matches", async () => {
    const binary = Buffer.from("verified-opkssh-binary");
    process.env.OPKSSH_SHA256 = crypto
      .createHash("sha256")
      .update(binary)
      .digest("hex");
    mockRelease(binary);

    await OPKSSHBinaryManager.downloadBinary();

    const installDir = path.join(dataDir, "opkssh");
    expect(await fs.readFile(path.join(installDir, binaryName))).toEqual(
      binary,
    );
    expect(
      await fs.readFile(path.join(installDir, "version.txt"), "utf8"),
    ).toBe("v-test");
    expect(
      await fs.readFile(path.join(installDir, "checksum.txt"), "utf8"),
    ).toBe(process.env.OPKSSH_SHA256);
  });

  it("rejects a mismatched release without replacing the installed binary", async () => {
    const installDir = path.join(dataDir, "opkssh");
    const binaryPath = path.join(installDir, binaryName);
    await fs.mkdir(installDir, { recursive: true });
    await fs.writeFile(binaryPath, "known-good");
    process.env.OPKSSH_SHA256 = "0".repeat(64);
    mockRelease(Buffer.from("tampered"));

    await expect(OPKSSHBinaryManager.downloadBinary()).rejects.toThrow(
      "checksum mismatch",
    );
    expect(await fs.readFile(binaryPath, "utf8")).toBe("known-good");
  });
});
