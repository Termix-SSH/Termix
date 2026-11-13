import { afterEach, describe, expect, it } from "vitest";
import { coreVersionOf } from "./lib/server.mjs";

const git = (stdout: string) => () => ({ stdout }) as never;

afterEach(() => {
  delete process.env.TERMIX_AUTHZ_CORE_VERSION;
});

describe("coreVersionOf", () => {
  it("reads the coming release from a dev branch", () => {
    expect(coreVersionOf("core", git("dev-26.11.2\n"))).toBe("26.11.2");
    expect(coreVersionOf("core", git("dev-2.0.0-beta.1"))).toBe("2.0.0-beta.1");
  });

  it("leaves package.json in charge on any other branch", () => {
    expect(coreVersionOf("core", git("main"))).toBeUndefined();
    expect(coreVersionOf("core", git(""))).toBeUndefined();
  });

  it("takes an explicit version first", () => {
    process.env.TERMIX_AUTHZ_CORE_VERSION = "27.1.0";
    expect(coreVersionOf("core", git("dev-26.11.2"))).toBe("27.1.0");
  });
});
