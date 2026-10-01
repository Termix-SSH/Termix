import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { misplaced } = require("./check-test-locations.cjs") as {
  misplaced: (root: string) => string[];
};

let root: string | null = null;

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = null;
});

function fixture(files: string[]): string {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "test-locations-"));
  for (const file of files) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "");
  }
  return root;
}

describe("misplaced", () => {
  it("accepts the mirrored test trees", () => {
    const dir = fixture([
      "src/backend/tests/utils/a.test.ts",
      "src/ui/tests/lib/b.test.tsx",
      "scripts/c.test.ts",
      "plugins/docker/tests/backend/d.test.ts",
      "plugins/docker/node_modules/pkg/e.test.ts",
      "plugins/docker/dist/f.test.ts",
    ]);
    expect(misplaced(dir)).toEqual([]);
  });

  it("refuses a test next to its source", () => {
    const dir = fixture([
      "src/backend/utils/a.test.ts",
      "src/ui/lib/b.test.tsx",
      "plugins/docker/src/frontend/c.test.tsx",
      "packages/plugin-sdk/src/d.test.ts",
      "src/backend/utils/not-a-test.ts",
    ]);
    expect(misplaced(dir)).toEqual([
      "packages/plugin-sdk/src/d.test.ts",
      "plugins/docker/src/frontend/c.test.tsx",
      "src/backend/utils/a.test.ts",
      "src/ui/lib/b.test.tsx",
    ]);
  });
});
