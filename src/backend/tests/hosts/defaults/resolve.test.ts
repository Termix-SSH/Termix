import { describe, expect, it, vi } from "vitest";

vi.mock("../../../database/repositories/factory.js", () => ({}));
import {
  effectiveFolderPath,
  folderChainPaths,
  isOwnValue,
  resolveKey,
  withoutSelfJump,
  type HostLevels,
} from "../../../hosts/defaults/resolve.js";
import { coreCatalogEntries } from "../../../hosts/defaults/catalog.js";

const entry = (key: string) =>
  coreCatalogEntries().find((info) => info.key === key)!;

function levels(partial: Partial<HostLevels> = {}): HostLevels {
  return {
    admin: new Map(),
    user: new Map(),
    folders: [],
    ...partial,
  };
}

describe("folderChainPaths", () => {
  it("lists every ancestor, root first", () => {
    expect(folderChainPaths("A / B / C")).toEqual(["A", "A / B", "A / B / C"]);
    expect(folderChainPaths(null)).toEqual([]);
    expect(folderChainPaths("")).toEqual([]);
  });
});

describe("effectiveFolderPath", () => {
  it("takes a sub-host's folder from its nearest placed ancestor", () => {
    const placement = new Map([
      [1, { folder: "Prod", parentHostId: null }],
      [2, { folder: null, parentHostId: 1 }],
      [3, { folder: null, parentHostId: 2 }],
    ]);
    expect(effectiveFolderPath(3, placement)).toBe("Prod");
    expect(effectiveFolderPath(1, placement)).toBe("Prod");
  });

  it("stops on a parent cycle", () => {
    const placement = new Map([
      [1, { folder: null, parentHostId: 2 }],
      [2, { folder: null, parentHostId: 1 }],
    ]);
    expect(effectiveFolderPath(1, placement)).toBeNull();
  });
});

describe("resolveKey", () => {
  it("prefers the deepest folder, then the user, then the server, then built-in", () => {
    const port = entry("sshPort");
    expect(resolveKey(port, levels())).toEqual({
      value: 22,
      source: { level: "builtin" },
    });
    expect(
      resolveKey(port, levels({ admin: new Map([["core.sshPort", 2200]]) }))
        ?.source.level,
    ).toBe("admin");
    const all = levels({
      admin: new Map([["core.sshPort", 2200]]),
      user: new Map([["core.sshPort", 2201]]),
      folders: [
        { folderId: 1, name: "A", values: new Map([["core.sshPort", 2202]]) },
        {
          folderId: 2,
          name: "A / B",
          values: new Map([["core.sshPort", 2203]]),
        },
      ],
    });
    expect(resolveKey(port, all)).toEqual({
      value: 2203,
      source: { level: "folder", folderId: 2, folderName: "A / B" },
    });
    all.folders[1].values.clear();
    expect(resolveKey(port, all)?.value).toBe(2202);
  });

  it("skips a level the key cannot be set at", () => {
    const jumps = entry("jumpHosts");
    const result = resolveKey(
      jumps,
      levels({ admin: new Map([["core.jumpHosts", [{ hostId: 5 }]]]) }),
    );
    expect(result?.source.level).toBe("builtin");
    expect(result?.value).toEqual([]);
  });

  it("resolves nothing for a key with no built-in value and no level", () => {
    expect(resolveKey(entry("username"), levels())).toBeUndefined();
  });
});

describe("isOwnValue", () => {
  it("compares normalized values", () => {
    const port = entry("sshPort");
    const resolved = { value: 22, source: { level: "builtin" as const } };
    expect(isOwnValue(port, "22", resolved)).toBe(false);
    expect(isOwnValue(port, null, resolved)).toBe(false);
    expect(isOwnValue(port, 2222, resolved)).toBe(true);
  });

  it("treats any value as the host's own when nothing resolves", () => {
    const username = entry("username");
    expect(isOwnValue(username, "root", undefined)).toBe(true);
    expect(isOwnValue(username, "", undefined)).toBe(false);
  });

  it("treats keepalive left unset as the built-in value", () => {
    const keepalive = entry("keepaliveInterval");
    expect(
      isOwnValue(keepalive, undefined, {
        value: 60,
        source: { level: "builtin" },
      }),
    ).toBe(false);
  });
});

describe("withoutSelfJump", () => {
  it("drops the host itself from an inherited jump chain", () => {
    expect(withoutSelfJump([{ hostId: 1 }, { hostId: 2 }], 2)).toEqual([
      { hostId: 1 },
    ]);
  });
});
