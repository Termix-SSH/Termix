import { describe, expect, it } from "vitest";
import { validateChangelog } from "../packages/plugin-sdk/cli/lib/changelog.mjs";

function release(version: string, extra: Record<string, unknown> = {}) {
  return {
    version,
    date: "2026-10-01",
    changes: [{ type: "added", text: "Something new" }],
    ...extra,
  };
}

describe("validateChangelog", () => {
  it("accepts a changelog whose newest release matches the manifest", () => {
    const changelog = {
      $schema: "https://example.com/changelog.schema.json",
      unreleased: [{ type: "fixed", text: "A bug" }],
      releases: [
        release("1.1.0", { notes: "Second release." }),
        release("1.0.0"),
      ],
    };
    expect(validateChangelog(changelog, "1.1.0")).toEqual([]);
  });

  it("accepts a release that has no date yet", () => {
    const { date: _date, ...undated } = release("1.0.0");
    expect(validateChangelog({ releases: [undated] }, "1.0.0")).toEqual([]);
  });

  it("flags a manifest version with no release notes", () => {
    const problems = validateChangelog(
      { releases: [release("1.0.0")] },
      "1.1.0",
    );
    expect(problems).toContain(
      "the newest release is 1.0.0, but manifest version is 1.1.0",
    );
  });

  it("requires releases newest first and without duplicates", () => {
    expect(
      validateChangelog(
        { releases: [release("1.0.0"), release("1.2.0")] },
        "1.0.0",
      ),
    ).toContain("releases must be listed newest first");
    expect(
      validateChangelog(
        { releases: [release("1.0.0"), release("1.0.0")] },
        "1.0.0",
      ),
    ).toContain("releases[1].version 1.0.0 is listed twice");
  });

  it("orders a prerelease below its release", () => {
    expect(
      validateChangelog(
        { releases: [release("2.0.0"), release("2.0.0-beta.1")] },
        "2.0.0",
      ),
    ).toEqual([]);
    expect(
      validateChangelog(
        { releases: [release("2.0.0-beta.1"), release("2.0.0")] },
        "2.0.0-beta.1",
      ),
    ).toContain("releases must be listed newest first");
  });

  it("rejects bad versions, dates, change types and empty text", () => {
    const problems = validateChangelog(
      {
        releases: [
          {
            version: "v1",
            date: "October 1",
            changes: [{ type: "improved", text: " " }],
          },
        ],
      },
      undefined,
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        "releases[0].version must be a version like 1.2.3",
        "releases[0].date must be a date like 2026-10-01",
        expect.stringContaining("releases[0].changes[0].type must be one of"),
        "releases[0].changes[0].text must be a non-empty string",
      ]),
    );
  });

  it("rejects unknown keys, empty change lists and missing releases", () => {
    expect(validateChangelog({ releases: [] }, "1.0.0")).toEqual([
      "releases must be a non-empty array",
    ]);
    expect(
      validateChangelog(
        { extra: true, releases: [release("1.0.0", { changes: [] })] },
        "1.0.0",
      ),
    ).toEqual(
      expect.arrayContaining([
        'CHANGELOG.json has unknown key "extra"',
        "releases[0].changes must list at least one change",
      ]),
    );
    expect(validateChangelog([], "1.0.0")).toEqual([
      "CHANGELOG.json must be an object",
    ]);
  });
});
