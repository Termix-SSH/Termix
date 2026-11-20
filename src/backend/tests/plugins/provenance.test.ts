import { describe, expect, it, vi } from "vitest";
import {
  checkProvenance,
  PROVENANCE_SIGNERS,
  ProvenanceError,
  ProvenanceUnavailableError,
} from "../../plugins/provenance.js";

const SHA = "b".repeat(64);
const RUN = "https://github.com/Termix-SSH/Termix-Registry/actions/runs/42";

function bundleFor(
  subject: { name: string; sha256: string },
  extra: Record<string, unknown> = {},
): string {
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: subject.name, digest: { sha256: subject.sha256 } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: { runDetails: { metadata: { invocationId: RUN } } },
  };
  return JSON.stringify({
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    dsseEnvelope: {
      payloadType: "application/vnd.in-toto+json",
      payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
      signatures: [{ sig: "c2ln" }],
    },
    ...extra,
  });
}

const base = {
  sha256: SHA,
  fileName: "docker-1.0.0.tmxplug",
  tier: "official" as const,
  bundleUrl: "https://example.com/docker-1.0.0.tmxplug.sigstore.json",
};

describe("checkProvenance", () => {
  it("records the run when the subject and signer match", async () => {
    const checkSignature = vi.fn(async () => "https://github.com/x");
    const record = await checkProvenance(
      bundleFor({ name: "out/docker-1.0.0.tmxplug", sha256: SHA }),
      { ...base, checkSignature, now: new Date("2026-11-14T00:00:00Z") },
    );
    expect(record).toEqual({
      status: "verified",
      checkedAt: "2026-11-14T00:00:00.000Z",
      signer: "https://github.com/x",
      runUrl: RUN,
      bundleUrl: base.bundleUrl,
    });
    expect(checkSignature).toHaveBeenCalledWith(
      expect.anything(),
      PROVENANCE_SIGNERS.official,
    );
  });

  it("refuses a bundle for another file or digest", async () => {
    const checkSignature = vi.fn(async () => null);
    await expect(
      checkProvenance(
        bundleFor({ name: "docker-1.0.0.tmxplug", sha256: "c".repeat(64) }),
        {
          ...base,
          checkSignature,
        },
      ),
    ).rejects.toBeInstanceOf(ProvenanceError);
    await expect(
      checkProvenance(bundleFor({ name: "other-1.0.0.tmxplug", sha256: SHA }), {
        ...base,
        checkSignature,
      }),
    ).rejects.toThrow(/another file/);
    expect(checkSignature).not.toHaveBeenCalled();
  });

  it("refuses something that is not an in-toto bundle", async () => {
    const checkSignature = vi.fn(async () => null);
    await expect(
      checkProvenance("not json", { ...base, checkSignature }),
    ).rejects.toThrow(/not JSON/);
    await expect(
      checkProvenance(JSON.stringify({ messageSignature: {} }), {
        ...base,
        checkSignature,
      }),
    ).rejects.toThrow(/no attestation/);
  });

  it("passes on signature failures and an unreachable trust root", async () => {
    const bundle = bundleFor({ name: "docker-1.0.0.tmxplug", sha256: SHA });
    await expect(
      checkProvenance(bundle, {
        ...base,
        checkSignature: async () => {
          throw new ProvenanceError("bad signer");
        },
      }),
    ).rejects.toThrow(/bad signer/);
    await expect(
      checkProvenance(bundle, {
        ...base,
        checkSignature: async () => {
          throw new ProvenanceUnavailableError("offline");
        },
      }),
    ).rejects.toBeInstanceOf(ProvenanceUnavailableError);
  });

  it("only takes the registry workflows on main as signers", () => {
    const ok =
      "https://github.com/Termix-SSH/Termix-Registry/.github/workflows/release-plugin-one.yml@refs/heads/main";
    expect(PROVENANCE_SIGNERS.official.test(ok)).toBe(true);
    expect(PROVENANCE_SIGNERS.official.test(ok.replace("main", "dev"))).toBe(
      false,
    );
    expect(
      PROVENANCE_SIGNERS.official.test(
        "https://github.com/Termix-SSH/Plugin-Docker/.github/workflows/release.yml@refs/heads/main",
      ),
    ).toBe(false);
    expect(PROVENANCE_SIGNERS.community.test(ok)).toBe(false);
  });

  it("ignores a run link that does not point at a GitHub Actions run", async () => {
    const bundle = JSON.parse(
      bundleFor({ name: "docker-1.0.0.tmxplug", sha256: SHA }),
    );
    const statement = JSON.parse(
      Buffer.from(bundle.dsseEnvelope.payload, "base64").toString(),
    );
    statement.predicate.runDetails.metadata.invocationId =
      "https://evil.example/run";
    bundle.dsseEnvelope.payload = Buffer.from(
      JSON.stringify(statement),
    ).toString("base64");
    const record = await checkProvenance(JSON.stringify(bundle), {
      ...base,
      checkSignature: async () => null,
    });
    expect(record.runUrl).toBeNull();
  });
});

// Talks to Sigstore's TUF repo, so it runs only when asked:
// LIVE_PROVENANCE_BUNDLE=<a GitHub attestation bundle> LIVE_PROVENANCE_SHA=<its
// file's sha256> LIVE_PROVENANCE_NAME=<file name> LIVE_PROVENANCE_SIGNER=<regex>
describe.runIf(Boolean(process.env.LIVE_PROVENANCE_BUNDLE))(
  "sigstoreSignatureCheck against a real bundle",
  () => {
    it("accepts the real signer for its tier and refuses the other", async () => {
      const fs = await import("node:fs");
      const os = await import("node:os");
      const path = await import("node:path");
      const { sigstoreSignatureCheck } =
        await import("../../plugins/provenance.js");
      const text = fs.readFileSync(process.env.LIVE_PROVENANCE_BUNDLE!, "utf8");
      const cache = fs.mkdtempSync(path.join(os.tmpdir(), "sigstore-"));
      const check = sigstoreSignatureCheck(cache);
      const signer = await check(
        JSON.parse(text),
        new RegExp(process.env.LIVE_PROVENANCE_SIGNER!),
      );
      expect(signer).toMatch(new RegExp(process.env.LIVE_PROVENANCE_SIGNER!));
      const tier = PROVENANCE_SIGNERS.official.test(signer!)
        ? "official"
        : "community";
      const other = tier === "official" ? "community" : "official";
      const opts = {
        ...base,
        sha256: process.env.LIVE_PROVENANCE_SHA!,
        fileName: process.env.LIVE_PROVENANCE_NAME!,
        checkSignature: check,
      };
      const record = await checkProvenance(text, { ...opts, tier });
      expect(record.status).toBe("verified");
      expect(record.signer).toBe(signer);
      await expect(
        checkProvenance(text, { ...opts, tier: other }),
      ).rejects.toBeInstanceOf(ProvenanceError);
    }, 60_000);
  },
);
