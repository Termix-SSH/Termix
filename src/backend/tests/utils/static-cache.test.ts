import { describe, expect, it } from "vitest";
import { staticCacheControl } from "../../utils/static-cache.js";

describe("staticCacheControl", () => {
  it("caches hashed assets for good", () => {
    expect(staticCacheControl("assets/index-abc123.js")).toContain("immutable");
  });

  it("makes the shared module shims revalidate", () => {
    expect(staticCacheControl("shared/termix-ssh-plugin-sdk-ui.js")).toBe(
      "no-cache",
    );
  });

  it("never stores the page, worker or manifest", () => {
    for (const file of ["index.html", "sw.js", "manifest.json"]) {
      expect(staticCacheControl(file)).toContain("no-store");
    }
  });

  it("leaves other files alone", () => {
    expect(staticCacheControl("favicon.ico")).toBeNull();
  });
});
