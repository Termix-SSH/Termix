import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTreeReadable } from "../../plugins/readable-tree.js";

const posix = process.platform !== "win32";

describe("makeTreeReadable", () => {
  it.skipIf(!posix)(
    "opens code unpacked under core's private umask to the plugin's user",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "readable-"));
      // What tar leaves under umask 077 (workers can't set the umask).
      fs.mkdirSync(path.join(root, "plugin", "dist"), { recursive: true });
      fs.writeFileSync(path.join(root, "plugin", "dist", "backend.js"), "x");
      fs.chmodSync(path.join(root, "plugin", "dist", "backend.js"), 0o600);
      fs.chmodSync(path.join(root, "plugin", "dist"), 0o700);
      fs.chmodSync(path.join(root, "plugin"), 0o700);
      const mode = (p: string) => fs.statSync(p).mode & 0o777;
      expect(mode(path.join(root, "plugin"))).toBe(0o700);

      await makeTreeReadable(path.join(root, "plugin"));

      expect(mode(path.join(root, "plugin"))).toBe(0o755);
      expect(mode(path.join(root, "plugin", "dist"))).toBe(0o755);
      expect(mode(path.join(root, "plugin", "dist", "backend.js"))).toBe(0o644);
      fs.rmSync(root, { recursive: true, force: true });
    },
  );
});
