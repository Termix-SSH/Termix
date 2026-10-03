import { beforeEach, afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { REMOTE_WORKSPACE } from "../../../src/backend/agents/workspace.js";
let home: string, cwd: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "termix-workspace-"));
  cwd = join(home, "repo");
  mkdirSync(cwd);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));
function run(body: unknown) {
  const r = spawnSync(process.execPath, ["-e", REMOTE_WORKSPACE], {
    env: { ...process.env, HOME: home },
    input: JSON.stringify({ cwd, id: "test", body }),
    encoding: "utf8",
  });
  if (r.status) throw Error(r.stderr);
  return JSON.parse(r.stdout);
}
function git(...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}
it("uploads an image without trusting the caller's MIME type and preserves exact bytes", () => {
  const data = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]);
  const a = run({
    operation: "upload",
    name: "image.png",
    data: data.toString("base64"),
  });
  expect(a.mime).toBe("image/png");
  expect(readFileSync(a.path)).toEqual(data);
  expect(
    a.path.startsWith(
      join(home, ".local/state/termix-agents/test/attachments"),
    ),
  ).toBe(true);
});
it("rejects oversized files, directories and references outside the workspace", () => {
  writeFileSync(join(home, "outside"), "secret");
  symlinkSync(join(home, "outside"), join(cwd, "escape"));
  writeFileSync(join(cwd, "large"), Buffer.alloc(1024 * 1024 + 1));
  for (const path of ["../outside", "escape", "large", "."])
    expect(() => run({ operation: "reference", path })).toThrow();
});
it("shows staged, unstaged and untracked changes and creates an isolated branch", () => {
  git("init");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  mkdirSync(join(cwd, "nested"));
  writeFileSync(join(cwd, "nested", "deleted.txt"), "nested base\n");
  writeFileSync(join(cwd, "file.txt"), "base\n");
  git("add", ".");
  git("commit", "-m", "initial");
  writeFileSync(join(cwd, "file.txt"), "staged\n");
  git("add", ".");
  writeFileSync(join(cwd, "file.txt"), "working\n");
  writeFileSync(join(cwd, "new.txt"), "untracked");
  expect(run({ operation: "status" }).files).toContainEqual({
    status: "??",
    path: "new.txt",
  });
  const diff = run({ operation: "diff", path: "file.txt" }).diff;
  expect(diff).toContain("+working");
  expect(diff).toContain("+staged");
  expect(run({ operation: "diff", path: "new.txt" }).diff).toContain(
    "+untracked",
  );
  const wt = run({ operation: "worktree", branch: "termix/test" });
  expect(readFileSync(join(wt.path, "file.txt"), "utf8")).toBe("base\n");
  expect(readFileSync(join(cwd, "file.txt"), "utf8")).toBe("working\n");
  expect(() => run({ operation: "worktree", branch: "termix/test" })).toThrow();
  rmSync(join(cwd, "nested"), { recursive: true });
  expect(run({ operation: "diff", path: "nested/deleted.txt" }).diff).toContain(
    "-nested base",
  );
  rmSync(join(cwd, "file.txt"));
  expect(run({ operation: "diff", path: "file.txt" }).diff).toContain(
    "-staged",
  );
});
