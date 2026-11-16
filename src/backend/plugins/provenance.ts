/**
 * Build provenance for registry plugins. The Registry release workflows attest
 * every .tmxplug with actions/attest and upload the Sigstore bundle next to
 * it. Termix checks the bundle at download and keeps a summary beside the
 * plugin, so the plugins page can show which workflow run built it.
 */
import path from "path";

export type ProvenanceTier = "official" | "community";

const ISSUER = "https://token.actions.githubusercontent.com";

/** The Registry workflows that build and attest plugins, on main only. */
const SIGNERS: Record<ProvenanceTier, RegExp> = {
  official:
    /^https:\/\/github\.com\/Termix-SSH\/Termix-Registry\/\.github\/workflows\/release-plugin(-one)?\.yml@refs\/heads\/main$/,
  community:
    /^https:\/\/github\.com\/Termix-SSH\/Termix-Registry\/\.github\/workflows\/plugin-release\.yml@refs\/heads\/main$/,
};

const MAX_BUNDLE_BYTES = 256 * 1024;
const IN_TOTO = "application/vnd.in-toto+json";

export interface ProvenanceRecord {
  /** verified: the bundle checked out. unchecked: Sigstore was unreachable. */
  status: "verified" | "unchecked";
  checkedAt: string;
  /** The workflow that signed, from the certificate. */
  signer: string | null;
  /** The workflow run that built it, when the statement names one. */
  runUrl: string | null;
  bundleUrl: string;
}

export class ProvenanceError extends Error {
  constructor(reason: string) {
    super(`build provenance: ${reason}`);
    this.name = "ProvenanceError";
  }
}

/** Thrown by the signature check when the trust root can't be fetched. */
export class ProvenanceUnavailableError extends Error {}

/** Checks the Sigstore signature and signer. Returns the signer identity. */
export type BundleSignatureCheck = (
  bundle: unknown,
  signer: RegExp,
) => Promise<string | null>;

interface Statement {
  _type?: string;
  subject?: Array<{ name?: string; digest?: Record<string, string> }>;
  predicateType?: string;
  predicate?: {
    runDetails?: { metadata?: { invocationId?: string } };
  };
}

function statementOf(bundle: unknown): Statement {
  const envelope = (bundle as { dsseEnvelope?: Record<string, unknown> })
    ?.dsseEnvelope;
  if (!envelope || typeof envelope.payload !== "string") {
    throw new ProvenanceError("the bundle has no attestation");
  }
  if (envelope.payloadType !== IN_TOTO) {
    throw new ProvenanceError("the bundle is not an in-toto attestation");
  }
  try {
    return JSON.parse(
      Buffer.from(envelope.payload, "base64").toString("utf8"),
    ) as Statement;
  } catch {
    throw new ProvenanceError("the attestation can't be read");
  }
}

/** The run URL, only when it points at a GitHub Actions run. */
function runUrlOf(statement: Statement): string | null {
  const id = statement.predicate?.runDetails?.metadata?.invocationId;
  return typeof id === "string" &&
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+(\/attempts\/\d+)?$/.test(
      id,
    )
    ? id
    : null;
}

/**
 * Checks a bundle against the file it should describe. Throws ProvenanceError
 * when it does not match, ProvenanceUnavailableError when the signature
 * could not be checked at all.
 */
export async function checkProvenance(
  bundleText: string,
  options: {
    sha256: string;
    fileName: string;
    tier: ProvenanceTier;
    bundleUrl: string;
    checkSignature: BundleSignatureCheck;
    now?: Date;
  },
): Promise<ProvenanceRecord> {
  let bundle: unknown;
  try {
    bundle = JSON.parse(bundleText);
  } catch {
    throw new ProvenanceError("the bundle is not JSON");
  }
  const statement = statementOf(bundle);
  const subjects = Array.isArray(statement.subject) ? statement.subject : [];
  const match = subjects.some(
    (subject) =>
      subject?.digest?.sha256?.toLowerCase() === options.sha256.toLowerCase() &&
      path.basename(String(subject.name ?? "")) === options.fileName,
  );
  if (!match) {
    throw new ProvenanceError("the attestation is for another file");
  }
  const signer = await options.checkSignature(bundle, SIGNERS[options.tier]);
  return {
    status: "verified",
    checkedAt: (options.now ?? new Date()).toISOString(),
    signer,
    runUrl: runUrlOf(statement),
    bundleUrl: options.bundleUrl,
  };
}

/** The real signature check, with the Sigstore trust root kept in cacheDir. */
export function sigstoreSignatureCheck(cacheDir: string): BundleSignatureCheck {
  return async (bundleJson, signer) => {
    const { getTrustedRoot } = await import("@sigstore/tuf");
    const { bundleFromJSON } = await import("@sigstore/bundle");
    const { Verifier, toSignedEntity, toTrustMaterial } =
      await import("@sigstore/verify");
    let trustedRoot;
    try {
      trustedRoot = await getTrustedRoot({ cachePath: cacheDir });
    } catch (error) {
      throw new ProvenanceUnavailableError(
        error instanceof Error ? error.message : String(error),
      );
    }
    const verifier = new Verifier(toTrustMaterial(trustedRoot), {
      tlogThreshold: 1,
      ctlogThreshold: 1,
    });
    let identity;
    try {
      // A DSSE bundle carries its own payload; the subject was checked above.
      identity = verifier.verify(toSignedEntity(bundleFromJSON(bundleJson)), {
        subjectAlternativeName: signer,
        extensions: { issuer: ISSUER },
      });
    } catch (error) {
      throw new ProvenanceError(
        error instanceof Error
          ? error.message
          : "the signature does not check out",
      );
    }
    return identity?.identity?.subjectAlternativeName ?? null;
  };
}

export { MAX_BUNDLE_BYTES, SIGNERS as PROVENANCE_SIGNERS };
