import { describe, expect, it } from "vitest";
import type { Host, SharePermissionLevel } from "@/types/ui-types";
import {
  canDeleteHost,
  canEditHost,
  canShareHost,
  canViewHostConfig,
} from "../../sidebar/host-permissions";

function ownHost(): Host {
  return { id: "1", name: "own", isShared: false } as Host;
}

function sharedHost(permissionLevel?: SharePermissionLevel): Host {
  return { id: "2", name: "shared", isShared: true, permissionLevel } as Host;
}

describe("host permissions", () => {
  it("grants every action on a host you own", () => {
    const host = ownHost();

    expect(canViewHostConfig(host)).toBe(true);
    expect(canEditHost(host)).toBe(true);
    expect(canShareHost(host)).toBe(true);
    expect(canDeleteHost(host)).toBe(true);
  });

  it("limits a connect-level recipient to connecting", () => {
    const host = sharedHost("connect");

    expect(canViewHostConfig(host)).toBe(false);
    expect(canEditHost(host)).toBe(false);
    expect(canShareHost(host)).toBe(false);
  });

  it("lets a view-level recipient read the config but not change it", () => {
    const host = sharedHost("view");

    expect(canViewHostConfig(host)).toBe(true);
    expect(canEditHost(host)).toBe(false);
    expect(canShareHost(host)).toBe(false);
  });

  it("lets an edit-level recipient edit but not re-share", () => {
    const host = sharedHost("edit");

    expect(canEditHost(host)).toBe(true);
    expect(canShareHost(host)).toBe(false);
  });

  it("lets a manage-level recipient edit and re-share", () => {
    const host = sharedHost("manage");

    expect(canEditHost(host)).toBe(true);
    expect(canShareHost(host)).toBe(true);
  });

  it("treats a shared host with no level as connect-only", () => {
    const host = sharedHost(undefined);

    expect(canViewHostConfig(host)).toBe(false);
    expect(canEditHost(host)).toBe(false);
    expect(canShareHost(host)).toBe(false);
  });

  it("never lets a recipient delete a shared host", () => {
    for (const level of [
      "connect",
      "view",
      "edit",
      "manage",
    ] as SharePermissionLevel[]) {
      expect(canDeleteHost(sharedHost(level))).toBe(false);
    }
  });
});
