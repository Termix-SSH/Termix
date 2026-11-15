import semver from "semver";

/**
 * The newest dev-X.Y.Z branch in `git ls-remote --heads` output, or null.
 * That is the code the next release ships, which is what CI should test
 * against; a default branch can still hold a release that no longer runs.
 */
export function newestDevBranch(lsRemote) {
  const versions = [];
  for (const line of String(lsRemote).split("\n")) {
    const match = /refs\/heads\/dev-(\S+)$/.exec(line.trim());
    if (match && semver.valid(match[1])) versions.push(match[1]);
  }
  if (!versions.length) return null;
  return `dev-${versions.sort(semver.rcompare)[0]}`;
}
