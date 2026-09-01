import { cleanup, render, screen } from "@testing-library/react";
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
