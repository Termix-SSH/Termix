const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseDevBranch(ref) {
  if (!ref || typeof ref !== "string") {
    throw new Error("a branch ref is required");
  }

  const name = ref.replace(/^refs\/heads\//, "").trim();

  if (!name.startsWith("dev-")) {
    throw new Error(
      `release must run from a dev branch, got "${name}" (expected dev-X.Y.Z)`,
    );
  }

  const version = name.slice("dev-".length);
  if (!SEMVER.test(version)) {
    throw new Error(
      `branch "${name}" does not contain a valid semver version (got "${version}")`,
    );
  }

  return version;
}

module.exports = { parseDevBranch };

if (require.main === module) {
  const ref = process.argv[2] || process.env.GITHUB_REF;
  try {
    process.stdout.write(parseDevBranch(ref) + "\n");
  } catch (err) {
    console.error(`parse-dev-branch: ${err.message}`);
    process.exit(1);
  }
}
