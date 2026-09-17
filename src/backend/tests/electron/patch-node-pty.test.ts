import { createRequire } from "node:module";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { chmodSpawnHelpers } = require("../../../../scripts/patch-node-pty.cjs");

// chmod's execute bit is a POSIX concept; Windows/NTFS has no equivalent mode bit.
const itPosix = process.platform === "win32" ? it.skip : it;

describe("patch-node-pty", () => {
  itPosix("restores execute permissions on spawn-helper binaries", () => {
    const root = join(tmpdir(), `termix-node-pty-${Date.now()}`);
    const helper = join(root, "prebuilds", "darwin-arm64", "spawn-helper");
    mkdirSync(join(root, "prebuilds", "darwin-arm64"), { recursive: true });
    writeFileSync(helper, "helper");
    chmodSync(helper, 0o644);

    expect(chmodSpawnHelpers(root)).toBe(1);
    expect(statSync(helper).mode & 0o111).not.toBe(0);

    expect(chmodSpawnHelpers(root)).toBe(0);
    expect(existsSync(helper)).toBe(true);
  });
});
