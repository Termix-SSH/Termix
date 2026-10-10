import { describe, expect, it } from "vitest";
import {
  allFolderPaths,
  buildCredentialManageTree,
  buildHostManageTree,
  flattenTree,
} from "@/manage/manage-tree";
import type { Credential, Host } from "@/types/ui-types";

function host(id: string, folder: string, extra: Partial<Host> = {}): Host {
  return {
    id,
    name: `host-${id}`,
    username: "root",
    ip: `10.0.0.${id}`,
    port: 22,
    folder,
    online: false,
    cpu: null,
    ram: null,
    lastAccess: "",
    authType: "password",
    ...extra,
  } as Host;
}

describe("manage tree", () => {
  it("nests folder paths and sub-hosts", () => {
    const tree = buildHostManageTree([
      host("1", "Prod / EU"),
      host("2", "Prod"),
      host("3", "", { parentHostId: "2" }),
    ]);
    expect(allFolderPaths(tree)).toEqual(["Prod", "Prod / EU"]);
    const prod = tree.folders[0];
    expect(prod.folders[0].items[0].id).toBe("1");
    expect(prod.items[0].children[0].id).toBe("3");
  });

  it("drops a parent loop back to folder placement", () => {
    const tree = buildHostManageTree([
      host("1", "", { parentHostId: "2" }),
      host("2", "", { parentHostId: "1" }),
    ]);
    const total =
      tree.items.length + tree.items.flatMap((i) => i.children).length;
    expect(total).toBe(2);
  });

  it("uses the online check it is given", () => {
    const tree = buildHostManageTree([host("1", "")], () => true);
    expect(tree.items[0].online).toBe(true);
  });

  it("opens folders holding a search match and hides the rest", () => {
    const tree = buildHostManageTree([
      host("1", "Prod / EU", { tags: ["db"] }),
      host("2", "Staging"),
    ]);
    const rows = flattenTree(tree, new Set(), "db");
    expect(
      rows.map((r) => (r.kind === "folder" ? r.folder.path : r.item.id)),
    ).toEqual(["Prod", "Prod / EU", "1"]);
  });

  it("respects collapsed folders without a search", () => {
    const tree = buildHostManageTree([host("1", "Prod")]);
    expect(flattenTree(tree, new Set(), "")).toHaveLength(1);
    expect(flattenTree(tree, new Set(["Prod"]), "")).toHaveLength(2);
  });

  it("groups credentials by folder", () => {
    const tree = buildCredentialManageTree([
      { id: "c1", name: "deploy", username: "ci", folder: "Keys" },
      { id: "c2", name: "root", username: "root", folder: "" },
    ] as Credential[]);
    expect(tree.folders[0].items[0].note).toBe("ci");
    expect(tree.items[0].id).toBe("c2");
  });
});
