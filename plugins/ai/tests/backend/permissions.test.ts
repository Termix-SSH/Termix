import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseManifest, qualifyPermission } from "@termix/plugin-sdk/manifest";

/**
 * The permission ids an admin grants.
 *
 * Core registers each declared name as `<pluginId>.<name>`, so these strings
 * are what end up stored in a role. They have to keep matching what ai
 * shipped before the permissions moved out of the core catalog, or every role
 * holding one would silently stop working.
 */
const EXPECTED = [
  "ai.use",
  "ai.manage_providers",
  "ai.apply_proposals",
  "ai.services.use",
  "ai.secrets.share",
];

describe("ai permissions", () => {
  const manifest = parseManifest(
    JSON.parse(
      fs.readFileSync(
        path.resolve(import.meta.dirname, "../../manifest.json"),
        "utf8",
      ),
    ),
  );

  it("parses cleanly", () => {
    expect(manifest.errors).toEqual([]);
  });

  it("registers exactly the ids roles already hold", () => {
    const ids = (manifest.manifest?.contributes?.permissions ?? []).map(
      (permission) => qualifyPermission("ai", permission.name),
    );

    expect(ids).toEqual(EXPECTED);
  });

  it("declares a title and description for every permission", () => {
    for (const permission of manifest.manifest?.contributes?.permissions ??
      []) {
      expect(permission.titleKey).toBeTruthy();
      expect(permission.descriptionKey).toBeTruthy();
    }
  });

  // Core used to grant these through SYSTEM_ROLE_DEFAULTS, so a fresh install
  // has to keep giving them to the user role.
  it("keeps the fresh-install defaults core used to seed", () => {
    for (const permission of manifest.manifest?.contributes?.permissions ??
      []) {
      expect(permission.defaultRoles).toEqual(["user"]);
    }
  });
});
