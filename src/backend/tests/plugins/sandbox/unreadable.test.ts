import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  explainStartError,
  firstUnreadable,
} from "../../../plugins/sandbox/unreadable.js";

const posix = process.platform !== "win32";
let root: string;
let file: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "unreadable-"));
  fs.chmodSync(root, 0o755);
  const dir = path.join(root, "plugins", "vault", "dist");
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, "backend.js");
  fs.writeFileSync(file, "export {};");
  for (const d of [
    path.join(root, "plugins"),
    path.join(root, "plugins", "vault"),
    dir,
  ]) {
    fs.chmodSync(d, 0o755);
  }
  fs.chmodSync(file, 0o644);
  process.env.TERMIX_PLUGIN_LAUNCHER = "1";
});

afterEach(() => {
  delete process.env.TERMIX_PLUGIN_LAUNCHER;
  fs.chmodSync(path.join(root, "plugins", "vault"), 0o755);
  fs.rmSync(root, { recursive: true, force: true });
});

const missing = () =>
  `Cannot find module '${file}' imported from /app/runtime.js`;

describe.runIf(posix)("firstUnreadable", () => {
  it("finds nothing when every step is open", () => {
    expect(firstUnreadable(file)).toBeNull();
  });

  it("names the folder other users can't enter", () => {
    fs.chmodSync(path.join(root, "plugins", "vault"), 0o700);
    expect(firstUnreadable(file)).toEqual({
      path: path.join(root, "plugins", "vault"),
      mode: 0o700,
    });
  });

  it("names a file other users can't read", () => {
    fs.chmodSync(file, 0o600);
    expect(firstUnreadable(file)).toEqual({ path: file, mode: 0o600 });
  });
});

describe.runIf(posix)("explainStartError", () => {
  it("says the plugin can't read its files and how to fix it", () => {
    fs.chmodSync(path.join(root, "plugins", "vault"), 0o700);
    const why = explainStartError("vault", missing());
    expect(why).toContain("can't read its own files");
    expect(why).toContain("mode 700");
    expect(why).toContain("chmod -R a+rX");
  });

  it("keeps the message when the file is really missing", () => {
    fs.rmSync(file);
    expect(explainStartError("vault", missing())).toBe(missing());
  });

  it("keeps the message when plugins share core's user", () => {
    delete process.env.TERMIX_PLUGIN_LAUNCHER;
    fs.chmodSync(path.join(root, "plugins", "vault"), 0o700);
    expect(explainStartError("vault", missing())).toBe(missing());
  });

  it("leaves other errors alone", () => {
    expect(explainStartError("vault", "boom")).toBe("boom");
  });
});
