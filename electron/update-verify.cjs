// Checks a desktop update against the release's signed checksum file before
// anything is installed. The release workflow signs SHA256SUMS keyless with
// Sigstore from its own GitHub Actions identity, so a release file that was
// swapped, or a release made anywhere else, is refused on every platform.

const crypto = require("crypto");
const path = require("path");

const SUMS_FILE = "SHA256SUMS";
const SUMS_BUNDLE = "SHA256SUMS.sigstore.json";

// Who may sign: core's release workflow, run from a branch or tag.
const SIGNER_ISSUER = "https://token.actions.githubusercontent.com";
const SIGNER_IDENTITY =
  /^https:\/\/github\.com\/Termix-SSH\/Termix\/\.github\/workflows\/release\.yml@refs\/(heads|tags)\/[A-Za-z0-9._\/-]+$/;

class UpdateVerifyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "UpdateVerifyError";
    // unsigned: the release has no signed checksums (older releases)
    // signature: the signature or its signer is wrong
    // mismatch: a file does not match its checksum
    this.code = code;
  }
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function sha256File(file, fs) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

/** name -> sha256 hex, from `sha256sum` output. Refuses anything odd. */
function parseSums(text) {
  const sums = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!match) throw new UpdateVerifyError("signature", "Bad checksum line");
    const [, hex, name] = match;
    if (name.includes("/") || name.includes("\\") || sums.has(name)) {
      throw new UpdateVerifyError("signature", "Bad checksum name");
    }
    sums.set(name, hex);
  }
  if (sums.size === 0) throw new UpdateVerifyError("signature", "No checksums");
  return sums;
}

function expect(sums, name, actual) {
  const wanted = sums.get(name);
  if (!wanted) {
    throw new UpdateVerifyError("mismatch", `${name} is not in the checksums`);
  }
  if (wanted !== actual) {
    throw new UpdateVerifyError(
      "mismatch",
      `${name} does not match its checksum`,
    );
  }
}

/**
 * Checks the Sigstore bundle against the checksum file with the public
 * Sigstore trust root, kept fresh through TUF in cachePath.
 */
function sigstoreBundleVerifier({
  cachePath,
  identity = SIGNER_IDENTITY,
  issuer = SIGNER_ISSUER,
}) {
  return async (bundleJson, data) => {
    const { getTrustedRoot } = require("@sigstore/tuf");
    const { bundleFromJSON } = require("@sigstore/bundle");
    const {
      Verifier,
      toSignedEntity,
      toTrustMaterial,
    } = require("@sigstore/verify");
    const trustedRoot = await getTrustedRoot({ cachePath });
    const verifier = new Verifier(toTrustMaterial(trustedRoot), {
      tlogThreshold: 1,
      ctlogThreshold: 1,
    });
    return verifier.verify(toSignedEntity(bundleFromJSON(bundleJson), data), {
      subjectAlternativeName: identity,
      extensions: { issuer },
    });
  };
}

/**
 * fetchAsset(tag, name) gives a Buffer, or null when the release has no
 * such file. verifyBundle(bundleJson, data) throws unless the signature is
 * good and made by the release workflow.
 */
function createReleaseVerifier({
  fetchAsset,
  verifyBundle,
  fs,
  log = () => {},
}) {
  async function verifyRelease({ tag, channelFile }) {
    const [sumsData, bundleData] = await Promise.all([
      fetchAsset(tag, SUMS_FILE),
      fetchAsset(tag, SUMS_BUNDLE),
    ]);
    if (!sumsData || !bundleData) {
      throw new UpdateVerifyError("unsigned", `${tag} has no signed checksums`);
    }
    let bundleJson;
    try {
      bundleJson = JSON.parse(bundleData.toString("utf8"));
    } catch {
      throw new UpdateVerifyError(
        "signature",
        "The signature file is not valid",
      );
    }
    try {
      await verifyBundle(bundleJson, sumsData);
    } catch (error) {
      log("[updater] signature check failed:", error?.message || String(error));
      throw new UpdateVerifyError(
        "signature",
        "The update's signature could not be checked",
      );
    }
    const sums = parseSums(sumsData.toString("utf8"));
    const channel = await fetchAsset(tag, channelFile);
    if (!channel) {
      throw new UpdateVerifyError("mismatch", `${tag} has no ${channelFile}`);
    }
    expect(sums, channelFile, sha256(channel));
    return { tag, sums };
  }

  /**
   * The downloaded installer must match the checksum of one of the files
   * the (already checked) channel file names.
   */
  async function verifyDownload(verified, { downloadedFile, files }) {
    if (!verified || !downloadedFile) {
      throw new UpdateVerifyError("mismatch", "Nothing to check");
    }
    const actual = await sha256File(downloadedFile, fs);
    const names = new Set(
      (Array.isArray(files) ? files : [])
        .map((file) => {
          try {
            return path.posix.basename(decodeURIComponent(String(file.url)));
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    );
    names.add(path.basename(downloadedFile));
    for (const name of names) {
      if (verified.sums.get(name) === actual) return name;
    }
    throw new UpdateVerifyError(
      "mismatch",
      "The downloaded update does not match the signed checksums",
    );
  }

  return { verifyRelease, verifyDownload };
}

module.exports = {
  SIGNER_IDENTITY,
  SIGNER_ISSUER,
  SUMS_BUNDLE,
  SUMS_FILE,
  UpdateVerifyError,
  createReleaseVerifier,
  parseSums,
  sha256,
  sigstoreBundleVerifier,
};
