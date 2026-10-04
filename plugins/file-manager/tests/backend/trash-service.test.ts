import { describe, expect, it, vi } from "vitest";
import type { SFTPWrapper } from "ssh2";
import { listTrash, moveToTrash } from "../../src/backend/trash-service.js";

/** An in-memory SFTP channel that counts every request. */
function fakeSftp() {
  const dirs = new Set(["/", "/home", "/home/me"]);
  const files = new Map<string, Buffer>([["/home/me/a.txt", Buffer.from("a")]]);
  const calls: string[] = [];
  const stats = (target: string) =>
    dirs.has(target) || files.has(target)
      ? {
          isDirectory: () => dirs.has(target),
          size: files.get(target)?.length ?? 0,
        }
      : null;
  const sftp = {
    realpath: vi.fn((_p: string, done: (e?: Error, v?: string) => void) => {
      calls.push("realpath");
      done(undefined, "/home/me");
    }),
    stat: vi.fn((target: string, done: (e?: Error, v?: unknown) => void) => {
      calls.push("stat");
      const found = stats(target);
      done(found ? undefined : new Error("ENOENT"), found ?? undefined);
    }),
    lstat: vi.fn((target: string, done: (e?: Error, v?: unknown) => void) => {
      calls.push("lstat");
      const found = stats(target);
      done(found ? undefined : new Error("ENOENT"), found ?? undefined);
    }),
    mkdir: vi.fn((target: string, done: (e?: Error) => void) => {
      calls.push("mkdir");
      dirs.add(target);
      done();
    }),
    rename: vi.fn((from: string, to: string, done: (e?: Error) => void) => {
      calls.push("rename");
      files.set(to, files.get(from)!);
      files.delete(from);
      done();
    }),
    writeFile: vi.fn(
      (target: string, data: string, done: (e?: Error) => void) => {
        calls.push("writeFile");
        files.set(target, Buffer.from(data));
        done();
      },
    ),
    readdir: vi.fn((target: string, done: (e?: Error, v?: unknown) => void) => {
      calls.push("readdir");
      const prefix = `${target}/`;
      done(
        undefined,
        [...files.keys()]
          .filter((name) => name.startsWith(prefix))
          .map((name) => ({ filename: name.slice(prefix.length) })),
      );
    }),
    readFile: vi.fn((target: string, done: (e?: Error, v?: Buffer) => void) => {
      calls.push("readFile");
      done(undefined, files.get(target));
    }),
    unlink: vi.fn((target: string, done: (e?: Error) => void) => {
      calls.push("unlink");
      files.delete(target);
      done();
    }),
  };
  return { sftp: sftp as unknown as SFTPWrapper, calls, files };
}

describe("trash", () => {
  it("finds the trash folders once per channel", async () => {
    const { sftp, calls, files } = fakeSftp();
    files.set("/home/me/b.txt", Buffer.from("b"));

    await moveToTrash(sftp, "/home/me/a.txt");
    const first = calls.length;
    calls.length = 0;
    await moveToTrash(sftp, "/home/me/b.txt");

    expect(calls.filter((call) => call === "realpath")).toHaveLength(0);
    expect(calls.filter((call) => call === "mkdir")).toHaveLength(0);
    // lstat, rename and the metadata write.
    expect(calls.length).toBeLessThan(first);
    expect(calls).toEqual(["lstat", "rename", "writeFile"]);
  });

  it("lists what was moved", async () => {
    const { sftp } = fakeSftp();
    const item = await moveToTrash(sftp, "/home/me/a.txt");
    expect(await listTrash(sftp, 7)).toEqual([item]);
  });
});
