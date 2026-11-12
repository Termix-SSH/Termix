import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { dropCpuFeatures } = require("./drop-cpu-features.cjs");

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "drop-cpu-"));
  const dir = path.join(root, "node_modules", "cpu-features");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), "{}");
  return { root, dir };
}

describe("drop-cpu-features", () => {
  it("removes a copy whose install script never ran", () => {
    const { root, dir } = project();
    try {
      expect(dropCpuFeatures(root)).toBe(true);
      expect(fs.existsSync(dir)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a built copy and is fine when it is missing", () => {
    const { root, dir } = project();
    try {
      fs.writeFileSync(path.join(dir, "buildcheck.gypi"), "{}");
      expect(dropCpuFeatures(root)).toBe(false);
      expect(fs.existsSync(dir)).toBe(true);
      fs.rmSync(dir, { recursive: true, force: true });
      expect(dropCpuFeatures(root)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
