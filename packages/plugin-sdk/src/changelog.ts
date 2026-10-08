/**
 * CHANGELOG.md: every release of a plugin (or of core) in one Markdown file.
 *
 *   # Changelog
 *
 *   ## 1.1.0
 *
 *   An optional summary paragraph.
 *
 *   ### Added
 *   - Something new
 *
 *   ### Fixed
 *   - Something broken
 *
 * Releases are listed newest first, and the newest one has to be the
 * manifest version. Notes go straight under the version they ship in, there
 * is no Unreleased section.
 */

import semver from "semver";

export const CHANGE_TYPES = [
  "added",
  "changed",
  "fixed",
  "removed",
  "deprecated",
  "security",
] as const;

export type ChangeType = (typeof CHANGE_TYPES)[number];

export interface ChangelogChange {
  type: ChangeType;
  text: string;
}

export interface ChangelogRelease {
  version: string;
  date?: string;
  summary?: string;
  changes: ChangelogChange[];
}

export interface Changelog {
  /** Newest first, as written. */
  releases: ChangelogRelease[];
}

export interface ReleaseNotes {
  summary?: string;
  changes: ChangelogChange[];
}

const RELEASE_HEADING =
  /^##\s+\[?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?:\s+-\s+(.+?))?\s*$/;
const UNRELEASED_HEADING = /^##\s+\[?unreleased\]?\s*$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BULLET = /^[-*]\s+(.*)$/;
const COMMENT = /^<!--.*-->$/;

/**
 * Parses the body under one release heading: an optional summary, then
 * `### Added` style sections of bullets. Indented lines continue the bullet
 * above them.
 */
export function parseReleaseNotes(
  body: string,
  where = "release",
): ReleaseNotes & { problems: string[] } {
  const problems: string[] = [];
  const summary: string[] = [];
  const changes: ChangelogChange[] = [];
  let section: ChangeType | null = null;
  let current: ChangelogChange | null = null;
  let fence = false;

  for (const raw of body.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) fence = !fence;

    if (!fence && trimmed.startsWith("### ")) {
      const name = trimmed.slice(4).trim().toLowerCase();
      if ((CHANGE_TYPES as readonly string[]).includes(name)) {
        section = name as ChangeType;
      } else {
        problems.push(
          `${where} has an unknown section "${trimmed.slice(4).trim()}", use one of ${CHANGE_TYPES.map(title).join(", ")}`,
        );
        section = null;
      }
      current = null;
      continue;
    }

    if (!section) {
      if (trimmed || summary.length > 0) summary.push(line);
      continue;
    }

    if (!trimmed || COMMENT.test(trimmed)) continue;
    const bullet = fence ? null : BULLET.exec(line);
    if (bullet) {
      current = { type: section, text: bullet[1].trim() };
      changes.push(current);
    } else if (current && /^\s/.test(line)) {
      current.text += `\n${trimmed}`;
    } else {
      problems.push(
        `${where} has text under "### ${title(section)}" that is not a list item: ${trimmed}`,
      );
    }
  }

  for (const change of changes) {
    if (!change.text) {
      problems.push(`${where} has an empty list item`);
    }
  }

  const text = summary.join("\n").trim();
  return { ...(text ? { summary: text } : {}), changes, problems };
}

/** Parses a whole CHANGELOG.md. Problems are reported, never thrown. */
export function parseChangelog(markdown: string): {
  changelog: Changelog;
  problems: string[];
} {
  const problems: string[] = [];
  const changelog: Changelog = { releases: [] };
  const lines = markdown.replace(/\r/g, "").split("\n");

  type Block = { heading: string; line: number; body: string[] };
  const blocks: Block[] = [];
  let fence = false;
  lines.forEach((line, i) => {
    if (line.trim().startsWith("```")) fence = !fence;
    if (!fence && /^##\s/.test(line)) {
      blocks.push({ heading: line.trim(), line: i + 1, body: [] });
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1].body.push(line);
    }
  });

  const seen = new Set<string>();
  blocks.forEach((block) => {
    if (UNRELEASED_HEADING.test(block.heading)) {
      problems.push(
        `line ${block.line}: drop "## Unreleased", notes go under the version they ship in`,
      );
      return;
    }

    const match = RELEASE_HEADING.exec(block.heading);
    if (!match) {
      problems.push(
        `line ${block.line}: "${block.heading}" should look like "## 1.2.0 - 2026-10-06"`,
      );
      return;
    }
    const [, version, date] = match;
    if (date !== undefined && !DATE.test(date)) {
      problems.push(`${version} has a date "${date}", use YYYY-MM-DD`);
    }
    if (seen.has(version)) problems.push(`${version} is listed twice`);
    seen.add(version);

    const notes = parseReleaseNotes(block.body.join("\n"), version);
    problems.push(...notes.problems);
    if (notes.changes.length === 0) {
      problems.push(`${version} has no changes listed`);
    }
    changelog.releases.push({
      version,
      ...(date && DATE.test(date) ? { date } : {}),
      ...(notes.summary ? { summary: notes.summary } : {}),
      changes: notes.changes,
    });
  });

  const versions = changelog.releases.map((r) => r.version);
  for (let i = 1; i < versions.length; i++) {
    if (semver.lt(versions[i - 1], versions[i])) {
      problems.push("releases must be listed newest first");
      break;
    }
  }

  return { changelog, problems };
}

/**
 * Checks a CHANGELOG.md. With a manifest version, the newest release has to
 * be that version, so a release never ships without its notes.
 */
export function validateChangelog(
  markdown: string,
  manifestVersion?: string,
): string[] {
  const { changelog, problems } = parseChangelog(markdown);
  if (changelog.releases.length === 0) {
    problems.push('no releases found, add a "## 1.0.0" heading');
    return problems;
  }
  const newest = changelog.releases[0].version;
  if (manifestVersion && newest !== manifestVersion) {
    problems.push(
      `the newest release is ${newest}, but the manifest version is ${manifestVersion}`,
    );
  }
  return problems;
}

/**
 * The Markdown under one version's heading, as written, for a release body.
 * Null when the version is not in the file.
 */
export function changelogSection(
  markdown: string,
  version: string,
): string | null {
  const lines = markdown.replace(/\r/g, "").split("\n");
  let start = -1;
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("```")) fence = !fence;
    if (fence || !/^##\s/.test(line)) continue;
    if (start >= 0) {
      return lines.slice(start, i).join("\n").trim();
    }
    const match = RELEASE_HEADING.exec(line.trim());
    if (match && match[1] === version) start = i + 1;
  }
  return start >= 0 ? lines.slice(start).join("\n").trim() : null;
}

function title(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
