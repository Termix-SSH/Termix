/**
 * The local file helpers behind ctx.desktop.local.fs. Ported from the old
 * Electron local-files tests: path containment, link refusal, publish and
 * replace semantics, and the exclusive rename.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertWithinRoot,
  createEmptyFile,
  defaultPublishFs,
  ensureDirectory,
  existingPaths,
  listDirectory,
  makeDirectory,
  openDownload,
  prepareDownloadPath,
  publishDownload,
  renameEntry,
  renameLocalPath,
  walkPaths,
  type PublishFs,
} from "../../plugins/desktop-local/local-fs.js";

let root: string;
beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), "termix-desktop-local-"));
});
afterEach(() => fsp.rm(root, { recursive: true, force: true }));

function windowsLikeFs(
  overrides: Partial<PublishFs> = {},
): PublishFs & { renames: Array<[string, string]> } {
  const renames: Array<[string, string]> = [];
  return {
    ...defaultPublishFs,
    renames,
    rename: async (from, to) => {
      renames.push([from, to]);
      if (fs.existsSync(to)) {
        throw Object.assign(new Error("EEXIST: file already exists, rename"), {
          code: "EEXIST",
        });
      }
      await defaultPublishFs.rename(from, to);
    },
    ...overrides,
  };
}

describe("download destination containment", () => {
  const win = path.win32;
  const winRoot = "C:\\Downloads\\selected";

  it("accepts ordinary nested destinations on Windows", () => {
    expect(
      assertWithinRoot(winRoot, "C:\\Downloads\\selected\\a.txt", win),
    ).toBe("C:\\Downloads\\selected\\a.txt");
    expect(
      assertWithinRoot(
        winRoot,
        "C:\\Downloads\\selected\\docs\\2026\\report.pdf",
        win,
      ),
    ).toBe("C:\\Downloads\\selected\\docs\\2026\\report.pdf");
    expect(
      assertWithinRoot(winRoot, "c:\\downloads\\SELECTED\\b.txt", win),
    ).toBe("c:\\downloads\\SELECTED\\b.txt");
  });

  it("rejects backslash traversal that normalises out of the root on Windows", () => {
    expect(() =>
      assertWithinRoot(
        winRoot,
        "C:\\Downloads\\selected\\..\\outside.txt",
        win,
      ),
    ).toThrow(/outside the selected folder/);
    expect(() =>
      assertWithinRoot(
        winRoot,
        "C:\\Downloads\\selected\\sub\\..\\..\\..\\x.txt",
        win,
      ),
    ).toThrow(/outside the selected folder/);
    expect(() => assertWithinRoot(winRoot, winRoot, win)).toThrow(
      /outside the selected folder/,
    );
  });

  it("rejects absolute, drive-qualified and UNC destinations on Windows", () => {
    for (const dest of [
      "C:\\Windows\\evil.dll",
      "D:\\Downloads\\selected\\x.txt",
      "\\\\server\\share\\x.txt",
      "C:\\Downloads\\selected-other\\x.txt",
    ]) {
      expect(() => assertWithinRoot(winRoot, dest, win)).toThrow(
        /outside the selected folder/,
      );
    }
  });

  it("requires a root and rejects POSIX traversal too", () => {
    expect(() => assertWithinRoot("", "/tmp/x", path.posix)).toThrow(
      /download folder is required/,
    );
    expect(() =>
      assertWithinRoot("/home/max/dl", "/home/max/dl/../x", path.posix),
    ).toThrow(/outside the selected folder/);
    expect(
      assertWithinRoot("/home/max/dl", "/home/max/dl/..\\x", path.posix),
    ).toBe("/home/max/dl/..\\x");
  });

  it("refuses an escaping download before any disk write", async () => {
    const selected = path.join(root, "selected");
    await fsp.mkdir(selected);
    await expect(
      openDownload({
        rootPath: selected,
        destPath: path.join(selected, "..", "outside.txt"),
        transferId: "e1",
      }),
    ).rejects.toMatchObject({ code: "EINVAL" });
    await expect(
      ensureDirectory(path.join(selected, "..", "escaped-dir"), selected),
    ).rejects.toMatchObject({ code: "EINVAL" });
    await expect(
      openDownload({
        rootPath: "",
        destPath: path.join(selected, "ok.bin"),
        transferId: "e2",
      }),
    ).rejects.toMatchObject({ code: "EINVAL" });
    expect(await fsp.readdir(root)).toEqual(["selected"]);
    expect(await fsp.readdir(selected)).toEqual([]);
  });
});

describe("links inside a download tree", () => {
  it("rejects existing linked parents for downloads and directory creation", async () => {
    const selected = path.join(root, "selected");
    const outside = path.join(root, "outside");
    await fsp.mkdir(selected);
    await fsp.mkdir(outside);
    await fsp.symlink(outside, path.join(selected, "linked"), "junction");

    await expect(
      openDownload({
        rootPath: selected,
        destPath: path.join(selected, "linked", "file.bin"),
        transferId: "l1",
      }),
    ).rejects.toThrow(/cannot follow links/);
    await expect(
      ensureDirectory(path.join(selected, "linked", "new"), selected),
    ).rejects.toThrow(/cannot follow links/);
    expect(await fsp.readdir(outside)).toEqual([]);
  });

  it("allows an explicitly selected linked root", async () => {
    const actual = path.join(root, "actual");
    const selected = path.join(root, "selected");
    await fsp.mkdir(actual);
    await fsp.symlink(actual, selected, "junction");

    const download = await openDownload({
      rootPath: selected,
      destPath: path.join(selected, "nested", "file.bin"),
      transferId: "l2",
    });
    download.stream.write("data");
    await download.publish();
    expect(
      await fsp.readFile(path.join(actual, "nested", "file.bin"), "utf8"),
    ).toBe("data");
  });

  it("rejects a destination parent replaced by a link before publish", async () => {
    const selected = path.join(root, "selected");
    const nested = path.join(selected, "nested");
    const outside = path.join(root, "outside");
    await fsp.mkdir(nested, { recursive: true });
    await fsp.mkdir(outside);

    const download = await openDownload({
      rootPath: selected,
      destPath: path.join(nested, "file.bin"),
      transferId: "l3",
    });
    download.stream.write("data");
    await fsp.rename(nested, path.join(selected, "original"));
    await fsp.symlink(outside, nested, "junction");

    await expect(download.publish()).rejects.toThrow(/cannot follow links/);
    expect(await fsp.readdir(outside)).toEqual([]);
  });

  it("prepareDownloadPath refuses a root that is not a directory", async () => {
    const file = path.join(root, "file");
    await fsp.writeFile(file, "x");
    await expect(
      prepareDownloadPath(file, path.join(file, "child")),
    ).rejects.toBeTruthy();
  });
});

describe("downloads", () => {
  it("refuses to replace an existing file by default", async () => {
    const dest = path.join(root, "keep.bin");
    await fsp.writeFile(dest, "original");
    await expect(
      openDownload({ rootPath: root, destPath: dest, transferId: "d1" }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fsp.readFile(dest, "utf8")).toBe("original");
    expect(await fsp.readdir(root)).toEqual(["keep.bin"]);
  });

  it("replaces an existing file only when overwrite is requested", async () => {
    const dest = path.join(root, "replace.bin");
    await fsp.writeFile(dest, "original");
    const download = await openDownload({
      rootPath: root,
      destPath: dest,
      transferId: "d2",
      overwrite: true,
    });
    download.stream.write("fresh");
    await download.publish();
    expect(await fsp.readFile(dest, "utf8")).toBe("fresh");
    expect(await fsp.readdir(root)).toEqual(["replace.bin"]);
  });

  it("refuses to publish over a file that appeared while it ran", async () => {
    const dest = path.join(root, "race.bin");
    const download = await openDownload({
      rootPath: root,
      destPath: dest,
      transferId: "d3",
    });
    download.stream.write("mine");
    await fsp.writeFile(dest, "someone else wrote this");
    await expect(download.publish()).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fsp.readFile(dest, "utf8")).toBe("someone else wrote this");
    expect(await fsp.readdir(root)).toEqual(["race.bin"]);
  });

  it("uses a transfer-unique partial and rejects a concurrent download to the same destination", async () => {
    const dest = path.join(root, "same.bin");
    const first = await openDownload({
      rootPath: root,
      destPath: dest,
      transferId: "first",
    });
    await expect(
      openDownload({ rootPath: root, destPath: dest, transferId: "second" }),
    ).rejects.toMatchObject({ code: "EBUSY" });
    expect(
      (await fsp.readdir(root)).filter((n) => n.endsWith(".termix-part")),
    ).toEqual(["same.bin.first.termix-part"]);

    first.stream.write("done");
    await first.publish();
    expect(await fsp.readdir(root)).toEqual(["same.bin"]);

    // The destination is free again once the first one finished.
    const again = await openDownload({
      rootPath: root,
      destPath: path.join(root, "same2.bin"),
      transferId: "third",
    });
    await again.abort();
  });

  it("allows two downloads of different files side by side and aborts one cleanly", async () => {
    const a = await openDownload({
      rootPath: root,
      destPath: path.join(root, "a.bin"),
      transferId: "a",
    });
    const b = await openDownload({
      rootPath: root,
      destPath: path.join(root, "b.bin"),
      transferId: "b",
    });
    a.stream.write("A");
    b.stream.write("B");
    await a.abort();
    await b.publish();
    expect(await fsp.readdir(root)).toEqual(["b.bin"]);
    // Abort after publish is harmless.
    await b.abort();
    expect(await fsp.readdir(root)).toEqual(["b.bin"]);
  });
});

describe("replace primitive (Windows-safe overwrite)", () => {
  const seed = async (name: string, existing: string, fresh: Buffer) => {
    const dest = path.join(root, name);
    const partial = `${dest}.t1.termix-part`;
    await fsp.writeFile(dest, existing);
    await fsp.writeFile(partial, fresh);
    return { dest, partial };
  };

  it("replaces an existing file without renaming onto an occupied name", async () => {
    const fresh = crypto.randomBytes(4096);
    const { dest, partial } = await seed("swap.bin", "original", fresh);
    const io = windowsLikeFs();

    await publishDownload(partial, dest, true, "t1", io);

    expect((await fsp.readFile(dest)).equals(fresh)).toBe(true);
    expect(await fsp.readdir(root)).toEqual(["swap.bin"]);
    expect(io.renames.length).toBeGreaterThan(0);
    for (const [, to] of io.renames) {
      expect(to === dest || to.endsWith(".termix-replaced")).toBe(true);
    }
  });

  it("restores the original byte for byte when publishing fails", async () => {
    const fresh = crypto.randomBytes(1024);
    const { dest, partial } = await seed("restore.bin", "original", fresh);
    const denied = () =>
      Promise.reject(
        Object.assign(new Error("EACCES: permission denied"), {
          code: "EACCES",
        }),
      );
    const io = windowsLikeFs({ link: denied, copyFileExcl: denied });

    await expect(
      publishDownload(partial, dest, true, "t1", io),
    ).rejects.toMatchObject({ code: "EACCES" });

    expect(await fsp.readFile(dest, "utf8")).toBe("original");
    expect((await fsp.readdir(root)).sort()).toEqual(
      ["restore.bin", "restore.bin.t1.termix-part"].sort(),
    );
  });

  it("reports EBUSY and touches nothing when the file cannot be moved aside", async () => {
    const fresh = crypto.randomBytes(1024);
    const { dest, partial } = await seed("locked.bin", "original", fresh);
    const io = windowsLikeFs({
      rename: () =>
        Promise.reject(
          Object.assign(new Error("EPERM: operation not permitted"), {
            code: "EPERM",
          }),
        ),
    });

    await expect(
      publishDownload(partial, dest, true, "t1", io),
    ).rejects.toMatchObject({ code: "EBUSY" });

    expect(await fsp.readFile(dest, "utf8")).toBe("original");
    expect((await fsp.readFile(partial)).equals(fresh)).toBe(true);
  });

  it("refuses to replace a folder with a file", async () => {
    const dest = path.join(root, "folder");
    await fsp.mkdir(dest);
    await fsp.writeFile(path.join(dest, "inner.txt"), "keep");
    const partial = `${dest}.t1.termix-part`;
    await fsp.writeFile(partial, "new");

    await expect(
      publishDownload(partial, dest, true, "t1", windowsLikeFs()),
    ).rejects.toMatchObject({ code: "EISDIR" });
    expect(await fsp.readFile(path.join(dest, "inner.txt"), "utf8")).toBe(
      "keep",
    );
  });

  it("falls back to an exclusive publish when the file to replace is gone", async () => {
    const dest = path.join(root, "gone.bin");
    const partial = `${dest}.t1.termix-part`;
    await fsp.writeFile(partial, "new");

    await publishDownload(partial, dest, true, "t1", windowsLikeFs());
    expect(await fsp.readFile(dest, "utf8")).toBe("new");
    expect(await fsp.readdir(root)).toEqual(["gone.bin"]);
  });
});

describe("local rename", () => {
  it("preserves both files on a name collision", async () => {
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    await fsp.writeFile(a, "source");
    await fsp.writeFile(b, "destination");
    await expect(renameLocalPath(a, b)).rejects.toThrow(/already exists/);
    expect(await fsp.readFile(a, "utf8")).toBe("source");
    expect(await fsp.readFile(b, "utf8")).toBe("destination");
  });

  it("refuses to replace even an empty destination directory", async () => {
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    await fsp.mkdir(a);
    await fsp.mkdir(b);
    await expect(renameLocalPath(a, b)).rejects.toThrow(/already exists/);
    expect((await fsp.readdir(root)).sort()).toEqual(["a", "b"]);
  });

  it("renames a file and handles an unchanged name", async () => {
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    await fsp.writeFile(a, "source");
    await renameLocalPath(a, a);
    await renameLocalPath(a, b);
    expect(fs.existsSync(a)).toBe(false);
    expect(await fsp.readFile(b, "utf8")).toBe("source");
  });

  it("renameEntry only takes a plain name in the same folder", async () => {
    const a = path.join(root, "a");
    await fsp.writeFile(a, "x");
    await expect(renameEntry(a, "../escape")).rejects.toThrow(/Invalid/);
    await expect(renameEntry(a, "")).rejects.toThrow(/Invalid/);
    expect(await renameEntry(a, "c")).toBe(path.join(root, "c"));
  });
});

describe("listing and creating", () => {
  it("lists entries with type, size and hidden flag", async () => {
    await fsp.mkdir(path.join(root, "dir"));
    await fsp.writeFile(path.join(root, "f.txt"), "abc");
    await fsp.writeFile(path.join(root, ".hidden"), "");
    const listing = await listDirectory(root);
    const byName = Object.fromEntries(listing.entries.map((e) => [e.name, e]));
    expect(byName["dir"].type).toBe("directory");
    expect(byName["f.txt"]).toMatchObject({ type: "file", size: 3 });
    expect(byName[".hidden"].hidden).toBe(true);
    expect(listing.parent).toBe(path.dirname(root));
  });

  it("rejects relative paths", async () => {
    await expect(listDirectory("relative")).rejects.toThrow(/absolute/);
  });

  it("creates folders and files without replacing anything", async () => {
    expect(await makeDirectory(root, "new")).toBe(path.join(root, "new"));
    await expect(makeDirectory(root, "new")).rejects.toBeTruthy();
    expect(await createEmptyFile(root, "a.txt")).toBe(path.join(root, "a.txt"));
    await fsp.writeFile(path.join(root, "a.txt"), "keep");
    await expect(createEmptyFile(root, "a.txt")).rejects.toBeTruthy();
    expect(await fsp.readFile(path.join(root, "a.txt"), "utf8")).toBe("keep");
  });

  it("reports which paths exist", async () => {
    await fsp.writeFile(path.join(root, "yes"), "");
    expect(
      await existingPaths([path.join(root, "yes"), path.join(root, "no")]),
    ).toEqual([path.join(root, "yes")]);
  });

  it("walks dropped paths into a flat list with empty folders", async () => {
    await fsp.mkdir(path.join(root, "tree", "empty"), { recursive: true });
    await fsp.mkdir(path.join(root, "tree", "sub"));
    await fsp.writeFile(path.join(root, "tree", "sub", "a.txt"), "12345");
    await fsp.writeFile(path.join(root, "single.txt"), "xy");

    const result = await walkPaths([
      path.join(root, "tree"),
      path.join(root, "single.txt"),
    ]);
    expect(result.files.map((f) => f.relativePath).sort()).toEqual([
      "single.txt",
      "tree/sub/a.txt",
    ]);
    expect(result.emptyDirs).toEqual(["tree/empty"]);
    expect(result.totalBytes).toBe(7);
  });
});
