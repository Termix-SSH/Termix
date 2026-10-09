import { describe, expect, it } from "vitest";
import {
  changelogSection,
  parseChangelog,
  parseReleaseNotes,
  validateChangelog,
} from "../packages/plugin-sdk/src/changelog.ts";

const FILE = [
  "# Changelog",
  "",
  "## 1.1.0 - 2026-10-06",
  "",
  "Second release.",
  "",
  "### Added",
  "- Something new",
  "  that wraps",
  "* Another thing",
  "",
  "### Fixed",
  "- Something broken",
  "",
  "## 1.0.0",
  "",
  "### Added",
  "- The first version",
  "",
].join("\n");

describe("parseChangelog", () => {
  it("reads releases, summaries and sections", () => {
    const { changelog, problems } = parseChangelog(FILE);
    expect(problems).toEqual([]);
    expect(changelog.releases).toEqual([
      {
        version: "1.1.0",
        date: "2026-10-06",
        summary: "Second release.",
        changes: [
          { type: "added", text: "Something new\nthat wraps" },
          { type: "added", text: "Another thing" },
          { type: "fixed", text: "Something broken" },
        ],
      },
      {
        version: "1.0.0",
        changes: [{ type: "added", text: "The first version" }],
      },
    ]);
  });

  it("accepts Keep a Changelog brackets, CRLF and calendar versions", () => {
    const { changelog, problems } = parseChangelog(
      "## [26.10.0] - 2026-10-06\r\n\r\n### Changed\r\n- A thing\r\n",
    );
    expect(problems).toEqual([]);
    expect(changelog.releases[0]).toMatchObject({
      version: "26.10.0",
      date: "2026-10-06",
    });
  });

  it("orders a prerelease below its release", () => {
    const md = (a: string, b: string) =>
      `## ${a}\n### Added\n- x\n## ${b}\n### Added\n- y\n`;
    expect(parseChangelog(md("2.0.0", "2.0.0-beta.1")).problems).toEqual([]);
    expect(parseChangelog(md("2.0.0-beta.1", "2.0.0")).problems).toContain(
      "releases must be listed newest first",
    );
  });

  it("flags bad headings, dates, sections, stray text and duplicates", () => {
    const { problems } = parseChangelog(
      [
        "## v1",
        "## 1.0.0 - October 1",
        "### Improved",
        "- x",
        "### Added",
        "loose text",
        "- y",
        "## 1.0.0",
        "### Added",
        "- z",
      ].join("\n"),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        'line 1: "## v1" should look like "## 1.2.0 - 2026-10-06"',
        '1.0.0 has a date "October 1", use YYYY-MM-DD',
        expect.stringContaining('unknown section "Improved"'),
        expect.stringContaining("that is not a list item: loose text"),
        "1.0.0 is listed twice",
      ]),
    );
  });

  it("flags a release with no changes", () => {
    const { problems } = parseChangelog("## 1.0.0\n\nJust a summary.\n");
    expect(problems).toContain("1.0.0 has no changes listed");
  });

  it("flags an Unreleased section", () => {
    const { changelog, problems } = parseChangelog(
      "## Unreleased\n### Added\n- x\n\n## 1.0.0\n### Added\n- y\n",
    );
    expect(problems).toEqual([
      'line 1: drop "## Unreleased", notes go under the version they ship in',
    ]);
    expect(changelog.releases.map((r) => r.version)).toEqual(["1.0.0"]);
  });

  it("ignores headings inside code fences", () => {
    const { changelog, problems } = parseChangelog(
      "## 1.0.0\n\n```\n## not a heading\n```\n\n### Added\n- x\n",
    );
    expect(problems).toEqual([]);
    expect(changelog.releases).toHaveLength(1);
  });
});

describe("validateChangelog", () => {
  it("passes when the newest release is the manifest version", () => {
    expect(validateChangelog(FILE, "1.1.0")).toEqual([]);
  });

  it("flags a manifest version with no notes", () => {
    expect(validateChangelog(FILE, "1.2.0")).toContain(
      "the newest release is 1.1.0, but the manifest version is 1.2.0",
    );
  });

  it("lets a beta through when its notes are not written yet", () => {
    expect(validateChangelog(FILE, "1.1.0-beta.1")).toEqual([]);
    expect(validateChangelog(FILE, "1.2.0-beta.3")).toEqual([]);
  });

  it("flags a beta older than the newest release", () => {
    expect(validateChangelog(FILE, "1.0.1-beta.1")).toContain(
      "the newest release is 1.1.0, but the manifest version is 1.0.1-beta.1",
    );
  });

  it("flags a file with no releases", () => {
    expect(validateChangelog("# Changelog\n", "1.0.0")).toEqual([
      'no releases found, add a "## 1.0.0" heading',
    ]);
  });
});

describe("changelogSection", () => {
  it("returns the Markdown under a version's heading", () => {
    expect(changelogSection(FILE, "1.1.0")).toBe(
      [
        "Second release.",
        "",
        "### Added",
        "- Something new",
        "  that wraps",
        "* Another thing",
        "",
        "### Fixed",
        "- Something broken",
      ].join("\n"),
    );
    expect(changelogSection(FILE, "1.0.0")).toBe(
      "### Added\n- The first version",
    );
  });

  it("is null for a version that is not there", () => {
    expect(changelogSection(FILE, "9.9.9")).toBeNull();
  });
});

describe("parseReleaseNotes", () => {
  it("parses a section body on its own", () => {
    expect(
      parseReleaseNotes("Summary.\n\n### Security\n- Patched a hole"),
    ).toEqual({
      summary: "Summary.",
      changes: [{ type: "security", text: "Patched a hole" }],
      problems: [],
    });
  });
});
