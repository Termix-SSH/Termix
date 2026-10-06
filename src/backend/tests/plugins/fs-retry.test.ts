import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { moveWithRetry } from "../../plugins/fs-retry.js";

const roots: string[] = [];

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-move-"));
  roots.push(root);
  return root;
}

function locked(): NodeJS.ErrnoException {
  return Object.assign(new Error("locked"), { code: "EPERM" });
}

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe("moveWithRetry", () => {
  it("waits out a passing lock", async () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, "from"));
    const real = fs.promises.rename;
    const rename = vi
      .spyOn(fs.promises, "rename")
      .mockRejectedValueOnce(locked())
      .mockImplementation(real);

    await moveWithRetry(path.join(root, "from"), path.join(root, "to"), [1, 1]);

    expect(rename).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(path.join(root, "to"))).toBe(true);
  });

  it("copies a folder that never unlocks", async () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, "from", "nested"), { recursive: true });
    fs.writeFileSync(path.join(root, "from", "nested", "a.js"), "x");
    vi.spyOn(fs.promises, "rename").mockRejectedValue(locked());

    await moveWithRetry(path.join(root, "from"), path.join(root, "to"), [1]);

    expect(
      fs.readFileSync(path.join(root, "to", "nested", "a.js"), "utf8"),
    ).toBe("x");
    expect(fs.existsSync(path.join(root, "from"))).toBe(false);
  });

  it("does not retry a real error", async () => {
    const root = tempDir();
    await expect(
      moveWithRetry(path.join(root, "missing"), path.join(root, "to"), [1]),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
