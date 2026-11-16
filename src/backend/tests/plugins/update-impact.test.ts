import { describe, expect, it } from "vitest";
import { pluginsBlockedOn } from "../../plugins/update-impact.js";

const plugin = (id: string, api: string, termix: string, enabled = true) => ({
  id,
  enabled,
  manifest: {
    name: id.toUpperCase(),
    version: "1.0.0",
    engine: { api, termix },
  },
});

describe("pluginsBlockedOn", () => {
  it("lists API 1 plugins and those whose range leaves the version out", () => {
    const blocked = pluginsBlockedOn("26.12.0", [
      plugin("fine", "^2.0.0", ">=26.11.2-0"),
      plugin("old", "^1.16.0", ">=26.10.0", false),
      plugin("capped", "^2.0.0", ">=26.11.2-0 <26.12.0"),
    ]);
    expect(blocked).toEqual([
      {
        id: "capped",
        name: "CAPPED",
        version: "1.0.0",
        enabled: true,
        reason: "termix",
        needs: ">=26.11.2-0 <26.12.0",
      },
      {
        id: "old",
        name: "OLD",
        version: "1.0.0",
        enabled: false,
        reason: "api",
        needs: null,
      },
    ]);
  });

  it("treats a broken range as not loading", () => {
    expect(
      pluginsBlockedOn("26.12.0", [plugin("bad", "^2.0.0", "not a range")]),
    ).toMatchObject([{ id: "bad", reason: "termix" }]);
  });
});
