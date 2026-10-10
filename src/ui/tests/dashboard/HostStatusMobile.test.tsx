import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mobile = vi.hoisted(() => ({ value: true }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));
vi.mock("@/shell/ActionSlot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shell/ActionSlot")>()),
  ComponentSlot: ({ slotId }: { slotId: string }) => <span>{slotId}</span>,
}));

import { HostStatusCard } from "@/dashboard/DashboardTab";
import type { Host } from "@/types/ui-types";

afterEach(cleanup);

const host = { id: "1", name: "web", ip: "10.0.0.1", online: true } as Host;

describe("HostStatusCard on a phone", () => {
  it("leaves out plugin metrics so the host name has room", () => {
    mobile.value = true;
    render(<HostStatusCard hosts={[host]} onOpenTab={() => {}} />);
    expect(screen.queryByText("dashboard.hostRow")).toBeNull();
  });

  it("keeps them on a wide screen", () => {
    mobile.value = false;
    render(<HostStatusCard hosts={[host]} onOpenTab={() => {}} />);
    expect(screen.getByText("dashboard.hostRow")).toBeTruthy();
  });
});
