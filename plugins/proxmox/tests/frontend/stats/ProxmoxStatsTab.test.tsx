import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@termix/plugin-sdk/frontend", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({ t: (key: string) => key, language: "en" }),
  usePluginApi: () => ({}),
  useHosts: () => ({ hosts: [] }),
}));

vi.mock("../../../src/frontend/stats/proxmox-stats-api", () => ({
  createProxmoxStatsApi: () => ({
    startPolling: () => new Promise(() => {}),
    stopPolling: () => Promise.resolve(),
    getSnapshot: () => new Promise(() => {}),
    sendHeartbeat: () => Promise.resolve(),
  }),
}));

import { ProxmoxStatsTab } from "../../../src/frontend/stats/ProxmoxStatsTab";

const host = (proxmox: Record<string, unknown>) => ({
  id: 1,
  name: "pve",
  ip: "10.0.0.1",
  username: "root",
  pluginSettings: { proxmox },
});

afterEach(cleanup);

describe("ProxmoxStatsTab", () => {
  it("reads the stats switch from the plugin host settings", () => {
    render(<ProxmoxStatsTab hostConfig={host({ enableProxmoxStats: true })} />);
    expect(
      screen.queryByText("proxmoxStats.noHostSelected"),
    ).not.toBeInTheDocument();
  });

  it("shows the empty state when stats are off for the host", () => {
    render(<ProxmoxStatsTab hostConfig={host({})} />);
    expect(screen.getByText("proxmoxStats.noHostSelected")).toBeInTheDocument();
  });
});
