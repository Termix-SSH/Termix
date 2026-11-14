import { describe, expect, it } from "vitest";
import { frontendIsolation } from "../../plugins/frontend-isolation.js";

const manifest = (api: string, capabilities: string[] = []) =>
  ({ engine: { termix: ">=26.11.2-0", api }, capabilities }) as never;

describe("frontendIsolation", () => {
  it("frames every API 2 plugin", () => {
    expect(frontendIsolation({ manifest: manifest("^2.0.0") })).toBe("frame");
    expect(
      frontendIsolation({
        manifest: manifest("^2.0.0"),
        source: "user",
        signedTier: "community",
      }),
    ).toBe("frame");
  });

  it("keeps API 1 plugins in the page until they move", () => {
    expect(frontendIsolation({ manifest: manifest("^1.15.0") })).toBe("page");
  });

  it("keeps official shell parts in the page", () => {
    for (const capability of [
      "ui:layout",
      "ui:theme",
      "auth:provide",
      "desktop:window",
    ]) {
      expect(
        frontendIsolation({
          manifest: manifest("^2.0.0", [capability]),
          source: "bundled",
        }),
        capability,
      ).toBe("page");
      expect(
        frontendIsolation({
          manifest: manifest("^2.0.0", [capability]),
          source: "user",
          signedTier: "official",
        }),
        capability,
      ).toBe("page");
    }
  });

  it("frames a shell part that is not officially signed", () => {
    expect(
      frontendIsolation({
        manifest: manifest("^2.0.0", ["ui:layout", "auth:provide"]),
        source: "user",
        signedTier: "community",
      }),
    ).toBe("frame");
    expect(
      frontendIsolation({
        manifest: manifest("^2.0.0", ["ui:theme", "desktop:window"]),
        source: "user",
      }),
    ).toBe("frame");
  });
});
