import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { linuxSharpPackages } = require("./install-linux-sharp.cjs");

const lock = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../package-lock.json"), "utf8"),
);
const sharpManifest = lock.packages["node_modules/sharp"];

describe("Linux sharp packaging", () => {
  // The build runs on x64 but ships arm64 and armv7l too, so npm ci alone
  // only installs the x64 binaries and the arm AppImages cannot load sharp.
  it("pins the sharp and libvips binaries of every shipped Linux architecture", () => {
    const packages = linuxSharpPackages({
      optionalDependencies: {
        "@img/sharp-linux-x64": "1.0.0",
        "@img/sharp-linux-arm64": "1.0.1",
        "@img/sharp-linux-arm": "1.0.2",
        "@img/sharp-libvips-linux-x64": "2.0.0",
        "@img/sharp-libvips-linux-arm64": "2.0.1",
        "@img/sharp-libvips-linux-arm": "2.0.2",
        "@img/sharp-win32-x64": "9.9.9",
      },
    });

    expect([...packages].sort()).toEqual([
      "@img/sharp-libvips-linux-arm64@2.0.1",
      "@img/sharp-libvips-linux-arm@2.0.2",
      "@img/sharp-libvips-linux-x64@2.0.0",
      "@img/sharp-linux-arm64@1.0.1",
      "@img/sharp-linux-arm@1.0.2",
      "@img/sharp-linux-x64@1.0.0",
    ]);
  });

  it("only names packages the installed sharp really declares", () => {
    const packages = linuxSharpPackages(sharpManifest);
    expect(packages).toHaveLength(6);
    for (const spec of packages) {
      expect(spec).toMatch(/^@img\/sharp-[a-z0-9-]+@\d+\.\d+\.\d+$/);
    }
  });

  it("fails loudly when sharp stops declaring one of them", () => {
    expect(() =>
      linuxSharpPackages({
        optionalDependencies: {
          "@img/sharp-linux-x64": "1.0.0",
          "@img/sharp-libvips-linux-x64": "2.0.0",
        },
      }),
    ).toThrow(/sharp-linux-arm64/);
  });
});
