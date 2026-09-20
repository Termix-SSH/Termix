import { describe, expect, it } from "vitest";
import { SSH_GROUP_TABS, makeHostSshSubTabs } from "@/sidebar/HostManagerTabs";

describe("the Web UI editor tab", () => {
  it("is an SSH sub-tab, beside Docker and Tunnels", () => {
    const ids = makeHostSshSubTabs((key) => key).map((tab) => tab.id);
    expect(ids).toContain("web-ui");
    // Placed after docker, before proxmox -- the grouping the user approved.
    expect(ids.indexOf("web-ui")).toBe(ids.indexOf("docker") + 1);
  });

  it("is in the SSH group, so it follows SSH availability", () => {
    // Deliberate asymmetry with the sidebar, which gates on enableWebUi alone
    // because a direct endpoint needs no SSH. A host with SSH off cannot
    // configure endpoints; that is accepted, not an oversight.
    expect(SSH_GROUP_TABS.has("web-ui")).toBe(true);
  });
});
