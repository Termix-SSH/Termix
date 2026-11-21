import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  adoptDataDir,
  readAdopted,
  writeAdopted,
  type AdoptFs,
} from "../../../../plugins/sandbox/launcher/adopt.js";

interface Entry {
  kind: "dir" | "file" | "link";
  uid: number;
  gid: number;
  mode: number;
  nlink?: number;
}

/** A small in-memory tree, so ownership can be checked without root. */
function fakeFs(tree: Record<string, Entry>) {
  const chown = vi.fn();
  const chmod = vi.fn();
  const io: AdoptFs = {
    readdirSync: ((dir: string) =>
      Object.keys(tree)
        .filter((p) => path.dirname(p) === dir)
        .map((p) => path.basename(p))) as unknown as AdoptFs["readdirSync"],
    lstatSync: ((p: string) => {
      const e = tree[p];
      return {
        uid: e.uid,
        gid: e.gid,
        mode: e.mode,
        nlink: e.nlink ?? 1,
        isSymbolicLink: () => e.kind === "link",
        isDirectory: () => e.kind === "dir",
        isFile: () => e.kind === "file",
      };
    }) as unknown as AdoptFs["lstatSync"],
    lchownSync: chown as unknown as AdoptFs["lchownSync"],
    chmodSync: chmod as unknown as AdoptFs["chmodSync"],
  };
  return { io, chown, chmod };
}

const root = path.join(path.sep, "data", "plugin-data", "rec");
const at = (...parts: string[]) => path.join(root, ...parts);

describe("adoptDataDir", () => {
  it("gives the plugin's user what core left in its folder", () => {
    const { io, chown, chmod } = fakeFs({
      [at("session_logs")]: { kind: "dir", uid: 1000, gid: 1000, mode: 0o700 },
      [at("session_logs", "u1")]: {
        kind: "dir",
        uid: 1000,
        gid: 1000,
        mode: 0o700,
      },
      [at("session_logs", "u1", "a.cast")]: {
        kind: "file",
        uid: 1000,
        gid: 1000,
        mode: 0o600,
      },
    });
    expect(adoptDataDir(root, 2001, 1000, io)).toBe(3);
    expect(chown).toHaveBeenCalledWith(at("session_logs"), 2001, 1000);
    expect(chown).toHaveBeenCalledWith(
      at("session_logs", "u1", "a.cast"),
      2001,
      1000,
    );
    expect(chmod).toHaveBeenCalledWith(at("session_logs"), 0o2770);
    expect(chmod).toHaveBeenCalledWith(
      at("session_logs", "u1", "a.cast"),
      0o660,
    );
  });

  it("never follows a symlink or touches a file with other hard links", () => {
    const { io, chown, chmod } = fakeFs({
      [at("escape")]: { kind: "link", uid: 2001, gid: 2001, mode: 0o777 },
      [at("linked")]: {
        kind: "file",
        uid: 0,
        gid: 0,
        mode: 0o600,
        nlink: 2,
      },
    });
    expect(adoptDataDir(root, 2001, 1000, io)).toBe(0);
    expect(chown).not.toHaveBeenCalled();
    expect(chmod).not.toHaveBeenCalled();
  });

  it("leaves what the plugin already owns alone", () => {
    const { io, chown, chmod } = fakeFs({
      [at("mine.json")]: { kind: "file", uid: 2001, gid: 1000, mode: 0o660 },
    });
    expect(adoptDataDir(root, 2001, 1000, io)).toBe(0);
    expect(chown).not.toHaveBeenCalled();
    expect(chmod).not.toHaveBeenCalled();
  });
});

describe("adopted record", () => {
  it("reads back what was written and survives a missing or bad file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adopted-"));
    const file = path.join(dir, "owners.json");
    expect(readAdopted(file)).toEqual({});
    writeAdopted(file, { rec: 2001 });
    expect(readAdopted(file)).toEqual({ rec: 2001 });
    fs.writeFileSync(file, "not json");
    expect(readAdopted(file)).toEqual({});
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
