import { beforeEach, expect, it, vi } from "vitest";
const authApi = vi.hoisted(() => ({
  put: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));
vi.mock("@/main-axios", () => ({ authApi }));
import {
  addOpenTab,
  syncOpenTabs,
  patchOpenTab,
} from "../../api/open-tabs-api";
const tab = {
  id: "instance",
  tabType: "terminal",
  label: "Shared host",
  tabOrder: 0,
  hostId: -207,
};
beforeEach(() => vi.clearAllMocks());
it("never writes a remote-only host ID into the local tab foreign key", async () => {
  await addOpenTab(tab);
  await patchOpenTab(tab.id, { hostId: tab.hostId });
  expect(authApi.post).not.toHaveBeenCalled();
  expect(authApi.patch).not.toHaveBeenCalled();
});
it("retains valid tabs during a bulk sync containing a remote-only tab", async () => {
  const local = { ...tab, id: "local", hostId: 207 };
  const singleton = { ...tab, id: "singleton", hostId: null };
  await syncOpenTabs([tab, local, singleton]);
  expect(authApi.put).toHaveBeenCalledWith("/open-tabs", {
    tabs: [local, singleton],
  });
});
it("still persists local hosts and updates labels without a host ID", async () => {
  const local = { ...tab, hostId: 207 };
  await addOpenTab(local);
  await patchOpenTab(tab.id, { label: "Renamed" });
  expect(authApi.post).toHaveBeenCalledWith("/open-tabs", local);
  expect(authApi.patch).toHaveBeenCalledWith("/open-tabs/instance", {
    label: "Renamed",
  });
});
