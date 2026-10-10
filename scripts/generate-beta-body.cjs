#!/usr/bin/env node
/**
 * Writes the body of a beta release: what a beta is, how to get it, how to
 * leave, and the commits since the previous beta (or stable release) grouped
 * by their feat:/fix: prefix.
 *
 * node scripts/generate-beta-body.cjs --version 26.11.0-beta.2 \
 *   --branch dev-26.11.0 --sha <head> [--prev <ref>]
 */

const { execFileSync } = require("child_process");

const REPO = "Termix-SSH/Termix";
const MAX_COMMITS = 150;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[argv[i].slice(2)] = true;
    } else {
      args[argv[i].slice(2)] = next;
      i++;
    }
  }
  return args;
}

/** Commit subjects sorted into features, fixes and everything else. */
function groupCommits(subjects) {
  const groups = { features: [], fixes: [], other: [] };
  for (const subject of subjects) {
    const text = subject.trim();
    if (!text) continue;
    const match = /^(\w+)(\([^)]*\))?!?:\s*(.+)$/.exec(text);
    const type = match?.[1].toLowerCase();
    const message = match ? match[3] : text;
    if (type === "feat") groups.features.push(message);
    else if (type === "fix") groups.fixes.push(message);
    else groups.other.push(message);
  }
  return groups;
}

/** "26.11.0-beta.2" reads as "26.11.0 Beta 2". */
function betaTitle(version) {
  const match = /^(.+)-beta\.(\d+)$/.exec(version);
  return match ? `${match[1]} Beta ${match[2]}` : version;
}

function renderBody({ version, branch, sha, prev, subjects, repo = REPO }) {
  const shown = subjects.slice(0, MAX_COMMITS);
  const groups = groupCommits(shown);
  const list = (items) => items.map((item) => `- ${item}`).join("\n");
  const sections = [
    ["Features", groups.features],
    ["Fixes", groups.fixes],
    ["Other changes", groups.other],
  ]
    .filter(([, items]) => items.length > 0)
    .map(([title, items]) => `### ${title}\n\n${list(items)}`);

  let changes;
  if (!prev) {
    changes = "First beta of this version.";
  } else if (sections.length === 0) {
    changes = "No changes since the last release.";
  } else {
    changes = sections.join("\n\n");
    if (subjects.length > MAX_COMMITS) {
      changes += `\n\n...and ${subjects.length - MAX_COMMITS} more.`;
    }
    changes += `\n\n[Full diff](https://github.com/${repo}/compare/${prev}...${sha})`;
  }

  return `> [!WARNING]
> This is a beta of the next Termix release, built from \`${branch}\`. It can have bugs, so keep a backup and don't use it where you can't afford problems.

**Found a bug or have feedback?** [Send beta feedback](https://github.com/${repo}/issues/new?template=beta_feedback.yml&termix-version=${encodeURIComponent(version)}). It is the fastest way to get it fixed before the stable release.

### How to get it

- **Docker:** \`ghcr.io/termix-ssh/termix:beta\` follows every beta. \`ghcr.io/termix-ssh/termix:${version}\` stays on this one.
- **Desktop:** download an installer from the assets below.
- **Going back:** switch to the \`latest\` image or a stable installer. Keep a backup of your data folder, since a beta can change the database.

## Changes in ${betaTitle(version)}

${changes}
`;
}

function readSubjects(prev, sha) {
  if (!prev) return [];
  const out = execFileSync(
    "git",
    [
      "log",
      "--no-merges",
      "--format=%s",
      `${prev}..${sha}`,
      "--",
      ".",
      ":!package-lock.json",
    ],
    { encoding: "utf8" },
  );
  return out.split("\n").filter(Boolean);
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.version || !args.branch || !args.sha) {
    console.error(
      "generate-beta-body: --version, --branch and --sha are required",
    );
    process.exit(1);
  }
  const prev = typeof args.prev === "string" ? args.prev : "";
  process.stdout.write(
    renderBody({
      version: args.version,
      branch: args.branch,
      sha: args.sha,
      prev,
      subjects: readSubjects(prev, args.sha),
    }),
  );
}

module.exports = { betaTitle, groupCommits, renderBody };
