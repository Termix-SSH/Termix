import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { frameRuntimeCandidates } from "../../http/frame-runtime.js";

const root = path.resolve(import.meta.dirname, "../../../..");

describe("frame runtime folder", () => {
  it("is looked up beside the backend the desktop app ships", () => {
    // The compiled backend sits in dist/backend/backend/http.
    const candidates = frameRuntimeCandidates().map((dir) =>
      path.normalize(dir),
    );
    const here = path.join(root, "src", "backend", "http");
    expect(candidates).toContain(
      path.normalize(path.join(here, "../../../frame")),
    );
  });

  it("is unpacked from the asar with its fonts, where the backend can read it", () => {
    const builder = JSON.parse(
      fs.readFileSync(path.join(root, "electron-builder.json"), "utf8"),
    ) as { asarUnpack: string[] };
    expect(builder.asarUnpack).toEqual(
      expect.arrayContaining([
        "dist/backend/**/*",
        "dist/frame/**/*",
        "dist/fonts/**/*",
      ]),
    );
  });
});
