import { describe, expect, it } from "vitest";
import type { FileItem } from "@/types/index";
import {
  addOptimisticItem,
  childPath,
  removePaths,
  renameOptimisticItem,
  restoreItems,
} from "../../../features/file-manager/optimistic-file-list";

const files: FileItem[] = [
  { name: "alpha.txt", path: "/work/alpha.txt", type: "file", size: 10 },
  { name: "docs", path: "/work/docs", type: "directory" },
];

describe("optimistic file list updates", () => {
  it("builds child paths without duplicate separators", () => {
    expect(childPath("/", "file.txt")).toBe("/file.txt");
    expect(childPath("/work/", "file.txt")).toBe("/work/file.txt");
  });

  it("adds and rolls back a provisional item", () => {
    const added = addOptimisticItem(files, "/work", "new.txt", "file", 0);
    expect(added.at(-1)).toMatchObject({
      name: "new.txt",
      path: "/work/new.txt",
      type: "file",
      size: 0,
    });
    expect(removePaths(added, new Set(["/work/new.txt"]))).toEqual(files);
  });

  it("renames immediately and can reverse the same item", () => {
    const renamed = renameOptimisticItem(files, "/work/alpha.txt", "beta.txt");
    expect(renamed[0]).toMatchObject({
      name: "beta.txt",
      path: "/work/beta.txt",
      size: 10,
    });
    expect(
      renameOptimisticItem(renamed, "/work/beta.txt", "alpha.txt"),
    ).toEqual(files);
  });

  it("restores only failed deletions without duplicating survivors", () => {
    const remaining = removePaths(files, new Set(["/work/docs"]));
    expect(restoreItems(remaining, [files[1], files[0]])).toEqual(files);
  });
});
