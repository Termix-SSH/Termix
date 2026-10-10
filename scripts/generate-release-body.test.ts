import { describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { buildBody } = require("./generate-release-body.cjs");

const CHANGELOG = [
  "# Changelog",
  "",
  "## 26.11.0",
  "",
  "### Fixed",
  "- A bug",
  "",
  "## 26.10.0",
  "",
  "### Added",
  "- Plugins",
  "",
].join("\n");

describe("buildBody", () => {
  it("uses the version's changelog section and v tags for downloads", () => {
    const body = buildBody({
      version: "26.10.0",
      mobileVersion: "1.2.0",
      changelog: CHANGELOG,
    });
    expect(body).toContain("### Added\n- Plugins");
    expect(body).not.toContain("A bug");
    expect(body).toContain("/releases/download/v26.10.0/termix_");
    expect(body).toContain(
      "Mobile/releases/download/v1.2.0/termix_android.apk",
    );
  });

  it("works for the real changelog", () => {
    const fs = require("fs");
    const body = buildBody({
      version: require("../package.json").version,
      mobileVersion: "1.0.0",
      changelog: fs.readFileSync("CHANGELOG.md", "utf8"),
    });
    expect(body.length).toBeGreaterThan(0);
  });
});
