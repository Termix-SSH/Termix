import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  buildNotes,
  toPlainText,
  truncate,
  MAX_LENGTH,
} = require("./generate-appstore-notes.cjs");

function changelog(body: string, version = "26.10.0") {
  return [
    "# Changelog",
    "",
    `## ${version}`,
    "",
    body,
    "",
    "## 26.9.0",
    "",
    "### Added",
    "- Older",
    "",
  ].join("\n");
}

describe("toPlainText", () => {
  it("strips markdown links down to their label", () => {
    expect(toPlainText("- See [the docs](https://example.com)")).toBe(
      "- See the docs",
    );
  });

  it("strips backticks and bold markers", () => {
    expect(toPlainText("- Fixed `npm run build` and **crashes**")).toBe(
      "- Fixed npm run build and crashes",
    );
  });

  it("keeps nested bullets indented", () => {
    expect(toPlainText("- Top\n  - Nested")).toBe("- Top\n  - Nested");
  });

  it("normalizes asterisk bullets to dashes", () => {
    expect(toPlainText("* One\n* Two")).toBe("- One\n- Two");
  });

  it("turns headings into labels", () => {
    expect(toPlainText("### Added\n- One")).toBe("Added:\n- One");
  });

  it("collapses runs of blank lines", () => {
    expect(toPlainText("- One\n\n\n\n- Two")).toBe("- One\n\n- Two");
  });
});

describe("truncate", () => {
  it("leaves text under the limit untouched", () => {
    expect(truncate("- One\n- Two", 100)).toBe("- One\n- Two");
  });

  it("drops whole trailing lines rather than splitting one", () => {
    const result = truncate("- One\n- Two\n- Three", 12);
    expect(result).toBe("- One\n- Two");
  });

  it("drops a section header left with no bullets under it", () => {
    const result = truncate("- One\n\nFixed:\n- Two", 14);
    expect(result).toBe("- One");
  });
});

describe("buildNotes", () => {
  it("uses only the version's section", () => {
    const notes = buildNotes(
      changelog("A summary.\n\n### Added\n- A thing\n\n### Fixed\n- A bug"),
      "26.10.0",
    );
    expect(notes).toBe("A summary.\n\nAdded:\n- A thing\n\nFixed:\n- A bug");
    expect(notes).not.toContain("Older");
  });

  it("stays within the App Store limit and never ends mid-bullet", () => {
    const bullets = Array.from(
      { length: 400 },
      (_, i) => `- Added feature number ${i}`,
    );
    const notes = buildNotes(
      changelog(`### Added\n${bullets.join("\n")}`),
      "26.10.0",
    );
    expect(notes.length).toBeLessThanOrEqual(MAX_LENGTH);
    expect(notes.split("\n").at(-1)).toMatch(/^- Added feature number \d+$/);
  });

  it("produces notes for the real changelog", () => {
    const fs = require("fs");
    const notes = buildNotes(
      fs.readFileSync("CHANGELOG.md", "utf8"),
      require("../package.json").version,
    );
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.length).toBeLessThanOrEqual(MAX_LENGTH);
  });
});
