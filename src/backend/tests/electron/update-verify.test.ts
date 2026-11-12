import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const uv = require("../../../../electron/update-verify.cjs");

const yml = Buffer.from("version: 26.12.0\npath: Termix-Setup.exe\n");
const installer = Buffer.from("installer bytes");

function sumsFor(files: Record<string, Buffer>) {
  return Buffer.from(
    Object.entries(files)
      .map(([name, data]) => `${uv.sha256(data)}  ${name}`)
      .join("\n") + "\n",
  );
}

function release(overrides: Record<string, Buffer | null> = {}) {
  const assets: Record<string, Buffer | null> = {
    "latest.yml": yml,
    "Termix-Setup.exe": installer,
    SHA256SUMS: sumsFor({ "latest.yml": yml, "Termix-Setup.exe": installer }),
    "SHA256SUMS.sigstore.json": Buffer.from("{}"),
    ...overrides,
  };
  return vi.fn(async (_tag: string, name: string) => assets[name] ?? null);
}

function verifier(
  fetchAsset = release(),
  verifyBundle = vi.fn(async () => ({})),
) {
  return {
    fetchAsset,
    verifyBundle,
    ...uv.createReleaseVerifier({ fetchAsset, verifyBundle, fs }),
  };
}

const target = { tag: "v26.12.0", channelFile: "latest.yml" };

describe("verifyRelease", () => {
  it("passes a release whose channel file matches the signed sums", async () => {
    const v = verifier();
    const result = await v.verifyRelease(target);
    expect(result.sums.get("latest.yml")).toBe(uv.sha256(yml));
    expect(v.verifyBundle).toHaveBeenCalledWith({}, expect.any(Buffer));
  });

  it("calls a release without signed sums unsigned", async () => {
    const v = verifier(release({ "SHA256SUMS.sigstore.json": null }));
    await expect(v.verifyRelease(target)).rejects.toMatchObject({
      code: "unsigned",
    });
  });

  it("refuses a bad signature", async () => {
    const v = verifier(
      release(),
      vi.fn(async () => {
        throw new Error("bad");
      }),
    );
    await expect(v.verifyRelease(target)).rejects.toMatchObject({
      code: "signature",
    });
  });

  it("refuses a channel file that was swapped", async () => {
    const v = verifier(
      release({ "latest.yml": Buffer.from("path: evil.exe") }),
    );
    await expect(v.verifyRelease(target)).rejects.toMatchObject({
      code: "mismatch",
    });
  });

  it("refuses a channel file the sums do not list", async () => {
    const v = verifier(
      release({ SHA256SUMS: sumsFor({ "Termix-Setup.exe": installer }) }),
    );
    await expect(v.verifyRelease(target)).rejects.toMatchObject({
      code: "mismatch",
    });
  });

  it("refuses junk in the sums file", async () => {
    const v = verifier(release({ SHA256SUMS: Buffer.from("nope\n") }));
    await expect(v.verifyRelease(target)).rejects.toMatchObject({
      code: "signature",
    });
  });
});

describe("verifyDownload", () => {
  function file(data: Buffer) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-update-"));
    const p = path.join(dir, "Termix-Setup.exe");
    fs.writeFileSync(p, data);
    return p;
  }

  it("passes a download matching a file the channel names", async () => {
    const v = verifier();
    const verified = await v.verifyRelease(target);
    await expect(
      v.verifyDownload(verified, {
        downloadedFile: file(installer),
        files: [{ url: "Termix-Setup.exe" }],
      }),
    ).resolves.toBe("Termix-Setup.exe");
  });

  it("refuses a changed download", async () => {
    const v = verifier();
    const verified = await v.verifyRelease(target);
    await expect(
      v.verifyDownload(verified, {
        downloadedFile: file(Buffer.from("other")),
        files: [{ url: "Termix-Setup.exe" }],
      }),
    ).rejects.toMatchObject({ code: "mismatch" });
  });

  it("refuses when the release was never checked", async () => {
    const v = verifier();
    await expect(
      v.verifyDownload(null, { downloadedFile: file(installer), files: [] }),
    ).rejects.toMatchObject({ code: "mismatch" });
  });
});

describe("signer identity", () => {
  it.each([
    "https://github.com/Termix-SSH/Termix/.github/workflows/release.yml@refs/heads/dev-26.12.0",
    "https://github.com/Termix-SSH/Termix/.github/workflows/release.yml@refs/heads/main",
    "https://github.com/Termix-SSH/Termix/.github/workflows/release.yml@refs/tags/v26.12.0",
  ])("accepts %s", (san) => {
    expect(uv.SIGNER_IDENTITY.test(san)).toBe(true);
  });

  it.each([
    "https://github.com/evil/Termix/.github/workflows/release.yml@refs/heads/main",
    "https://github.com/Termix-SSH/Termix/.github/workflows/electron.yml@refs/heads/main",
    "https://github.com/Termix-SSH/Termix-Registry/.github/workflows/release.yml@refs/heads/main",
    "https://github.com/Termix-SSH/Termix/.github/workflows/release.yml@refs/pull/1/merge",
    "https://github.com/Termix-SSH/Termix/.github/workflows/release.yml@refs/heads/main x",
  ])("refuses %s", (san) => {
    expect(uv.SIGNER_IDENTITY.test(san)).toBe(false);
  });

  it("only trusts the GitHub Actions issuer", () => {
    expect(uv.SIGNER_ISSUER).toBe(
      "https://token.actions.githubusercontent.com",
    );
  });
});

// Real Sigstore checks need the network for the TUF trust root, so they run
// only when asked: LIVE_SIGSTORE=1 npx vitest run <this file>
describe.runIf(process.env.LIVE_SIGSTORE === "1")(
  "real Sigstore bundle",
  () => {
    const bundle = JSON.parse(
      fs.readFileSync(
        path.join(
          import.meta.dirname,
          "fixtures/sigstore-js-provenance.sigstore.json",
        ),
        "utf8",
      ),
    );
    const cachePath = fs.mkdtempSync(path.join(os.tmpdir(), "termix-tuf-"));

    it("accepts a good bundle for the identity that signed it", async () => {
      const check = uv.sigstoreBundleVerifier({
        cachePath,
        identity: /^https:\/\/github\.com\/sigstore\/sigstore-js\//,
      });
      await expect(check(bundle)).resolves.toBeTruthy();
    }, 60000);

    it("refuses the same good bundle for Termix's release identity", async () => {
      const check = uv.sigstoreBundleVerifier({ cachePath });
      await expect(check(bundle)).rejects.toThrow();
    }, 60000);

    it("refuses a bundle whose signature was changed", async () => {
      const broken = structuredClone(bundle);
      const sig = broken.dsseEnvelope.signatures[0];
      sig.sig = Buffer.from("x".repeat(64)).toString("base64");
      const check = uv.sigstoreBundleVerifier({
        cachePath,
        identity: /^https:\/\/github\.com\/sigstore\/sigstore-js\//,
      });
      await expect(check(broken)).rejects.toThrow();
    }, 60000);
  },
);
