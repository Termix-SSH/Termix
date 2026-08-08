import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Host } from "@/types/ui-types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/ServerStatusContext", () => ({
  useHostStatus: () => null,
  useServerStatus: () => ({
    getStatus: () => "online",
    initialLoadComplete: true,
  }),
  useServerStatusMeta: () => ({ initialLoadComplete: true, isLoading: false }),
}));

vi.mock("@/hooks/use-status-color-scheme", () => ({
  useStatusColorScheme: () => "accent",
  getStatusClasses: () => "",
}));

vi.mock("@/main-axios", () => ({
  getHostPassword: vi.fn(),
  wakeOnLan: vi.fn(),
}));

import { HostItem } from "../../../../sidebar/tree/HostItem/HostItem";

const baseHost: Host = {
  id: "1",
  name: "web-01",
  username: "root",
  ip: "10.0.0.5",
  port: 22,
  folder: "",
  online: true,
  cpu: 42,
  ram: 60,
  lastAccess: "",
  tags: ["prod", "web"],
  authType: "password",
  hasPassword: true,
  pin: true,
  enableSsh: true,
  enableTerminal: true,
  enableCommandHistory: true,
  enableTunnel: true,
  enableFileManager: true,
  enableDocker: true,
  enableRdp: true,
  enableVnc: true,
  enableTelnet: true,
  macAddress: "aa:bb:cc:dd:ee:ff",
  quickActions: [],
} as unknown as Host;

const noop = () => {};

function renderHostItem(
  density: "comfortable" | "compact",
  opts: { menuOpen?: boolean } = {},
) {
  return render(
    <HostItem
      host={baseHost}
      onOpenTab={noop}
      onEditHost={noop}
      onShareHost={noop}
      onDelete={noop}
      onDuplicate={noop}
      density={density}
      isMenuOpen={opts.menuOpen ?? false}
    />,
  );
}

afterEach(cleanup);

describe("HostItem density parity", () => {
  it.each(["comfortable", "compact"] as const)(
    "exposes the pin indicator in %s density",
    (density) => {
      renderHostItem(density);
      expect(document.querySelector(".lucide-pin")).toBeTruthy();
    },
  );

  it.each(["comfortable", "compact"] as const)(
    "exposes the Copy Link submenu trigger in %s density",
    (density) => {
      renderHostItem(density, { menuOpen: true });
      expect(screen.getByText("hosts.copyLink")).toBeTruthy();
    },
  );

  it.each(["comfortable", "compact"] as const)(
    "exposes edit, share, and more-options actions in %s density",
    (density) => {
      renderHostItem(density);
      expect(screen.getByTitle("hosts.editHostAction")).toBeTruthy();
      expect(screen.getByTitle("hosts.shareHost")).toBeTruthy();
      expect(screen.getByTitle("hosts.moreOptions")).toBeTruthy();
    },
  );

  it.each(["comfortable", "compact"] as const)(
    "exposes RDP, VNC, and Telnet quick-launch buttons in %s density",
    (density) => {
      renderHostItem(density);
      expect(screen.getByTitle("hosts.connectRdp")).toBeTruthy();
      expect(screen.getByTitle("hosts.connectVnc")).toBeTruthy();
      expect(screen.getByTitle("hosts.connectTelnet")).toBeTruthy();
    },
  );

  it.each(["comfortable", "compact"] as const)(
    "exposes the wake-on-LAN button when a MAC address is set, in %s density",
    (density) => {
      renderHostItem(density);
      expect(screen.getByTitle("hosts.wakeOnLanAction")).toBeTruthy();
    },
  );

  it.each(["comfortable", "compact"] as const)(
    "exposes the copy-password action in %s density",
    (density) => {
      renderHostItem(density);
      expect(screen.getByTitle("nav.copyPassword")).toBeTruthy();
    },
  );

  it("shows tags in both densities when showTags is true", () => {
    renderHostItem("comfortable");
    expect(screen.getByText("prod")).toBeTruthy();
    cleanup();
    renderHostItem("compact");
    expect(screen.getByText("prod")).toBeTruthy();
  });

  it("hides tags in both densities when showTags is false", () => {
    render(
      <HostItem
        host={baseHost}
        onOpenTab={noop}
        onEditHost={noop}
        onDelete={noop}
        onDuplicate={noop}
        density="comfortable"
        showTags={false}
      />,
    );
    expect(screen.queryByText("prod")).toBeNull();
  });
});
