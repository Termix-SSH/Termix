import { describe, expect, it } from "vitest";
import {
  compareSemver,
  isPrereleaseVersion,
  normalizeVersion,
  updateStatus,
} from "../../utils/latest-release.js";

describe("normalizeVersion", () => {
  it("reads tags and short versions and keeps the prerelease part", () => {
    expect(normalizeVersion("v2.8")).toBe("2.8.0");
    expect(normalizeVersion("release-2.9.1-tag")).toBe("2.9.1-tag");
    expect(normalizeVersion("v26.11.0-beta.2")).toBe("26.11.0-beta.2");
    expect(normalizeVersion("nightly")).toBeNull();
  });
});

describe("compareSemver", () => {
  it("orders betas below their stable release and by number", () => {
    expect(compareSemver("26.11.0-beta.1", "26.11.0")).toBe(-1);
    expect(compareSemver("26.11.0-beta.2", "26.11.0-beta.10")).toBe(-1);
    expect(compareSemver("26.11.0-beta.1", "26.10.3")).toBe(1);
    expect(compareSemver("v2.9.0", "2.9")).toBe(0);
    expect(compareSemver("x", "2.9.0")).toBeNull();
  });
});

describe("updateStatus", () => {
  it("calls a newer release on the channel an update", () => {
    expect(updateStatus("26.10.0", "26.10.1")).toBe("requires_update");
    expect(updateStatus("26.11.0-beta.1", "26.11.0-beta.2")).toBe(
      "requires_update",
    );
    expect(updateStatus("26.11.0-beta.2", "26.11.0")).toBe("requires_update");
  });

  it("marks betas and builds ahead of the newest release as beta", () => {
    expect(updateStatus("26.11.0-beta.2", "26.11.0-beta.2")).toBe("beta");
    expect(updateStatus("26.11.0-beta.2", "26.10.0")).toBe("beta");
    expect(updateStatus("26.11.0", "26.10.0")).toBe("beta");
    expect(updateStatus("26.10.0", "26.10.0")).toBe("up_to_date");
    expect(updateStatus("26.10.0", null)).toBe("up_to_date");
  });

  it("knows a prerelease", () => {
    expect(isPrereleaseVersion("26.11.0-beta.1")).toBe(true);
    expect(isPrereleaseVersion("26.11.0")).toBe(false);
  });
});
