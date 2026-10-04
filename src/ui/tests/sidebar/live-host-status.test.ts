import { describe, expect, it } from "vitest";
import type { Host, HostFolder } from "@/types/ui-types";
import { withLiveHostStatus, withLiveStatus } from "@/sidebar/live-host-status";

const host = (id: number, extra: Partial<Host> = {}) =>
  ({ id: String(id), name: `h${id}`, online: false, ...extra }) as Host;

const statuses: Record<number, "online" | "offline"> = {
  1: "online",
  2: "offline",
};
const getStatus = (id: number) => statuses[id] ?? "unknown";

describe("withLiveStatus", () => {
  it("copies live statuses into nested folders", () => {
    const tree: HostFolder = {
      name: "root",
      children: [host(1), { name: "f", children: [host(2), host(3)] }],
    };
    const live = withLiveStatus(tree, getStatus);
    const [first, folder] = live.children as [Host, HostFolder];
    const [second, third] = folder.children as Host[];
    expect(first).toMatchObject({ status: "online", online: true });
    expect(second).toMatchObject({ status: "offline", online: false });
    expect(third).toMatchObject({ status: "unknown", online: false });
  });

  it("gives a host with status checks off no status", () => {
    const [live] = withLiveHostStatus(
      [host(1, { statusCheckEnabled: false })],
      getStatus,
    );
    expect(live.status).toBeUndefined();
    expect(live.online).toBe(false);
  });

  it("keeps the same object when nothing changed", () => {
    const same = host(1, { status: "online", online: true });
    expect(withLiveHostStatus([same], getStatus)[0]).toBe(same);
  });
});
