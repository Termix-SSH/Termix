import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, unknown>();

vi.mock("../../plugins/index.js", () => ({
  getPluginRuntime: () => ({
    loader: {
      list: () => [
        {
          id: "docker",
          dir: "/nowhere",
          state: "active",
          official: true,
          manifest: {
            id: "docker",
            name: "Docker",
            version: "1.0.0",
            contributes: {
              operations: {
                actions: [
                  {
                    id: "docker.restart",
                    titleKey: "ops.restart",
                    scope: "host",
                    risk: "change",
                    when: { settings: { enableDocker: true } },
                  },
                  {
                    id: "docker.list",
                    titleKey: "ops.list",
                    scope: "host",
                    risk: "read",
                  },
                  {
                    id: "docker.prune-all",
                    titleKey: "ops.pruneAll",
                    scope: "server",
                    risk: "destructive",
                    when: { settings: { enableDocker: true } },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  }),
}));

vi.mock("../../plugins/ctx-probe.js", () => ({
  loadProbeTargets: vi.fn(async () => [{ id: 1 }, { id: 2 }, { id: 3 }]),
}));

vi.mock("../../plugins/settings.js", () => ({
  getSetting: vi.fn(
    async (_manifest: unknown, _scope: string, hostId: number, key: string) =>
      settings.get(`${hostId}:${key}`),
  ),
}));

vi.mock("../../operations/registry.js", () => ({
  getAction: () => ({}),
}));

vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({ hasPermission: async () => true }),
  },
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({}),
}));

import { buildCatalog } from "../../operations/catalog.js";

describe("buildCatalog", () => {
  beforeEach(() => {
    settings.clear();
    settings.set("1:enableDocker", true);
    settings.set("2:enableDocker", false);
    settings.set("3:enableDocker", true);
  });

  it("lists the hosts an action with when fits", async () => {
    const catalog = await buildCatalog({ userId: "u1" });
    const restart = catalog.actions.find((a) => a.id === "docker.restart");
    expect(restart?.hostIds).toEqual([1, 3]);
  });

  it("leaves hostIds out for actions without when and for server actions", async () => {
    const catalog = await buildCatalog({ userId: "u1" });
    expect(
      catalog.actions.find((a) => a.id === "docker.list")?.hostIds,
    ).toBeUndefined();
    expect(
      catalog.actions.find((a) => a.id === "docker.prune-all")?.hostIds,
    ).toBeUndefined();
  });
});
