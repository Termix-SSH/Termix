import { describe, expect, it } from "vitest";
import {
  STREAM_INDEX_MIMETYPE,
  basename,
  isDirectoryMimetype,
  joinPath,
  parentPath,
  parseDirectoryIndex,
} from "../../../features/guacamole/guacamole-filesystem.js";

describe("path helpers", () => {
  it("joins onto the root without doubling the separator", () => {
    expect(joinPath("/", "Users")).toBe("/Users");
    expect(joinPath("/Users", "kei")).toBe("/Users/kei");
  });

  it("stops walking up at the root", () => {
    expect(parentPath("/Users/kei")).toBe("/Users");
    expect(parentPath("/Users")).toBe("/");
    expect(parentPath("/")).toBe("/");
  });

  it("reads the trailing segment as the name", () => {
    expect(basename("/Users/kei/notes.txt")).toBe("notes.txt");
    expect(basename("notes.txt")).toBe("notes.txt");
  });
});

describe("isDirectoryMimetype", () => {
  it("treats only the stream index mimetype as a directory", () => {
    expect(isDirectoryMimetype(STREAM_INDEX_MIMETYPE)).toBe(true);
    expect(isDirectoryMimetype("text/plain")).toBe(false);
  });
});

describe("parseDirectoryIndex", () => {
  it("sorts directories before files and alphabetises within each group", () => {
    const json = JSON.stringify({
      "/report.pdf": "application/pdf",
      "/apps": STREAM_INDEX_MIMETYPE,
      "/notes.txt": "text/plain",
      "/Documents": STREAM_INDEX_MIMETYPE,
    });

    expect(parseDirectoryIndex(json, "/").map((e) => e.name)).toEqual([
      "apps",
      "Documents",
      "notes.txt",
      "report.pdf",
    ]);
  });

  it("marks entries carrying the stream index mimetype as directories", () => {
    const json = JSON.stringify({
      "/apps": STREAM_INDEX_MIMETYPE,
      "/notes.txt": "text/plain",
    });
    const [dir, file] = parseDirectoryIndex(json, "/");

    expect(dir).toEqual({
      name: "apps",
      path: "/apps",
      mimetype: STREAM_INDEX_MIMETYPE,
      isDirectory: true,
    });
    expect(file.isDirectory).toBe(false);
  });

  it("keeps absolute keys as-is when listing a nested directory", () => {
    const json = JSON.stringify({ "/Users/kei/notes.txt": "text/plain" });

    expect(parseDirectoryIndex(json, "/Users/kei")[0].path).toBe(
      "/Users/kei/notes.txt",
    );
  });

  it("resolves a relative key against the directory being listed", () => {
    const json = JSON.stringify({ "notes.txt": "text/plain" });

    expect(parseDirectoryIndex(json, "/Users/kei")[0].path).toBe(
      "/Users/kei/notes.txt",
    );
  });

  it("returns nothing for an empty directory", () => {
    expect(parseDirectoryIndex("{}", "/")).toEqual([]);
  });
});
