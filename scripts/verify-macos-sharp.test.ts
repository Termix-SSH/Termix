import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { expectedArchitecture, verifyApp } = require("./verify-macos-sharp.cjs");

const temporaryDirectories: string[] = [];

function createApp(architectures: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-sharp-test-"));
  temporaryDirectories.push(root);
  const app = path.join(root, "Termix.app");
  const modules = path.join(
    app,
    "Contents/Resources/app.asar.unpacked/node_modules/@img",
  );

  for (const architecture of architectures) {
    const sharp = path.join(modules, `sharp-darwin-${architecture}/lib`);
    const libvips = path.join(
      modules,
      `sharp-libvips-darwin-${architecture}/lib`,
    );
    fs.mkdirSync(sharp, { recursive: true });
    fs.mkdirSync(libvips, { recursive: true });
    fs.writeFileSync(path.join(sharp, `sharp-darwin-${architecture}.node`), "");
    fs.writeFileSync(path.join(libvips, "libvips.dylib"), "");
  }

  return app;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("macOS sharp artifact verification", () => {
  it("derives the expected architecture from artifact names", () => {
    expect(expectedArchitecture("termix_macos_x64_dmg.dmg")).toBe("x64");
    expect(expectedArchitecture("termix_macos_arm64_dmg.dmg")).toBe("arm64");
    expect(expectedArchitecture("termix_macos_universal_mas.pkg")).toBe(
      "universal",
    );
  });

  it("accepts a universal app with both sharp architectures", () => {
    expect(() =>
      verifyApp(createApp(["x64", "arm64"]), "universal", false),
    ).not.toThrow();
  });

  it("rejects an x64 app containing only arm64 sharp binaries", () => {
    expect(() => verifyApp(createApp(["arm64"]), "x64", false)).toThrow(
      /sharp-darwin-x64/,
    );
  });
});
