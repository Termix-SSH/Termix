import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  buildNotes,
  toPlainText,
  truncate,
  MAX_LENGTH,
} = require("./generate-appstore-notes.cjs");

function notesFile(sections: Record<string, string>) {
  return Object.entries(sections)
    .map(([name, body]) => `<!-- ${name} -->\n${body}\n<!-- /${name} -->`)
    .join("\n\n");
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
    const result = truncate("- One\n\nBug Fixes:\n- Two", 18);
    expect(result).toBe("- One");
  });
});

describe("buildNotes", () => {
  it("includes the summary, update log, and bug fixes", () => {
    const notes = buildNotes(
      notesFile({
        SUMMARY: "A big release.",
        UPDATE_LOG: "- Added a thing",
        BUG_FIXES: "- Fixed a thing",
      }),
    );

    expect(notes).toContain("A big release.");
    expect(notes).toContain("Update Log:");
    expect(notes).toContain("- Added a thing");
    expect(notes).toContain("Bug Fixes:");
    expect(notes).toContain("- Fixed a thing");
  });

  it("omits optional sections that are absent", () => {
    const notes = buildNotes(notesFile({ SUMMARY: "Small release." }));

    expect(notes).toBe("Small release.");
    expect(notes).not.toContain("Update Log:");
    expect(notes).not.toContain("Bug Fixes:");
  });

  it("stays within the App Store character limit", () => {
    const notes = buildNotes(
      notesFile({
        SUMMARY: "Big release.",
        UPDATE_LOG: Array.from(
          { length: 400 },
          (_, i) => `- Added feature number ${i}`,
        ).join("\n"),
        BUG_FIXES: Array.from(
          { length: 400 },
          (_, i) => `- Fixed bug number ${i}`,
        ).join("\n"),
      }),
    );

    expect(notes.length).toBeLessThanOrEqual(MAX_LENGTH);
    expect(notes.length).toBeGreaterThan(0);
  });

  it("never ends mid-bullet when truncating", () => {
    const notes = buildNotes(
      notesFile({
        SUMMARY: "Big release.",
        UPDATE_LOG: Array.from(
          { length: 400 },
          (_, i) => `- Added feature number ${i}`,
        ).join("\n"),
      }),
    );

    const lines = notes.split("\n");
    expect(lines[lines.length - 1]).toMatch(/^- Added feature number \d+$/);
  });

  it("produces non-empty notes for the real release notes file", () => {
    const fs = require("fs");
    const notes = buildNotes(fs.readFileSync("RELEASE_NOTES.md", "utf8"));

    expect(notes.length).toBeGreaterThan(0);
    expect(notes.length).toBeLessThanOrEqual(MAX_LENGTH);
  });
});
