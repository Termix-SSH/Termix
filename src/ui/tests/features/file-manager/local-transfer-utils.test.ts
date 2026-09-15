import { describe, expect, it } from "vitest";
import {
  LOCAL_FILES_DRAG_MIME,
  REMOTE_FILES_DRAG_MIME,
  describeLocalKind,
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
