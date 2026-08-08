import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const getVersionInfo = vi.fn();
const getDatabaseHealth = vi.fn(async () => ({ status: "ok" }));
vi.mock("@/api/system-status-api", () => ({
  getVersionInfo: (...args: unknown[]) => getVersionInfo(...args),
  getDatabaseHealth: () => getDatabaseHealth(),
}));
vi.mock("@/api/dashboard-api", () => ({
  getUptime: vi.fn(async () => ({ formatted: "1d 2h" })),
}));

// The real one installs an interval and a visibilitychange listener; the
// component's first fetch happens outside it, which is all these tests need.
vi.mock("../../../features/homepage/use-visible-interval", () => ({
  runVisibleInterval: () => () => {},
}));

import { SystemOverviewWidget } from "../../../features/homepage/widgets/SystemOverviewWidget";
import type { CanvasWidget } from "@/types/homepage-types";

const widget: CanvasWidget = {
  id: 1,
  typeId: "system_overview",
  title: "Termix",
  config: {},
  x: 0,
  y: 0,
  w: 10,
  h: 6,
  zOrder: 0,
};

function renderWidget() {
  render(
    <SystemOverviewWidget
      widget={widget}
      config={{ showVersion: true, showDbHealth: false, showUptime: false }}
    />,
  );
}

beforeEach(() => {
  getVersionInfo.mockReset();
});

afterEach(cleanup);

describe("SystemOverviewWidget update indicator", () => {
  it("asks /version to actually check the remote release", async () => {
    // Regression: it used to pass checkRemote=false, which makes the endpoint
    // return early without ever comparing against the latest release.
    getVersionInfo.mockResolvedValue({
      status: "up_to_date",
      localVersion: "2.6.1",
    });

    renderWidget();

    await waitFor(() => expect(getVersionInfo).toHaveBeenCalledTimes(1));
    expect(getVersionInfo).toHaveBeenCalledWith();
  });

  it("flags an available update from the status the endpoint returns", async () => {
    // Regression: it used to read `updateAvailable`, a field /version does not
    // return in either mode, so the row could never appear.
    getVersionInfo.mockResolvedValue({
      status: "requires_update",
      localVersion: "2.6.0",
      remoteVersion: "2.6.1",
    });

    renderWidget();

    await waitFor(() =>
      expect(screen.getByText("homepage.overviewUpdateAvailable")).toBeTruthy(),
    );
  });

  it("labels that row 'Update' rather than 'Up to date'", async () => {
    // homepage.overviewUpdate is the string "Up to date", which read as the
    // label of an update-available row said "Up to date  Update available".
    getVersionInfo.mockResolvedValue({
      status: "requires_update",
      localVersion: "2.6.0",
    });

    renderWidget();

    await waitFor(() =>
      expect(screen.getByText("homepage.overviewUpdateLabel")).toBeTruthy(),
    );
    expect(screen.queryByText("homepage.overviewUpdate")).toBeNull();
  });

  it("shows no update row when the server is current", async () => {
    getVersionInfo.mockResolvedValue({
      status: "up_to_date",
      localVersion: "2.6.1",
    });

    renderWidget();

    await waitFor(() => expect(screen.getByText("2.6.1")).toBeTruthy());
    expect(screen.queryByText("homepage.overviewUpdateAvailable")).toBeNull();
    expect(screen.queryByText("homepage.overviewUpdateLabel")).toBeNull();
  });

  it("shows no update row on a beta build, which is ahead rather than behind", async () => {
    getVersionInfo.mockResolvedValue({
      status: "beta",
      localVersion: "2.7.0",
      remoteVersion: "2.6.1",
    });

    renderWidget();

    await waitFor(() => expect(screen.getByText("2.7.0")).toBeTruthy());
    expect(screen.queryByText("homepage.overviewUpdateAvailable")).toBeNull();
  });
});
