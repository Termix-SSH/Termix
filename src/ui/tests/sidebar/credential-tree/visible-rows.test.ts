import { describe, expect, it } from "vitest";
import type { Credential } from "@/types/ui-types";
import {
  collectVisibleRows,
  isFolder,
  type CredentialFolder,
} from "../../../sidebar/credential-tree/visible-rows";

function cred(name: string, opts: Partial<Credential> = {}): Credential {
  return {
    id: name,
    name,
    username: `user-${name}`,
    type: "password",
    ...opts,
  };
}

describe("isFolder", () => {
  it("distinguishes folders from credentials", () => {
    const folder: CredentialFolder = { name: "prod", children: [] };
    expect(isFolder(folder)).toBe(true);
    expect(isFolder(cred("a"))).toBe(false);
  });
});

describe("collectVisibleRows", () => {
  it("only shows folder headers, never recursing into a nested folder shape", () => {
    const folders: CredentialFolder[] = [
      { name: "prod", children: [cred("a"), cred("b")] },
    ];
    const rows = collectVisibleRows(folders, "", new Set(["prod"]));
    expect(rows.every((r) => r.depth <= 1)).toBe(true);
    expect(rows[0]).toMatchObject({ depth: 0 });
    expect(rows.slice(1).every((r) => r.depth === 1)).toBe(true);
  });

  it("hides a folder's credentials when the folder is closed", () => {
    const folders: CredentialFolder[] = [
      { name: "prod", children: [cred("a"), cred("b")] },
    ];
    const rows = collectVisibleRows(folders, "", new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].item).toMatchObject({ name: "prod" });
  });

  it("skips folders with no matches under an active query", () => {
    const folders: CredentialFolder[] = [
      { name: "prod", children: [cred("apollo")] },
      { name: "staging", children: [cred("zeus")] },
    ];
    const rows = collectVisibleRows(folders, "apo", new Set());
    expect(
      rows.map((r) => (isFolder(r.item) ? r.item.name : r.item.name)),
    ).toEqual(["prod", "apollo"]);
  });

  it("auto-expands folders while a query is active regardless of open state", () => {
    const folders: CredentialFolder[] = [
      { name: "prod", children: [cred("apollo")] },
    ];
    const rows = collectVisibleRows(folders, "apollo", new Set());
    expect(rows).toHaveLength(2);
  });

  it("matches by name, username, or tags case-insensitively", () => {
    const folders: CredentialFolder[] = [
      {
        name: "prod",
        children: [
          cred("zeus", { username: "root" }),
          cred("hera", { tags: ["Linux"] }),
        ],
      },
    ];
    expect(
      collectVisibleRows(folders, "ROOT", new Set()).map((r) => r.item.name),
    ).toEqual(["prod", "zeus"]);
    expect(
      collectVisibleRows(folders, "linux", new Set()).map((r) => r.item.name),
    ).toEqual(["prod", "hera"]);
  });

  it("omits empty folders entirely", () => {
    const folders: CredentialFolder[] = [{ name: "empty", children: [] }];
    expect(collectVisibleRows(folders, "", new Set(["empty"]))).toEqual([]);
  });
});
