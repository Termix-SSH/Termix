export const CHANGE_TYPES = [
  "added",
  "changed",
  "fixed",
  "removed",
  "deprecated",
  "security",
];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOP_KEYS = ["$schema", "unreleased", "releases"];
const RELEASE_KEYS = ["version", "date", "notes", "changes"];
const CHANGE_KEYS = ["type", "text"];

function compareVersions(a, b) {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  for (let i = 1; i <= 3; i++) {
    const diff = Number(pa[i]) - Number(pb[i]);
    if (diff !== 0) return diff;
  }
  if (pa[4] === pb[4]) return 0;
  if (!pa[4]) return 1;
  if (!pb[4]) return -1;
  return pa[4] < pb[4] ? -1 : 1;
}

function unknownKeys(value, allowed, where, problems) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      problems.push(`${where} has unknown key "${key}"`);
  }
}

function checkChanges(changes, where, problems) {
  if (!Array.isArray(changes)) {
    problems.push(`${where} must be an array`);
    return;
  }
  changes.forEach((change, i) => {
    const at = `${where}[${i}]`;
    if (!change || typeof change !== "object" || Array.isArray(change)) {
      problems.push(`${at} must be an object`);
      return;
    }
    unknownKeys(change, CHANGE_KEYS, at, problems);
    if (!CHANGE_TYPES.includes(change.type)) {
      problems.push(`${at}.type must be one of ${CHANGE_TYPES.join(", ")}`);
    }
    if (typeof change.text !== "string" || change.text.trim() === "") {
      problems.push(`${at}.text must be a non-empty string`);
    }
  });
}

/**
 * Checks a parsed CHANGELOG.json. The newest release has to be the version
 * in the manifest, so a release never ships without its notes.
 */
export function validateChangelog(changelog, manifestVersion) {
  const problems = [];
  if (!changelog || typeof changelog !== "object" || Array.isArray(changelog)) {
    return ["CHANGELOG.json must be an object"];
  }
  unknownKeys(changelog, TOP_KEYS, "CHANGELOG.json", problems);

  if (changelog.unreleased !== undefined) {
    checkChanges(changelog.unreleased, "unreleased", problems);
  }

  const releases = changelog.releases;
  if (!Array.isArray(releases) || releases.length === 0) {
    problems.push("releases must be a non-empty array");
    return problems;
  }

  const seen = new Set();
  releases.forEach((release, i) => {
    const at = `releases[${i}]`;
    if (!release || typeof release !== "object" || Array.isArray(release)) {
      problems.push(`${at} must be an object`);
      return;
    }
    unknownKeys(release, RELEASE_KEYS, at, problems);
    if (typeof release.version !== "string" || !SEMVER.test(release.version)) {
      problems.push(`${at}.version must be a version like 1.2.3`);
    } else if (seen.has(release.version)) {
      problems.push(`${at}.version ${release.version} is listed twice`);
    } else {
      seen.add(release.version);
    }
    if (
      release.date !== undefined &&
      (typeof release.date !== "string" || !DATE.test(release.date))
    ) {
      problems.push(`${at}.date must be a date like 2026-10-01`);
    }
    if (release.notes !== undefined && typeof release.notes !== "string") {
      problems.push(`${at}.notes must be a string`);
    }
    checkChanges(release.changes, `${at}.changes`, problems);
    if (Array.isArray(release.changes) && release.changes.length === 0) {
      problems.push(`${at}.changes must list at least one change`);
    }
  });

  const versions = releases
    .map((release) => release?.version)
    .filter((v) => typeof v === "string" && SEMVER.test(v));
  for (let i = 1; i < versions.length; i++) {
    if (compareVersions(versions[i - 1], versions[i]) < 0) {
      problems.push("releases must be listed newest first");
      break;
    }
  }

  const newest = releases[0]?.version;
  if (manifestVersion && newest !== manifestVersion) {
    problems.push(
      `the newest release is ${newest}, but manifest version is ${manifestVersion}`,
    );
  }

  return problems;
}
