import { beforeEach, describe, expect, it } from "vitest";
import {
  LOCAL_FILES_DRAG_MIME,
  REMOTE_FILES_DRAG_MIME,
  UnsafeLocalNameError,
  assertSafeLocalComponent,
  beginRemoteFilesDrag,
  buildLocalDestination,
  clampTransferConcurrency,
  describeLocalKind,
  getTransferConcurrency,
  runWithConcurrency,
  setTransferConcurrency,
  DEFAULT_TRANSFER_CONCURRENCY,
  TRANSFER_CONCURRENCY_STORAGE_KEY,
  formatLocalModified,
  isLocalFilesDrag,
  isRemoteFilesDrag,
  joinLocalPath,
  joinRemotePath,
  parseInternalFilesDragPayload,
  parseLocalFilesDragPayload,
  planRemoteDirectories,
  remoteBaseName,
  remoteDirForRelativePath,
  serializeLocalFilesDragPayload,
  sortLocalEntries,
} from "@/features/file-manager/local-transfer-utils";
import type { LocalFileEntry } from "@/types/electron";

describe("drag payloads", () => {
  it("round-trips local file payloads", () => {
    const raw = serializeLocalFilesDragPayload(["/Users/max/a.txt", "/tmp/b"]);
    expect(parseLocalFilesDragPayload(raw)).toEqual([
      "/Users/max/a.txt",
      "/tmp/b",
    ]);
  });

  it("rejects foreign or malformed payloads", () => {
    expect(parseLocalFilesDragPayload(null)).toBeNull();
    expect(parseLocalFilesDragPayload("not json")).toBeNull();
    expect(
      parseLocalFilesDragPayload(
        JSON.stringify({ type: "internal_files", files: ["/x"] }),
      ),
    ).toBeNull();
    expect(
      parseLocalFilesDragPayload(
        JSON.stringify({ type: "local_files", paths: [] }),
      ),
    ).toBeNull();
    expect(
      parseLocalFilesDragPayload(
        JSON.stringify({ type: "local_files", paths: [1, "", "/ok"] }),
      ),
    ).toEqual(["/ok"]);
  });

  it("parses the remote grid's internal payload", () => {
    expect(
      parseInternalFilesDragPayload(
        JSON.stringify({ type: "internal_files", files: ["/srv/a", "/srv/b"] }),
      ),
    ).toEqual(["/srv/a", "/srv/b"]);
    expect(
      parseInternalFilesDragPayload(
        JSON.stringify({ type: "local_files", paths: ["/x"] }),
      ),
    ).toBeNull();
  });

  it("recognises drag origins from dataTransfer types", () => {
    expect(
      isLocalFilesDrag({ types: [LOCAL_FILES_DRAG_MIME, "text/plain"] }),
    ).toBe(true);
    expect(isLocalFilesDrag({ types: ["Files"] })).toBe(false);
    expect(isRemoteFilesDrag({ types: [REMOTE_FILES_DRAG_MIME] })).toBe(true);
    expect(isRemoteFilesDrag({ types: ["text/plain"] })).toBe(false);
    expect(isRemoteFilesDrag(null)).toBe(false);
  });
});

describe("path helpers", () => {
  it("joins remote paths without duplicate slashes", () => {
    expect(joinRemotePath("/", "a", "b")).toBe("/a/b");
    expect(joinRemotePath("/home/ubuntu/", "/proj/", "x.txt")).toBe(
      "/home/ubuntu/proj/x.txt",
    );
    expect(joinRemotePath("/home", "")).toBe("/home");
  });

  it("joins local paths with the platform separator", () => {
    expect(joinLocalPath("/Users/max", "a.txt", "/")).toBe("/Users/max/a.txt");
    expect(joinLocalPath("/Users/max/", "a.txt", "/")).toBe("/Users/max/a.txt");
    expect(joinLocalPath("/", "a.txt", "/")).toBe("/a.txt");
    expect(joinLocalPath("C:\\Users\\max", "a.txt", "\\")).toBe(
      "C:\\Users\\max\\a.txt",
    );
  });

  it("derives base names", () => {
    expect(remoteBaseName("/srv/app/file.log")).toBe("file.log");
    expect(remoteBaseName("/srv/app/")).toBe("app");
    expect(remoteBaseName("/")).toBe("/");
  });

  it("maps relative paths to their remote directory", () => {
    expect(remoteDirForRelativePath("/dst", "file.txt")).toBe("/dst");
    expect(remoteDirForRelativePath("/dst", "proj/src/main.rs")).toBe(
      "/dst/proj/src",
    );
  });
});

