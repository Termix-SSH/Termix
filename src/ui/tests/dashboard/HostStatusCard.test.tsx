import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { HostStatusCard } from "@/dashboard/DashboardTab";
import type { Host } from "@/types/ui-types";
import {
  registerHostAction,
  resetHostContributions,
} from "@/sidebar/host-contributions";

afterEach(cleanup);

describe("HostStatusCard", () => {
  it("truncates long host identity without shrinking the metrics", () => {
    const host = {
      id: "host-1",
      name: "a-very-long-host-name-that-must-not-shift-the-status-columns",
      ip: "a-very-long-hostname.example.internal",
      online: false,
    } as Host;

    render(<HostStatusCard hosts={[host]} onOpenTab={() => {}} />);

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

describe("dashboard host routing", () => {
  const Icon = (() => null) as never;
  beforeEach(() => {
    registerHostAction({
      id: "desk-connect",
      titleKey: "x",
      icon: Icon,
      kind: "connect",
      priority: 50,
      tabType: "desk",
      when: (host) => (host as Record<string, unknown>).enableDesk === true,
    });
    registerHostAction({
      id: "shell-connect",
      titleKey: "x",
      icon: Icon,
      kind: "connect",
      priority: 100,
      tabType: "shell",
      when: (host) => (host as Record<string, unknown>).enableShell === true,
    });
    registerHostAction({
      id: "stats",
      titleKey: "x",
      icon: Icon,
      kind: "open",
      overview: true,
      tabType: "stats",
      when: (host) => (host as Record<string, unknown>).enableShell === true,
    });
  });
  afterEach(resetHostContributions);

  it.each([
    [{ enableDesk: true }, "desk"],
    [{ enableShell: true, enableDesk: true }, "stats"],
  ] as const)("opens the right view for %j", (flags, expected) => {
    const host = {
      id: "1",
      name: "Remote host",
      ip: "192.0.2.1",
      ...flags,
    } as unknown as Host;
    const onOpenTab = vi.fn();
    render(<HostStatusCard hosts={[host]} onOpenTab={onOpenTab} />);
    fireEvent.click(screen.getByText("Remote host"));
    expect(onOpenTab).toHaveBeenCalledWith(host, expected);
  });
});
