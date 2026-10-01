import { describe, expect, it, vi } from "vitest";
import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import { createWorkspacesApi } from "../../src/frontend/workspaces-api";

function fakeClient() {
  const reply = (data: unknown) => vi.fn(async () => ({ data }));
  return {
    get: reply([]),
    post: reply({ id: 1 }),
    put: reply({ id: 1 }),
    patch: reply({ id: 1 }),
    delete: reply({ success: true }),
  };
}

const layout = { version: 1, tabs: [] };

describe("workspaces api", () => {
  it("calls each route relative to the plugin's own mount point", async () => {
    const client = fakeClient();
    const api = createWorkspacesApi(client as unknown as PluginApiClient);

    await api.list();
    await api.create({ name: "A", color: "#fff", payload: layout });
    await api.rename(3, { name: "B" });
    await api.updateContent(3, layout);
    await api.remove(3);
    await api.duplicate(3, "C");
    await api.setDefault(3);
    await api.unsetDefault(3);
    await api.apply(3);
    await api.getLastSession();
    await api.saveLastSession(layout);

    expect(client.get.mock.calls).toEqual([["/"], ["/last-session"]]);
    expect(client.post.mock.calls).toEqual([
      ["/", { name: "A", color: "#fff", payload: layout }],
      ["/3/duplicate", { name: "C" }],
      ["/3/set-default"],
      ["/3/unset-default"],
      ["/3/apply"],
    ]);
    expect(client.patch.mock.calls).toEqual([["/3", { name: "B" }]]);
    expect(client.put.mock.calls).toEqual([
      ["/3/content", { payload: layout }],
      ["/last-session", { payload: layout }],
    ]);
    expect(client.delete.mock.calls).toEqual([["/3"]]);
  });

  it("returns the response body", async () => {
    const client = fakeClient();
    client.get = vi.fn(async () => ({ data: [{ id: 7 }] }));
    const api = createWorkspacesApi(client as unknown as PluginApiClient);
    expect(await api.list()).toEqual([{ id: 7 }]);
  });
});
