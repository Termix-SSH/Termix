import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Elevated commands read the host's sudo password, which core only hands to
// a plugin holding credentials:read.
describe("sudo password access", () => {
  it("declares credentials:read", () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.resolve(import.meta.dirname, "../../manifest.json"),
        "utf8",
      ),
    );
    expect(manifest.capabilities).toContain("credentials:read");
  });
});
