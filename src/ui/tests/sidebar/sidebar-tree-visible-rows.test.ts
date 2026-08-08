import { describe, expect, it } from "vitest";
import type { Host, HostFolder } from "@/types/ui-types";
import { isFolder, collectVisibleRows } from "../../sidebar/tree/visible-rows";

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
