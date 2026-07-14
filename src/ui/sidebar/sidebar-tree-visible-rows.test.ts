import { describe, expect, it } from "vitest";
import type { Host, HostFolder } from "@/types/ui-types";

// Mirror of SidebarTree collectVisibleRows for unit coverage without exporting
// the full React module graph.
function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}

function hostMatchesQuery(host: Host, query: string): boolean {
  const q = query.toLowerCase();
  return (
    host.name.toLowerCase().includes(q) ||
    host.ip.toLowerCase().includes(q) ||
    host.username.toLowerCase().includes(q)
  );
}

function folderHasMatch(folder: HostFolder, query: string): boolean {
  if (folder.name.toLowerCase().includes(query.toLowerCase())) return true;
  for (const child of folder.children) {
    if (isFolder(child)) {
      if (folderHasMatch(child, query)) return true;
    } else if (hostMatchesQuery(child, query)) {
      return true;
    }
  }
  return false;
}

type VirtualRow = { item: Host | HostFolder; depth: number };

function collectVisibleRows(
  children: (Host | HostFolder)[],
  query: string,
  openSet: Set<string>,
  out: VirtualRow[] = [],
  depth = 0,
): VirtualRow[] {
  for (const child of children) {
    if (isFolder(child)) {
      const visible = query ? folderHasMatch(child, query) : true;
      if (!visible) continue;
      out.push({ item: child, depth });
      const childOpen = query ? true : openSet.has(child.path ?? child.name);
      if (childOpen)
        collectVisibleRows(child.children, query, openSet, out, depth + 1);
    } else {
      if (!query || hostMatchesQuery(child, query))
        out.push({ item: child, depth });
    }
  }
  return out;
}

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
