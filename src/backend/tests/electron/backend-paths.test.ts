import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { getUnpackedAppRoot } =
  require("../../../../electron/backend-paths.cjs") as {
    getUnpackedAppRoot: (appRoot: string) => string;
  };

describe("getUnpackedAppRoot", () => {
  it.each([
    [
      "/Applications/Termix.app/Contents/Resources/app.asar",
      "/Applications/Termix.app/Contents/Resources/app.asar.unpacked",
    ],
    [
      "/Applications/Termix.app/Contents/Resources/app-arm64.asar",
      "/Applications/Termix.app/Contents/Resources/app-arm64.asar.unpacked",
    ],
    [
      "/Applications/Termix.app/Contents/Resources/app-x64.asar",
      "/Applications/Termix.app/Contents/Resources/app-x64.asar.unpacked",
    ],
  ])("maps %s to its matching unpacked directory", (appRoot, expected) => {
    expect(getUnpackedAppRoot(appRoot)).toBe(expected);
  });

  it("does not append the suffix twice", () => {
    const appRoot =
      "/Applications/Termix.app/Contents/Resources/app-arm64.asar.unpacked";
    expect(getUnpackedAppRoot(appRoot)).toBe(appRoot);
  });
});
