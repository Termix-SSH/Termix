import { describe, expect, it } from "vitest";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  isFolder,
  collectVisibleRows,
  buildReorderRows,
  rowKey,
  rowKind,
  ROOT_PARENT,
} from "../../sidebar/tree/visible-rows";

function host(id: string, name: string): Host {
  return {
    id,
    name,
    username: "u",
    ip: "10.0.0." + id,
    port: 22,
    folder: "",
    online: true,
    cpu: null,
    ram: null,
    lastAccess: "",
    tags: [],
    authType: "password",
    pin: false,
    enableSsh: true,
    enableTerminal: true,
    enableTunnel: false,
    enableFileManager: true,
    enableDocker: false,
    enableRdp: false,
    enableVnc: false,
    enableTelnet: false,
    quickActions: [],
  } as Host;
}

describe("collectVisibleRows", () => {
  const tree: (Host | HostFolder)[] = [
    host("1", "root-host"),
    {
      name: "prod",
      path: "prod",
      children: [
        host("2", "web"),
        {
          name: "db",
          path: "prod / db",
          children: [host("3", "postgres")],
        },
      ],
    },
  ];

  it("collapses closed folders", () => {
    const rows = collectVisibleRows(tree, "", new Set());
    expect(
      rows.map((r) => (isFolder(r.item) ? r.item.name : r.item.name)),
    ).toEqual(["root-host", "prod"]);
  });

  it("expands open folders with depth", () => {
    const rows = collectVisibleRows(tree, "", new Set(["prod", "prod / db"]));
    expect(
      rows.map((r) => ({
        name: isFolder(r.item) ? r.item.name : r.item.name,
        depth: r.depth,
      })),
    ).toEqual([
      { name: "root-host", depth: 0 },
      { name: "prod", depth: 0 },
      { name: "web", depth: 1 },
      { name: "db", depth: 1 },
      { name: "postgres", depth: 2 },
    ]);
  });

  it("opens all matching folders when searching", () => {
    const rows = collectVisibleRows(tree, "postgres", new Set());
    expect(
      rows.map((r) => (isFolder(r.item) ? r.item.name : r.item.name)),
    ).toEqual(["prod", "db", "postgres"]);
  });
});

describe("collectVisibleRows with sub-host nesting", () => {
  function hostWithChildren(
    id: string,
    name: string,
    childHosts?: Host[],
  ): Host {
    return { ...host(id, name), childHosts } as Host;
  }

  it("shows a parent host's children by default, unlike folders", () => {
    const tree: (Host | HostFolder)[] = [
      hostWithChildren("1", "Zeus", [host("2", "vm1")]),
    ];
    const rows = collectVisibleRows(tree, "", new Set());
    expect(rows.map((r) => r.item.name)).toEqual(["Zeus", "vm1"]);
    expect(rows[1].depth).toBe(1);
  });

  it("hides children once the parent is explicitly collapsed", () => {
    const tree: (Host | HostFolder)[] = [
      hostWithChildren("1", "Zeus", [host("2", "vm1")]),
    ];
    const rows = collectVisibleRows(
      tree,
      "",
      new Set(),
      [],
      0,
      new Set(["host:1"]),
    );
    expect(rows.map((r) => r.item.name)).toEqual(["Zeus"]);
  });

  it("always shows children while searching, regardless of collapsed state", () => {
    const tree: (Host | HostFolder)[] = [
      hostWithChildren("1", "Zeus", [host("2", "vm1")]),
    ];
    const rows = collectVisibleRows(
      tree,
      "vm1",
      new Set(),
      [],
      0,
      new Set(["host:1"]),
    );
    expect(rows.map((r) => r.item.name)).toEqual(["Zeus", "vm1"]);
  });
});

describe("buildReorderRows", () => {
  it("keys folders by path and hosts by id", () => {
    const folder: HostFolder = {
      name: "Web",
      path: "Prod / Web",
      children: [],
    };
    expect(rowKey(folder)).toBe("folder:Prod / Web");
    expect(rowKey(host("7", "box"))).toBe("host:7");
  });

  it("reads the kind back off a key", () => {
    expect(rowKind("folder:Prod / Web")).toBe("folder");
    expect(rowKind("host:7")).toBe("host");
  });

  it("parents a nested folder to its path prefix", () => {
    const nested: HostFolder = {
      name: "Web",
      path: "Prod / Web",
      children: [],
      sortOrder: 500,
    };
    expect(buildReorderRows([{ item: nested }])).toEqual([
      { key: "folder:Prod / Web", parentKey: "folder:Prod", sortOrder: 500 },
    ]);
  });

  it("parents a top-level folder to the root sentinel", () => {
    const top: HostFolder = { name: "Prod", path: "Prod", children: [] };
    expect(buildReorderRows([{ item: top }])[0].parentKey).toBe(ROOT_PARENT);
  });

  it("parents a host to its folder", () => {
    const h = { ...host("3", "db"), folder: "Prod / Web", sortOrder: 2000 };
    expect(buildReorderRows([{ item: h }])).toEqual([
      { key: "host:3", parentKey: "folder:Prod / Web", sortOrder: 2000 },
    ]);
  });

  it("parents a sub-host to its parent host, not its folder", () => {
    const child = { ...host("4", "child"), folder: "Prod", parentHostId: "3" };
    expect(buildReorderRows([{ item: child }])[0].parentKey).toBe("host:3");
  });

  it("parents a folderless host to the root sentinel", () => {
    expect(buildReorderRows([{ item: host("5", "loose") }])[0].parentKey).toBe(
      ROOT_PARENT,
    );
  });
});
