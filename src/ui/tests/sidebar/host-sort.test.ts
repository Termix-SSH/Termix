import { describe, expect, it } from "vitest";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  resolveHostSortPreferences,
  sortHostTree,
} from "../../sidebar/host-sort";

function host(name: string, pin = false): Host {
  return {
    id: name,
    name,
    ip: `10.0.0.${name.length}`,
    online: true,
    pin,
  } as Host;
}

function names(folder: HostFolder): string[] {
  return folder.children.map((child) => child.name);
}

describe("sortHostTree", () => {
  it("sorts pinned and unpinned hosts by name within their groups", () => {
    const tree: HostFolder = {
      name: "root",
      children: [
        host("gamma"),
        host("zeta", true),
        host("beta"),
        host("alpha", true),
      ],
    };

    expect(names(sortHostTree(tree, "name-asc", true))).toEqual([
      "alpha",
      "zeta",
      "beta",
      "gamma",
    ]);
    expect(names(tree)).toEqual(["gamma", "zeta", "beta", "alpha"]);
  });

  it("keeps pinned-first independent from the selected base sort", () => {
    const tree: HostFolder = {
      name: "root",
      children: [host("alpha"), host("zeta", true), host("beta")],
    };

    expect(names(sortHostTree(tree, "name-asc"))).toEqual([
      "alpha",
      "beta",
      "zeta",
    ]);
    expect(names(sortHostTree(tree, "default", true))).toEqual([
      "zeta",
      "alpha",
      "beta",
    ]);
  });

  it("applies combined sorting inside folders", () => {
    const tree: HostFolder = {
      name: "root",
      children: [
        {
          name: "production",
          children: [host("beta"), host("alpha", true)],
        },
      ],
    };

    const sorted = sortHostTree(tree, "name-asc", true);
    expect(names(sorted.children[0] as HostFolder)).toEqual(["alpha", "beta"]);
  });
});

describe("resolveHostSortPreferences", () => {
  it("migrates the legacy pinned sort without losing the preference", () => {
    expect(resolveHostSortPreferences("pinned", null)).toEqual({
      sortKey: "default",
      pinnedFirst: true,
    });
  });

  it("keeps the saved pinned modifier independent from base sorting", () => {
    expect(resolveHostSortPreferences("name-desc", "true")).toEqual({
      sortKey: "name-desc",
      pinnedFirst: true,
    });
  });
});
