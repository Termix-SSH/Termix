import { afterEach, describe, expect, it } from "vitest";
import { frontendIsolation } from "../../plugins/frontend-isolation.js";
import { resetCommunityLooks } from "../../plugins/community-looks.js";

afterEach(() => resetCommunityLooks(false));

const plugin = (capabilities: string[], signedTier = "community") => ({
  manifest: { engine: { termix: ">=26.11.2", api: "^2.0.0" }, capabilities },
  source: "registry",
  signedTier,
});

describe("community looks", () => {
  it("frames a community layout until an admin allows it", () => {
    expect(frontendIsolation(plugin(["ui:layout"]) as never)).toBe("frame");
    resetCommunityLooks(true);
    expect(frontendIsolation(plugin(["ui:layout"]) as never)).toBe("page");
    expect(frontendIsolation(plugin(["ui:theme"]) as never)).toBe("page");
  });

  it("keeps other plugins and other shell parts framed", () => {
    resetCommunityLooks(true);
    expect(frontendIsolation(plugin(["hosts:read"]) as never)).toBe("frame");
    expect(
      frontendIsolation(plugin(["ui:layout", "sync:provide"]) as never),
    ).toBe("frame");
  });

  it("leaves official looks in the page either way", () => {
    expect(frontendIsolation(plugin(["ui:layout"], "official") as never)).toBe(
      "page",
    );
  });
});