describe("download destination safety", () => {
  const WIN = "\\";
  const POSIX = "/";

  it("keeps ordinary nested folders under the selected directory (Windows)", () => {
    expect(
      buildLocalDestination(
        "C:\\Downloads\\selected",
        "docs/2026/report.pdf",
        WIN,
      ),
    ).toBe("C:\\Downloads\\selected\\docs\\2026\\report.pdf");
    expect(
      buildLocalDestination("C:\\Downloads\\selected\\", "a.txt", WIN),
    ).toBe("C:\\Downloads\\selected\\a.txt");
  });

  it("rejects backslash traversal in a POSIX file name on Windows", () => {
    // The reviewer's reproduction: "..\\outside.txt" is a legal POSIX name.
    expect(() =>
      buildLocalDestination("C:\\Downloads\\selected", "..\\outside.txt", WIN),
    ).toThrow(UnsafeLocalNameError);
    expect(() =>
      buildLocalDestination(
        "C:\\Downloads\\selected",
        "sub/..\\..\\x.txt",
        WIN,
      ),
    ).toThrow(UnsafeLocalNameError);
    expect(() =>
      buildLocalDestination("C:\\Downloads\\selected", "dir\\file.txt", WIN),
    ).toThrow(UnsafeLocalNameError);
  });

  it("rejects absolute and drive-qualified names on Windows", () => {
    for (const name of [
      "C:\\Windows\\evil.dll",
      "C:evil.txt",
      "D:",
      "\\\\server\\share\\x",
      "\\absolute.txt",
    ]) {
      expect(() =>
        buildLocalDestination("C:\\Downloads\\selected", name, WIN),
      ).toThrow(UnsafeLocalNameError);
    }
  });

  it("rejects names Windows cannot store: reserved devices, trailing dots/spaces, control chars", () => {
    for (const name of [
      "CON",
      "nul.txt",
      "COM1",
      "report.",
      "report ",
      "a\u0007b",
      "q?.txt",
      "a|b",
    ]) {
      expect(() => assertSafeLocalComponent(name, WIN)).toThrow(
        UnsafeLocalNameError,
      );
    }
    expect(assertSafeLocalComponent("console.log", WIN)).toBe("console.log");
    expect(assertSafeLocalComponent("nulled.txt", WIN)).toBe("nulled.txt");
  });

  it("rejects traversal and separators on every platform, but allows POSIX-legal backslashes on POSIX", () => {
    for (const rel of ["..", "../x", "a/../../x", "./x", "a\0b", ""]) {
      expect(() => buildLocalDestination("/home/max/dl", rel, POSIX)).toThrow(
        UnsafeLocalNameError,
      );
    }
    // On macOS/Linux a backslash is just a character in a file name and the
    // result is still inside the selected folder.
    expect(
      buildLocalDestination("/home/max/dl", "..\\outside.txt", POSIX),
    ).toBe("/home/max/dl/..\\outside.txt");
    expect(buildLocalDestination("/", "etc/hosts", POSIX)).toBe("/etc/hosts");
  });
});

describe("planRemoteDirectories", () => {
  it("lists every ancestor once, shallowest first", () => {
    const dirs = planRemoteDirectories(
      ["proj/src/main.rs", "proj/README.md", "proj/src/lib/mod.rs", "top.txt"],
      ["proj/empty", "other/nested/leaf"],
    );
    expect(dirs).toEqual([
      "other",
      "proj",
      "other/nested",
      "proj/empty",
      "proj/src",
      "other/nested/leaf",
      "proj/src/lib",
    ]);
  });

  it("returns nothing for flat file drops", () => {
    expect(planRemoteDirectories(["a.txt", "b.txt"])).toEqual([]);
  });
});

describe("remote rows dragged out of the grid", () => {
  it("allows both a move (within the grid) and a copy (download onto the local pane)", () => {
    const store: Record<string, string> = {};
    const dataTransfer: Pick<DataTransfer, "effectAllowed" | "setData"> = {
      effectAllowed: "uninitialized",
      setData: (type: string, value: string) => {
        store[type] = value;
      },
    };
    beginRemoteFilesDrag(dataTransfer, ["/srv/a.txt", "/srv/dir"]);
    // Chromium silently drops nothing when dropEffect ("copy" on the local
    // pane) is not part of effectAllowed, so "move" alone breaks downloads.
    expect(dataTransfer.effectAllowed).toBe("copyMove");
    expect(isRemoteFilesDrag({ types: Object.keys(store) })).toBe(true);
    expect(parseInternalFilesDragPayload(store["text/plain"])).toEqual([
      "/srv/a.txt",
      "/srv/dir",
    ]);
  });
});

