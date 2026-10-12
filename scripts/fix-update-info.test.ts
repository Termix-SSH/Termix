import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { fixUpdateInfo, parseArgs } = require("./fix-update-info.cjs");

const info = {
  version: "26.10.2",
  files: [
    { url: "termix_windows_ia32_nsis.exe", sha512: "a", size: 1 },
    { url: "termix_windows_x64_nsis.exe", sha512: "b", size: 2 },
  ],
  path: "termix_windows_ia32_nsis.exe",
  sha512: "a",
  releaseDate: "2026-10-11T00:00:00.000Z",
};

describe("fixUpdateInfo", () => {
  it("drops entries and points path at what is left", () => {
    const fixed = fixUpdateInfo(info, { drop: ["ia32"] });
    expect(fixed.files.map((f: { url: string }) => f.url)).toEqual([
      "termix_windows_x64_nsis.exe",
    ]);
    expect(fixed.path).toBe("termix_windows_x64_nsis.exe");
    expect(fixed.sha512).toBe("b");
    expect(fixed.version).toBe("26.10.2");
  });

  it("drops the combined Windows installer and duplicate entries", () => {
    const fixed = fixUpdateInfo(
      {
        ...info,
        files: [
          { url: "termix_windows_nsis.exe", sha512: "c", size: 3 },
          { url: "termix_windows_ia32_nsis.exe", sha512: "a", size: 1 },
          { url: "termix_windows_x64_nsis.exe", sha512: "b", size: 2 },
          { url: "termix_windows_x64_nsis.exe", sha512: "b", size: 2 },
        ],
        path: "termix_windows_nsis.exe",
      },
      { drop: ["ia32", "termix_windows_nsis.exe"] },
    );
    expect(fixed.files).toEqual([
      { url: "termix_windows_x64_nsis.exe", sha512: "b", size: 2 },
    ]);
    expect(fixed.path).toBe("termix_windows_x64_nsis.exe");
  });

  it("follows renamed artifacts", () => {
    const fixed = fixUpdateInfo(
      {
        ...info,
        files: [{ url: "termix_linux_x86_64_appimage.AppImage", sha512: "c" }],
      },
      {
        rename: {
          "termix_linux_x86_64_appimage.AppImage":
            "termix_linux_x64_appimage.AppImage",
        },
      },
    );
    expect(fixed.path).toBe("termix_linux_x64_appimage.AppImage");
  });

  it("refuses to leave nothing to download", () => {
    expect(() => fixUpdateInfo(info, { drop: ["nsis"] })).toThrow();
  });
});

describe("parseArgs", () => {
  it("reads drops, renames and files", () => {
    expect(
      parseArgs([
        "--drop",
        "ia32",
        "--rename",
        "a=b",
        "latest.yml",
        "beta.yml",
      ]),
    ).toEqual({
      drop: ["ia32"],
      rename: { a: "b" },
      files: ["latest.yml", "beta.yml"],
    });
  });
});
