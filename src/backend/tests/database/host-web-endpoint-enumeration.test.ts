import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * This codebase enumerates host columns by hand in a lot of places, and
 * "added a column, missed one update path" is its most repeated bug -- during
 * the first attempt at this feature a field was missed at one of these points
 * six separate times, each surfacing as a different mystery (endpoints that
 * saved but never appeared, config that vanished on reload).
 *
 * Every one of these files already enumerates the Docker pair, which is the
 * exact shape the web endpoint pair copies. So "mentions enableDocker but not
 * enableWebUi" is a reliable proxy for "was not updated", and it fails loudly
 * the moment someone adds the tenth enumeration point without this one.
 *
 * This is a coarse guard on purpose: it cannot tell whether the field is used
 * CORRECTLY, only that the file knows it exists. Behavioural coverage lives in
 * the route tests.
 */
function source(relative: string): string {
  return readFileSync(path.resolve(relative), "utf8");
}

const ENUMERATION_POINTS = [
  "src/backend/database/database.ts",
  "src/backend/database/db/index.ts",
  "src/backend/database/routes/host-normalizers.ts",
  "src/backend/database/routes/host.ts",
  "src/backend/database/routes/host-bulk-routes.ts",
  "src/ui/sidebar/host-export-payload.ts",
  "src/ui/sidebar/HostManagerData.ts",
  "src/ui/sidebar/HostEditorData.ts",
  "src/ui/shell/tabUtils.tsx",
];

describe("web endpoint column enumeration", () => {
  it.each(ENUMERATION_POINTS)(
    "%s enumerates the enable flag alongside enableDocker",
    (file) => {
      const text = source(file);
      // Guards the guard: if the Docker anchor ever disappears from a file,
      // this test would otherwise pass vacuously forever.
      expect(text).toMatch(/enableDocker|enable_docker/);
      expect(text).toMatch(/enableWebUi|enable_web_ui/);
    },
  );

  it.each(ENUMERATION_POINTS)(
    "%s enumerates the config column alongside dockerConfig",
    (file) => {
      const text = source(file);
      expect(text).toMatch(/dockerConfig|docker_config/);
      expect(text).toMatch(/webUiConfig|web_ui_config/);
    },
  );

  it("parses webUiConfig through the guarded parser, not a bare JSON.parse", () => {
    // dockerConfig uses a bare JSON.parse, so one malformed value takes out
    // the whole host listing. Do not copy that.
    const text = source("src/backend/database/routes/host-normalizers.ts");
    expect(text).toContain("parseWebUiConfig");
    expect(text).not.toMatch(/JSON\.parse\(\s*host\.webUiConfig/);
  });

  it("clears webUiConfig on disable in both host.ts write paths", () => {
    // Three write paths disagreed on this during the first attempt. The export
    // payload ships webUiConfig unconditionally, so a host disabled without
    // clearing still exports its endpoint list -- internal hostnames, ports and
    // paths -- while the UI reads as off everywhere, and re-enabling silently
    // resurrects stale endpoints.
    const text = source("src/backend/database/routes/host.ts");
    // Create and update. Anchored on the exact conditional, not a loose
    // pattern: a looser regex here passed even with the guard deleted.
    const occurrences = text.split("webUiConfig: enableWebUi").length - 1;
    expect(occurrences).toBe(2);
  });

  it("clears webUiConfig on a bulk disable", () => {
    const text = source("src/backend/database/routes/host-bulk-routes.ts");
    expect(text).toContain(
      "if (!updates.enableWebUi) simpleUpdates.webUiConfig = null;",
    );
  });

  it("shares webUiConfig with connect-level recipients", () => {
    // A connect-level recipient is ALREADY authorized to open these tunnels
    // (the open route gates on canAccessHost(..., "connect")), so withholding
    // the config only breaks discovery while the flag advertises the feature.
    // The dockerConfig precedent does not transfer: Docker's tab works without
    // its config, whereas a web endpoint IS its config.
    const text = source("src/backend/database/routes/host-normalizers.ts");
    const block = text.slice(text.indexOf("CONNECT_LEVEL_FIELDS"));
    const list = block.slice(0, block.indexOf("]"));
    expect(list).toContain("enableWebUi");
    expect(list).toContain("webUiConfig");
  });
});
