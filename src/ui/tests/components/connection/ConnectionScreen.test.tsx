import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { ConnectionScreen } from "../../../components/connection/ConnectionScreen";
import { ConnectionLogProvider } from "../../../ssh/connection-log/ConnectionLogContext";

afterEach(cleanup);

describe("ConnectionScreen", () => {
  // Loading and host-not-found screens render before the provider is mounted,
  // which used to throw and take down the whole RDP/VNC/Telnet tab.
  it("renders without a ConnectionLogProvider", () => {
    expect(() =>
      render(<ConnectionScreen status="connecting" message="common.loading" />),
    ).not.toThrow();

    expect(screen.getByText("common.loading")).toBeTruthy();
  });

  it("renders the disconnected state without a provider", () => {
    expect(() =>
      render(
        <ConnectionScreen
          status="disconnected"
          message="guacamole.hostNotFound"
        />,
      ),
    ).not.toThrow();

    expect(screen.getByText("guacamole.hostNotFound")).toBeTruthy();
  });

  it("still shows the connection log when a provider is present", () => {
    render(
      <ConnectionLogProvider>
        <ConnectionScreen status="connecting" message="common.loading" />
      </ConnectionLogProvider>,
    );

    expect(screen.getByText(/terminal\.connectionLogTitle/)).toBeTruthy();
  });
});