describe("local entry presentation", () => {
  const entry = (
    name: string,
    type: LocalFileEntry["type"],
    size = 0,
    modifiedTimestamp = 0,
  ): LocalFileEntry => ({
    name,
    path: `/x/${name}`,
    type,
    size,
    modifiedTimestamp,
    hidden: name.startsWith("."),
  });

  it("formats modified times like the remote grid (ls -l style)", () => {
    const now = new Date(2026, 8, 12, 10, 0); // Sep 12 2026
    expect(
      formatLocalModified(new Date(2026, 8, 11, 16, 25).getTime(), now),
    ).toBe("Sep 11 16:25");
    // Single-digit days are space-padded, minutes zero-padded.
    expect(formatLocalModified(new Date(2026, 7, 7, 9, 5).getTime(), now)).toBe(
      "Aug  7 09:05",
    );
    // Older than six months: year instead of time, two spaces like ls.
    expect(
      formatLocalModified(new Date(2025, 11, 24, 18, 30).getTime(), now),
    ).toBe("Dec 24  2025");
    expect(formatLocalModified(undefined, now)).toBe("--");
    expect(formatLocalModified(Number.NaN, now)).toBe("--");
  });

  it("describes kinds", () => {
    expect(describeLocalKind(entry("docs", "directory"))).toBe("folder");
    expect(describeLocalKind(entry("archive.tar.GZ", "file"))).toBe("gz");
    expect(describeLocalKind(entry(".env", "file"))).toBe("file");
    expect(describeLocalKind(entry("Makefile", "file"))).toBe("file");
    expect(describeLocalKind(entry("ln", "link"))).toBe("link");
  });

  it("sorts folders first, then by the chosen field", () => {
    const entries = [
      entry("b.txt", "file", 20, 2),
      entry("zeta", "directory", 0, 1),
      entry("a.txt", "file", 10, 3),
      entry("alpha", "directory", 0, 4),
    ];
    expect(sortLocalEntries(entries, "name", "asc").map((e) => e.name)).toEqual(
      ["alpha", "zeta", "a.txt", "b.txt"],
    );
    expect(
      sortLocalEntries(entries, "size", "desc").map((e) => e.name),
    ).toEqual(["zeta", "alpha", "b.txt", "a.txt"]);
    expect(
      sortLocalEntries(entries, "modified", "asc").map((e) => e.name),
    ).toEqual(["zeta", "alpha", "b.txt", "a.txt"]);
  });
});

describe("parallel transfers", () => {
  beforeEach(() => localStorage.clear());

  it("clamps and persists the concurrency preference", () => {
    expect(getTransferConcurrency()).toBe(DEFAULT_TRANSFER_CONCURRENCY);
    expect(clampTransferConcurrency(0)).toBe(1);
    expect(clampTransferConcurrency(99)).toBe(8);
    expect(clampTransferConcurrency("3.7")).toBe(3);
    expect(clampTransferConcurrency("nope")).toBe(DEFAULT_TRANSFER_CONCURRENCY);
    expect(setTransferConcurrency(6)).toBe(6);
    expect(localStorage.getItem(TRANSFER_CONCURRENCY_STORAGE_KEY)).toBe("6");
    expect(getTransferConcurrency()).toBe(6);
  });

  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("never runs more than `limit` workers at once and processes everything", async () => {
    const gates = Array.from({ length: 6 }, deferred);
    const started: number[] = [];
    let active = 0;
    let peak = 0;
    const run = runWithConcurrency([0, 1, 2, 3, 4, 5], 3, async (i) => {
      started.push(i);
      active += 1;
      peak = Math.max(peak, active);
      await gates[i].promise;
      active -= 1;
    });
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]); // exactly `limit` dispatched
    gates[1].resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual([0, 1, 2, 3]); // a free lane picks up the next item
    for (const g of gates) g.resolve();
    await run;
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(3);
  });

  it("stops dispatching once asked to, letting in-flight items finish", async () => {
    let stop = false;
    const done: number[] = [];
    await runWithConcurrency(
      [1, 2, 3, 4, 5],
      2,
      async (i) => {
        await new Promise((r) => setTimeout(r, 1));
        done.push(i);
        if (i === 2) stop = true;
      },
      () => stop,
    );
    expect(done.length).toBeLessThan(5);
    expect(done).toContain(1);
    expect(done).toContain(2);
  });

  it("does not reject the batch when a single item fails (the worker reports it)", async () => {
    const failed: number[] = [];
    await runWithConcurrency([1, 2, 3], 2, async (i) => {
      try {
        if (i === 2) throw new Error("boom");
      } catch {
        failed.push(i);
      }
    });
    expect(failed).toEqual([2]);
  });

  it("handles an empty list and a limit larger than the list", async () => {
    let calls = 0;
    await runWithConcurrency([], 4, async () => {
      calls += 1;
    });
    await runWithConcurrency([1], 8, async () => {
      calls += 1;
    });
    expect(calls).toBe(1);
  });
});
