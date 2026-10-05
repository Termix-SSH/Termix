import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isSourceFile } = require("./crowdin-pretranslate.cjs") as {
  isSourceFile: (file: { path?: string }) => boolean;
};

describe("isSourceFile", () => {
  it("matches the core source file", () => {
    expect(isSourceFile({ path: "/en.json" })).toBe(true);
  });

  it("skips anything else", () => {
    expect(isSourceFile({ path: "/src/ui/locales/en.json" })).toBe(false);
    expect(isSourceFile({ path: "/plugins/acme-ssl/locales/en.json" })).toBe(
      false,
    );
    expect(isSourceFile({})).toBe(false);
  });
});
