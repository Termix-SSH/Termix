import { describe, expect, it } from "vitest";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  resolveHostSortPreferences,
  sortHostTree,
} from "../../sidebar/host-sort";

function host(name: string, pin = false, sortOrder?: number | null): Host {
  return {
    id: name,
    name,
    ip: `10.0.0.${name.length}`,
    online: true,
    pin,
    sortOrder,
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

describe("sortHostTree manual mode", () => {
  it("sorts hosts by sortOrder, nulls last, name tie-break", () => {
    const tree: HostFolder = {
      name: "root",
      children: [
        host("gamma", false, null),
        host("alpha", false, 2000),
        host("beta", false, 1000),
        host("delta", false, null),
      ],
    };

    expect(names(sortHostTree(tree, "manual"))).toEqual([
      "beta",
      "alpha",
      "delta",
      "gamma",
    ]);
  });

  it("sorts sibling folders by their own sortOrder in manual mode", () => {
    const tree: HostFolder = {
      name: "root",
      children: [
        { name: "zeta", sortOrder: 1000, children: [] },
        { name: "alpha", sortOrder: null, children: [] },
        { name: "beta", sortOrder: 500, children: [] },
      ],
    };

    expect(names(sortHostTree(tree, "manual"))).toEqual([
      "beta",
      "zeta",
      "alpha",
    ]);
  });

  it("still lists folders before hosts in manual mode", () => {
    const tree: HostFolder = {
      name: "root",
      children: [
        host("alpha", false, 100),
        { name: "sub", sortOrder: 9000, children: [] },
      ],
    };

    expect(names(sortHostTree(tree, "manual"))).toEqual(["sub", "alpha"]);
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
