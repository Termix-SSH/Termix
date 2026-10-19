import { describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ owned: true, shared: [] as number[] }));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    isHostOwnedByUser: async () => access.owned,
  }),
  createCurrentRoleRepository: () => ({ listUserRoleIds: async () => [] }),
  createCurrentRbacAccessRepository: () => ({
    listVisibleHostAccessEntries: async () =>
      access.shared.map((hostId) => ({ hostId })),
  }),
}));

import {
  provideActivity,
  recentActivity,
  type ActivityProvider,
} from "../../plugins/activity-provider.js";

function fake(): ActivityProvider {
  return {
    record: vi.fn(async () => ({ status: "logged" as const, id: 1 })),
    list: vi.fn(async () => []),
    deleteByUserId: vi.fn(async () => {}),
    deleteByHostIds: vi.fn(async () => {}),
  };
}

const entry = { type: "ssh", hostId: 1, hostName: "h" };

describe("recent activity provider", () => {
  it("is unavailable with no provider", async () => {
    expect(await recentActivity.record("u", entry)).toEqual({
      status: "unavailable",
    });
    expect(await recentActivity.list("u", 5)).toEqual([]);
    await expect(recentActivity.deleteByUserId("u")).resolves.toBeUndefined();
    await expect(recentActivity.deleteByHostId(7)).resolves.toBeUndefined();
  });

  it("routes to the plugin and back to nothing when it goes", async () => {
    const plugin = fake();
    const remove = provideActivity("homepage", plugin);
    await recentActivity.record("u", entry);
    await recentActivity.deleteByHostId(7);
    expect(plugin.record).toHaveBeenCalledOnce();
    expect(plugin.deleteByHostIds).toHaveBeenCalledWith([7]);

    remove();
    expect(await recentActivity.list("u", 5)).toEqual([]);
    expect(plugin.list).not.toHaveBeenCalled();
  });

  it("checks host access before the provider records", async () => {
    const plugin = fake();
    const remove = provideActivity("homepage", plugin);

    access.owned = false;
    access.shared = [];
    expect(await recentActivity.record("u", entry)).toEqual({
      status: "denied",
    });
    expect(plugin.record).not.toHaveBeenCalled();

    access.shared = [1];
    expect((await recentActivity.record("u", entry)).status).toBe("logged");
    remove();
    access.owned = true;
  });

  it("refuses a second provider", () => {
    const remove = provideActivity("one", fake());
    expect(() => provideActivity("two", fake())).toThrow(
      /already provided by plugin "one"/,
    );
    remove();
  });
});
