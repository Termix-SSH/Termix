import { describe, expect, it } from "vitest";
import { frameAllowFor } from "@/plugin-host/frames/frame-allow";

describe("frameAllowFor", () => {
  it("omits the allow policy on Firefox to avoid unknown-feature warnings", () => {
    expect(
      frameAllowFor(
        "Mozilla/5.0 (X11; Linux x86_64; rv:136.0) Gecko/20100101 Firefox/136.0",
      ),
    ).toBeUndefined();
  });

  it("delegates clipboard-write and local network access to opaque plugin frames on Chromium", () => {
    const allow = frameAllowFor(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36",
    );
    expect(allow).toBeDefined();
    const directives = allow!.split(";").map((part) => part.trim());
    expect(directives).toContain("clipboard-write");
    expect(directives).toContain("local-network-access *");
    expect(directives).toContain("local-network *");
    expect(directives).toContain("loopback-network *");
  });

  it("returns the Chromium allow policy when userAgent is empty", () => {
    expect(frameAllowFor("")).toContain("local-network-access *");
  });
});
