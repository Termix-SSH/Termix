import { describe, expect, it } from "vitest";
import { releaseUrlFrom } from "../../api/system-status-api";

describe("releaseUrlFrom", () => {
  it("hands back the release page so the version badge can link to it", () => {
    expect(
      releaseUrlFrom({
        status: "requires_update",
        localVersion: "2.6.0",
        remoteVersion: "2.6.1",
        latest_release: {
          tag_name: "release-2.6.1-tag",
          name: "release-2.6.1",
          published_at: "2026-08-06T19:49:43Z",
          html_url:
            "https://github.com/Termix-SSH/Termix/releases/tag/release-2.6.1-tag",
          body: "",
        },
      }),
    ).toBe(
      "https://github.com/Termix-SSH/Termix/releases/tag/release-2.6.1-tag",
    );
  });

  it("returns an empty string when the response carries no release", () => {
    // The badge treats "" as "nothing to link to" and stays an inert span, so
    // a version response without a release must not produce a dead anchor.
    expect(releaseUrlFrom({ status: "up_to_date", localVersion: "2.6.1" })).toBe(
      "",
    );
  });

  it("returns an empty string when the release carries no URL", () => {
    expect(
      releaseUrlFrom({
        status: "requires_update",
        latest_release: { tag_name: "release-2.6.1-tag" },
      }),
    ).toBe("");
  });

  it("tolerates a missing response, since the caller's fetch can fail", () => {
    expect(releaseUrlFrom(undefined)).toBe("");
    expect(releaseUrlFrom(null)).toBe("");
  });
});
