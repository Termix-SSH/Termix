import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { HostStatusCard } from "@/dashboard/DashboardTab";
import type { Host } from "@/types/ui-types";

afterEach(cleanup);

describe("HostStatusCard", () => {
  it("truncates long host identity without shrinking the metrics", () => {
    const host = {
      id: "host-1",
      name: "a-very-long-host-name-that-must-not-shift-the-status-columns",
      ip: "a-very-long-hostname.example.internal",
      online: false,
    } as Host;

    render(
      <HostStatusCard
        hosts={[host]}
        hostMetrics={new Map()}
        onOpenTab={() => {}}
      />,
    );

    const name = screen.getByText(host.name);
    const ip = screen.getByText(host.ip);
    const identity = name.parentElement?.parentElement;
    const row = identity?.parentElement?.parentElement;
    const metrics = row?.lastElementChild;

    expect(name.className).toContain("truncate");
    expect(name.getAttribute("title")).toBe(host.name);
    expect(ip.className).toContain("truncate");
    expect(ip.getAttribute("title")).toBe(host.ip);
    expect(identity?.className).toContain("min-w-0");
    expect(metrics?.className).toContain("shrink-0");
  });
});

describe("dashboard protocol routing", () => {
  it.each([
    [{ enableRdp: true }, "rdp"],
    [{ enableVnc: true }, "vnc"],
    [{ enableTelnet: true }, "telnet"],
    [{ enableSsh: true, enableRdp: true }, "host-metrics"],
  ] as const)("opens the enabled protocol for %j", (protocols, expected) => {
    const host = {
      id: "1",
      name: "Remote host",
      ip: "192.0.2.1",
      enableSsh: false,
      ...protocols,
    } as Host;
    const onOpenTab = vi.fn();
    render(
      <HostStatusCard
        hosts={[host]}
        hostMetrics={new Map()}
        onOpenTab={onOpenTab}
      />,
    );
    fireEvent.click(screen.getByText("Remote host"));
    expect(onOpenTab).toHaveBeenCalledWith(host, expected);
  });
});
