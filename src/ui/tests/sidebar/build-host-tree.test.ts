import { describe, expect, it } from "vitest";
import { buildHostTree } from "../../sidebar/build-host-tree.js";
import { isFolder } from "../../sidebar/tree/visible-rows.js";
import type { SSHHostWithStatus } from "@/main-axios";

type RawHostOverrides = {
  id: number;
  name?: string;
  folder?: string;
  /** Arrives as a number over the wire; sshHostToHost stringifies it. */
  parentHostId?: number;
};

function rawHost(overrides: RawHostOverrides): SSHHostWithStatus {
  return {
    ip: "10.0.0.1",
    port: 22,
    username: "root",
    authType: "password",
    status: "unknown",
    name: `host-${overrides.id}`,
    ...overrides,
  } as unknown as SSHHostWithStatus;
}

describe("buildHostTree", () => {
  it("places hosts with no folder or parent at root", () => {
    const tree = buildHostTree([rawHost({ id: 1 }), rawHost({ id: 2 })]);
    expect(tree.children).toHaveLength(2);
    expect(tree.children.every((c) => !isFolder(c))).toBe(true);
  });

  it("nests a host under its parent via parentHostId, not as a folder wrapper", () => {
    const tree = buildHostTree([
      rawHost({ id: 1, name: "Zeus" }),
      rawHost({ id: 2, name: "vm1", parentHostId: 1 }),
    ]);

    expect(tree.children).toHaveLength(1);
    const zeus = tree.children[0];
    expect(isFolder(zeus)).toBe(false);
    if (isFolder(zeus)) throw new Error("unreachable");
    expect(zeus.name).toBe("Zeus");
    expect(zeus.childHosts).toHaveLength(1);
    expect(zeus.childHosts?.[0].name).toBe("vm1");
  });

  it("supports unlimited nesting depth", () => {
    const tree = buildHostTree([
      rawHost({ id: 1, name: "root-host" }),
      rawHost({ id: 2, name: "child", parentHostId: 1 }),
      rawHost({ id: 3, name: "grandchild", parentHostId: 2 }),
    ]);

    const root = tree.children[0];
    if (isFolder(root)) throw new Error("unreachable");
    const child = root.childHosts?.[0];
    expect(child?.name).toBe("child");
    expect(child?.childHosts?.[0].name).toBe("grandchild");
  });

  it("falls back to root placement when the parent host is missing", () => {
    const tree = buildHostTree([
      rawHost({ id: 2, name: "orphan", parentHostId: 999 }),
    ]);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].name).toBe("orphan");
  });

  it("falls back to root placement rather than looping on a cyclic parent chain", () => {
    // Defensive case: stale/synced data where two hosts point at each other.
    const tree = buildHostTree([
      rawHost({ id: 1, name: "a", parentHostId: 2 }),
      rawHost({ id: 2, name: "b", parentHostId: 1 }),
    ]);
    // Neither host should vanish or cause an infinite loop -- both land at root.
    expect(tree.children).toHaveLength(2);
  });

  it("prefers parentHostId nesting over folder placement", () => {
    const tree = buildHostTree([
      rawHost({ id: 1, name: "Zeus" }),
      rawHost({
        id: 2,
        name: "vm1",
        parentHostId: 1,
        folder: "Production",
      }),
    ]);

    // The sub-host does not also appear under a "Production" folder node.
    expect(tree.children).toHaveLength(1);
    const zeus = tree.children[0];
    if (isFolder(zeus)) throw new Error("unreachable");
    expect(zeus.childHosts?.[0].name).toBe("vm1");
  });

  it("still places hosts by folder path when no parentHostId is set", () => {
    const tree = buildHostTree([
      rawHost({ id: 1, name: "web1", folder: "Production / Web" }),
    ]);
    expect(tree.children).toHaveLength(1);
    expect(isFolder(tree.children[0])).toBe(true);
  });
});

describe("buildHostTree folder metadata", () => {
  it("copies sortOrder onto the folder so manual sort can order folders", () => {
    const tree = buildHostTree(
      [rawHost({ id: 1, folder: "Prod" }), rawHost({ id: 2, folder: "Dev" })],
      new Map([
        ["Prod", { sortOrder: 2000 }],
        ["Dev", { sortOrder: 1000 }],
      ]),
    );
    const folders = tree.children.filter(isFolder);
    expect(folders.map((f) => [f.name, f.sortOrder])).toEqual(
      expect.arrayContaining([
        ["Prod", 2000],
        ["Dev", 1000],
      ]),
    );
  });

  it("leaves sortOrder null when the folder has no metadata row", () => {
    const tree = buildHostTree([rawHost({ id: 1, folder: "Prod" })]);
    expect(tree.children.filter(isFolder)[0].sortOrder).toBeNull();
  });
});
