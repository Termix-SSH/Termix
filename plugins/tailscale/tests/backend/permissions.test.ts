import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseManifest, qualifyPermission } from "@termix/plugin-sdk/manifest";

/**
 * The permission ids an admin grants.
 *
 * Core registers each declared name as `<pluginId>.<name>`, so these strings
 * are what end up stored in a role. They have to keep matching what tailscale
 * shipped before the permissions moved out of the core catalog, or every role
 * holding one would silently stop working.
 */
const EXPECTED = ["tailscale.devices.view"];

describe("tailscale permissions", () => {
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
      (permission) => qualifyPermission("tailscale", permission.name),
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

  // The device list is a full tailnet inventory, so only admins get it by
  // default; everyone else needs an explicit grant.
  it("grants devices.view to admins by default", () => {
    const devicesView = manifest.manifest?.contributes?.permissions?.find(
      (permission) => permission.name === "devices.view",
    );
    expect(devicesView?.defaultRoles).toEqual(["admin"]);
  });
});
