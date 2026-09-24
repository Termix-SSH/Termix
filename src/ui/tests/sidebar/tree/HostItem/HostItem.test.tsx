import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Host } from "@/types/ui-types";
import { registerHostAction } from "@/sidebar/host-contributions";
import { LOCAL_ADAPTIVE_PREFERENCES_KEY } from "@/lib/local-adaptive-preferences";

const { markTabSurfaceUsedMock, preloadTabSurfaceMock } = vi.hoisted(() => ({
  markTabSurfaceUsedMock: vi.fn(),
  preloadTabSurfaceMock: vi.fn(),
}));

vi.mock("@/shell/tabUtils", () => ({
  markTabSurfaceUsed: markTabSurfaceUsedMock,
  preloadTabSurface: preloadTabSurfaceMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/ServerStatusContext", () => ({
  useHostStatus: () => null,
  useHostStatusReason: () => null,
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
  enableRdp: true,
  enableVnc: true,
  enableTelnet: true,
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

afterEach(() => {
  cleanup();
  markTabSurfaceUsedMock.mockClear();
  preloadTabSurfaceMock.mockClear();
  localStorage.removeItem(LOCAL_ADAPTIVE_PREFERENCES_KEY);
});

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
      expect(screen.getByText("common.connect")).toBeTruthy();
      expect(screen.getByText("hosts.copyLink")).toBeTruthy();
    },
  );

  it("opens the complete host menu on right click", () => {
    function Harness() {
      const [menuOpen, setMenuOpen] = useState(false);
      return (
        <HostItem
          host={baseHost}
          onOpenTab={noop}
          onEditHost={noop}
          onShareHost={noop}
          onDelete={noop}
          onDuplicate={noop}
          isMenuOpen={menuOpen}
          onMenuOpenChange={setMenuOpen}
        />
      );
    }
    render(<Harness />);

    const hostRow = screen.getByText("web-01").closest(".cursor-pointer");
    expect(hostRow).toBeTruthy();
    fireEvent.contextMenu(hostRow!, { clientX: 120, clientY: 80 });

    expect(screen.getByText("common.connect")).toBeTruthy();
    expect(screen.getAllByText("hosts.editHostAction").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("hosts.shareHost").length).toBeGreaterThan(0);
  });

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
    "exposes plugin connect actions as quick-launch buttons in %s density",
    (density) => {
      const Icon = (() => null) as never;
      const disposers = ["desk", "screen"].map((id) =>
        registerHostAction({
          id,
          titleKey: `fixture.${id}`,
          icon: Icon,
          kind: "connect",
          tabType: id,
          when: () => true,
        }),
      );
      try {
        renderHostItem(density);
        expect(screen.getByTitle("fixture.desk")).toBeTruthy();
        expect(screen.getByTitle("fixture.screen")).toBeTruthy();
      } finally {
        disposers.forEach((dispose) => dispose());
      }
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

  it("learns repeated local actions and preloads the preferred host tool", () => {
    const Icon = (() => null) as never;
    const dispose = registerHostAction({
      id: "tmux_monitor",
      titleKey: "Tmux Monitor",
      icon: Icon,
      kind: "open",
      tabType: "tmux_monitor",
      when: () => true,
    });
    try {
      renderHostItem("comfortable");
      const tmuxButton = screen.getByTitle("Tmux Monitor");
      fireEvent.click(tmuxButton);
      fireEvent.click(tmuxButton);
      fireEvent.click(tmuxButton);

      const hostRow = screen.getByText("web-01").closest(".cursor-pointer");
      expect(hostRow).toBeTruthy();
      fireEvent.pointerEnter(hostRow!);

      // No plugin registered a connect action, so only the learned tool preloads.
      expect(preloadTabSurfaceMock).not.toHaveBeenCalledWith("");
      expect(preloadTabSurfaceMock).toHaveBeenCalledWith("tmux_monitor");
    } finally {
      dispose();
    }
  });
});
