import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SFTPWrapper } from "ssh2";
import { afterEach, describe, expect, it } from "vitest";
import {
  isSafeTrashSource,
  listTrash,
  moveToTrash,
  permanentlyDeleteTrashItem,
  restoreTrashItem,
} from "../../../hosts/file-manager/trash-service.js";

const temporaryDirectories: string[] = [];

// Windows only allows symlink creation with elevation or Developer Mode, so the
// symlink safety test is skipped where the OS refuses to create one at all.
const canCreateSymlinks = (() => {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "termix-symlink-probe-"));
  try {
    fs.mkdirSync(path.join(probe, "target"));
    fs.symlinkSync(path.join(probe, "target"), path.join(probe, "link"), "dir");
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
})();

function localSftp(home: string): SFTPWrapper {
  const callback = <T>(
    promise: Promise<T>,
    done: (error: Error | undefined, value?: T) => void,
  ) =>
    promise
      .then((value) => done(undefined, value))
      .catch((error) => done(error));
  return {
    realpath(
      _target: string,
      done: (error: Error | undefined, value?: string) => void,
    ) {
      done(undefined, home);
    },
    stat(
      target: string,
      done: (error: Error | undefined, value?: fs.Stats) => void,
    ) {
      callback(fs.promises.stat(target), done);
    },
    lstat(
      target: string,
      done: (error: Error | undefined, value?: fs.Stats) => void,
    ) {
      callback(fs.promises.lstat(target), done);
    },
    readdir(
      target: string,
      done: (error: Error | undefined, value?: unknown[]) => void,
    ) {
      callback(
        fs.promises.readdir(target, { withFileTypes: true }).then((entries) =>
          entries.map((entry) => ({
            filename: entry.name,
            longname: entry.name,
            attrs: {},
          })),
        ),
        done,
      );
    },
    readFile(
      target: string,
      done: (error: Error | undefined, value?: Buffer) => void,
    ) {
      callback(fs.promises.readFile(target), done);
    },
    writeFile(target: string, data: string, done: (error?: Error) => void) {
      fs.promises
        .writeFile(target, data)
        .then(() => done())
        .catch(done);
    },
    rename(from: string, to: string, done: (error?: Error) => void) {
      fs.promises
        .rename(from, to)
        .then(() => done())
        .catch(done);
    },
    unlink(target: string, done: (error?: Error) => void) {
      fs.promises
        .unlink(target)
        .then(() => done())
        .catch(done);
    },
    mkdir(target: string, done: (error?: Error) => void) {
      fs.promises
        .mkdir(target)
        .then(() => done())
        .catch(done);
    },
    rmdir(target: string, done: (error?: Error) => void) {
      fs.promises
        .rmdir(target)
        .then(() => done())
        .catch(done);
    },
  } as unknown as SFTPWrapper;
}

async function fixture() {
  const home = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "termix-trash-"),
  );
  temporaryDirectories.push(home);
  return { home, sftp: localSftp(home) };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        fs.promises.rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe("file manager trash safety", () => {
  it("rejects roots and paths inside the trash", () => {
    expect(isSafeTrashSource("/", "/home/user/.termix-trash")).toBe(false);
    expect(isSafeTrashSource("C:/", "C:/Users/user/.termix-trash")).toBe(false);
    expect(
      isSafeTrashSource(
        "/home/user/.termix-trash/files/a",
        "/home/user/.termix-trash",
      ),
    ).toBe(false);
  });

  it("accepts ordinary files and directories", () => {
    expect(
      isSafeTrashSource("/home/user/report.txt", "/home/user/.termix-trash"),
    ).toBe(true);
  });

  it("moves, lists, and restores a file without changing its contents", async () => {
    const { home, sftp } = await fixture();
    const original = path.join(home, "report.txt");
    await fs.promises.writeFile(original, "important");

    const trashed = await moveToTrash(sftp, original);
    expect(fs.existsSync(original)).toBe(false);
    expect(await listTrash(sftp, 7)).toEqual([trashed]);

    await restoreTrashItem(sftp, trashed.id);
    expect(await fs.promises.readFile(original, "utf8")).toBe("important");
    expect(await listTrash(sftp, 7)).toEqual([]);
  });

  it("permanently deletes only the stored trash path", async () => {
    const { home, sftp } = await fixture();
    const original = path.join(home, "folder");
    await fs.promises.mkdir(original);
    await fs.promises.writeFile(path.join(original, "nested.txt"), "data");
    const trashed = await moveToTrash(sftp, original);

    await permanentlyDeleteTrashItem(sftp, trashed.id);
    expect(await listTrash(sftp, 7)).toEqual([]);
  });

  it.skipIf(!canCreateSymlinks)(
    "does not follow directory symlinks during permanent deletion",
    async () => {
      const { home, sftp } = await fixture();
      const target = path.join(home, "target");
      const link = path.join(home, "link");
      await fs.promises.mkdir(target);
      await fs.promises.writeFile(path.join(target, "keep.txt"), "keep");
      await fs.promises.symlink(target, link, "dir");

      const trashed = await moveToTrash(sftp, link);
      await permanentlyDeleteTrashItem(sftp, trashed.id);

      expect(
        await fs.promises.readFile(path.join(target, "keep.txt"), "utf8"),
      ).toBe("keep");
    },
  );

  it("refuses tampered metadata instead of deleting an arbitrary path", async () => {
    const { home, sftp } = await fixture();
    const original = path.join(home, "discard.txt");
    const protectedFile = path.join(home, "keep.txt");
    await fs.promises.writeFile(original, "discard");
    await fs.promises.writeFile(protectedFile, "keep");
    const trashed = await moveToTrash(sftp, original);
    const metadata = path.join(
      home,
      ".termix-trash",
      "info",
      `${trashed.id}.json`,
    );
    const data = JSON.parse(await fs.promises.readFile(metadata, "utf8"));
    data.trashPath = protectedFile;
    await fs.promises.writeFile(metadata, JSON.stringify(data));

    await expect(permanentlyDeleteTrashItem(sftp, trashed.id)).rejects.toThrow(
      "Invalid trash metadata",
    );
    expect(await fs.promises.readFile(protectedFile, "utf8")).toBe("keep");
  });

  it("prunes items after the configured retention period", async () => {
    const { home, sftp } = await fixture();
    const original = path.join(home, "old.txt");
    await fs.promises.writeFile(original, "old");
    const trashed = await moveToTrash(sftp, original);
    const metadata = path.join(
      home,
      ".termix-trash",
      "info",
      `${trashed.id}.json`,
    );
    const data = JSON.parse(await fs.promises.readFile(metadata, "utf8"));
    data.deletedAt = "2020-01-01T00:00:00.000Z";
    await fs.promises.writeFile(metadata, JSON.stringify(data));

    expect(await listTrash(sftp, 7)).toEqual([]);
    expect(
      fs.existsSync(path.join(home, ".termix-trash", "files", trashed.id)),
    ).toBe(false);
  });
});
