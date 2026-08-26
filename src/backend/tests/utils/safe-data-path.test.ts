import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveWithinDir } from "../../utils/safe-data-path.js";

/**
 * The database restore endpoint takes its read and write paths from the request
 * body. It is admin-only, but an admin session is exactly what an attacker who
 * lands one wants to turn into arbitrary file access, so the paths are confined
 * to DATA_DIR. These are the escapes that confinement has to refuse.
 */
describe("resolveWithinDir", () => {
  const base = "/app/data";

  it("accepts a plain relative path inside the base", () => {
    expect(resolveWithinDir(base, "backups/db.sqlite.encrypted")).toBe(
      path.resolve("/app/data/backups/db.sqlite.encrypted"),
    );
  });

  it("accepts the base directory itself", () => {
    expect(resolveWithinDir(base, ".")).toBe(path.resolve(base));
  });

  it("refuses a traversal escape", () => {
    expect(resolveWithinDir(base, "../etc/shadow")).toBeNull();
    expect(resolveWithinDir(base, "backups/../../etc/passwd")).toBeNull();
  });

  it("refuses an absolute path outside the base", () => {
    expect(resolveWithinDir(base, "/etc/shadow")).toBeNull();
    expect(resolveWithinDir(base, "/app/data-evil/db")).toBeNull();
  });

  it("does not treat a sibling with a shared prefix as inside", () => {
    // /app/dataX must not pass as being under /app/data.
    expect(resolveWithinDir("/app/data", "/app/dataX/db")).toBeNull();
  });

  it("refuses empty, non-string and null-byte input", () => {
    expect(resolveWithinDir(base, "")).toBeNull();
    expect(resolveWithinDir(base, undefined)).toBeNull();
    expect(resolveWithinDir(base, null)).toBeNull();
    expect(resolveWithinDir(base, 42)).toBeNull();
    expect(resolveWithinDir(base, "backups/db\0.encrypted")).toBeNull();
  });
});
