const { parseDevBranch } = require("./parse-dev-branch.cjs");

function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function latestDevBranch(refs) {
  const versions = [];
  for (const ref of refs) {
    const name = ref.replace(/^refs\/heads\//, "").trim();
    if (!name) continue;
    try {
      versions.push({ name, version: parseDevBranch(name) });
    } catch {
      // not a dev-X.Y.Z branch, skip it
    }
  }

  if (versions.length === 0) {
    throw new Error("no dev-X.Y.Z branches found");
  }

  versions.sort((a, b) => compareSemver(a.version, b.version));
  return versions[versions.length - 1].name;
}

module.exports = { latestDevBranch };

if (require.main === module) {
  const input = require("fs").readFileSync(0, "utf8");
  const refs = input.split("\n").filter(Boolean);
  try {
    process.stdout.write(latestDevBranch(refs) + "\n");
  } catch (err) {
    console.error(`latest-dev-branch: ${err.message}`);
    process.exit(1);
  }
}
