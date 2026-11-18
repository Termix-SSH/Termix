import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { patchModuleManager } = require("./patch-app-builder-lib.cjs");

const UPSTREAM = `class ModuleManager {
    async a() {
            if (json && this.semverSatisfies(json.version, requiredRange)) {
                return 1;
            }
    }
    semverSatisfies(found, range) {
        if ((0, builder_util_1.isEmptyOrSpaces)(range) || range === "*") {
            return true;
        }
    }
    async processScope() {
                if (json && this.semverSatisfies(json.version, requiredRange)) {
                    return 2;
                }
    }
}
`;

function patched(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abl-"));
  const file = path.join(dir, "moduleManager.js");
  fs.writeFileSync(file, source);
  patchModuleManager(file);
  const out = fs.readFileSync(file, "utf8");
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

describe("app-builder-lib npm alias patch", () => {
  it("skips the version check for every call site when the name differs", () => {
    const out = patched(UPSTREAM);
    expect(out).toContain(
      "semverSatisfies(found, range, packageNameMatches = true)",
    );
    expect(out).not.toContain(
      "this.semverSatisfies(json.version, requiredRange))",
    );
    expect(out.match(/requiredRange, json\.name === pkgName\)/g)?.length).toBe(
      2,
    );
  });

  it("leaves an already patched file alone", () => {
    const once = patched(UPSTREAM);
    expect(patched(once)).toBe(once);
  });

  it("matches the app-builder-lib that is installed", () => {
    const file =
      require.resolve("app-builder-lib/out/node-module-collector/moduleManager.js");
    const source = fs.readFileSync(file, "utf8");
    expect(source).toContain("packageNameMatches = true");
    expect(source).not.toContain(
      "this.semverSatisfies(json.version, requiredRange))",
    );
  });
});
