import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WebEndpoint, WebUiConfig } from "@/types/index";

const isElectron = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/lib/electron", () => ({ isElectron }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

import { HostEditorWebUiSection } from "@/sidebar/HostEditorWebUiSection";

function endpoint(overrides: Partial<WebEndpoint> = {}): WebEndpoint {
  return {
    id: "e1",
    label: "Proxmox",
    scheme: "https",
    port: 8006,
    path: "/",
    access: "direct",
    render: "external",
    ...overrides,
  };
}

function setup(
  config: WebUiConfig = { endpoints: [] },
  {
    enableWebUi = true,
    tunnelAvailable = true,
  }: { enableWebUi?: boolean; tunnelAvailable?: boolean } = {},
) {
  const setField = vi.fn();
  render(
    <HostEditorWebUiSection
      enableWebUi={enableWebUi}
      webUiConfig={config}
      tunnelAvailable={tunnelAvailable}
      setField={setField}
    />,
  );
  return setField;
}

beforeEach(() => {
  isElectron.mockReturnValue(true);
});

afterEach(cleanup);

describe("HostEditorWebUiSection", () => {
  it("hides the endpoint list until the feature is enabled", () => {
    setup({ endpoints: [endpoint()] }, { enableWebUi: false });
    expect(screen.queryByLabelText("hosts.webUiLabel")).not.toBeInTheDocument();
    expect(
      screen.queryByText("hosts.webUiAddEndpoint"),
    ).not.toBeInTheDocument();
  });

  it("adds an endpoint with a non-colliding label", () => {
    const setField = setup({
      endpoints: [endpoint({ label: "hosts.webUiNewEndpointLabel" })],
    });
    fireEvent.click(screen.getByText("hosts.webUiAddEndpoint"));

    const [, value] = setField.mock.calls[0];
    const added = (value as WebUiConfig).endpoints[1];
    // Labels identify an endpoint in the sidebar picker, so a fresh row must
    // not silently duplicate one already there.
    expect(added.label).toBe("hosts.webUiNewEndpointLabel 2");
    expect(added.id).toBeTruthy();
  });

  it("stops adding at the cap", () => {
    const many = Array.from({ length: 16 }, (_, i) =>
      endpoint({ id: `e${i}`, label: `E${i}` }),
    );
    setup({ endpoints: many });
    expect(screen.getByText("hosts.webUiAddEndpoint")).toBeDisabled();
  });

  it("refuses to commit a port the normalizer would drop", () => {
    // Number("") is 0, which the normalizer rejects -- committing it would
    // silently discard the endpoint on save with no error shown.
    const setField = setup({ endpoints: [endpoint()] });
    fireEvent.change(screen.getByLabelText("hosts.webUiPort"), {
      target: { value: "" },
    });
    expect(setField).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("hosts.webUiPort"), {
      target: { value: "9000" },
    });
    expect((setField.mock.calls[0][1] as WebUiConfig).endpoints[0].port).toBe(
      9000,
    );
  });

  it("shows the bind-host fields only for a tunnel endpoint", () => {
    setup({ endpoints: [endpoint({ access: "direct" })] });
    expect(screen.queryByLabelText("hosts.bindHost")).not.toBeInTheDocument();

    cleanup();
    setup({ endpoints: [endpoint({ access: "tunnel" })] });
    expect(screen.getByLabelText("hosts.bindHost")).toBeInTheDocument();
    expect(screen.getByLabelText("hosts.webUiLocalPort")).toBeInTheDocument();
  });

  it("warns that a non-loopback bind is unauthenticated exposure", () => {
    setup({ endpoints: [endpoint({ access: "tunnel", bindHost: "0.0.0.0" })] });
    expect(screen.getByText("hosts.webUiBindHostExposed")).toBeInTheDocument();
  });

  it("does not warn about exposure for a loopback bind", () => {
    setup({
      endpoints: [endpoint({ access: "tunnel", bindHost: "127.0.0.1" })],
    });
    expect(
      screen.queryByText("hosts.webUiBindHostExposed"),
    ).not.toBeInTheDocument();
  });

  it("warns at config time that a loopback bind is unreachable from a browser", () => {
    isElectron.mockReturnValue(false);
    setup({ endpoints: [endpoint({ access: "tunnel" })] });
    // Said while configuring, not only when the tab fails to load.
    expect(
      screen.getByText("hosts.webUiBindHostUnreachable"),
    ).toBeInTheDocument();
  });

  it("warns at config time about the session-cookie collision", () => {
    // The page host in jsdom is "localhost", which HAS a loopback alias, so
    // force a host that does not to reach the second refusal.
    isElectron.mockReturnValue(false);
    const realLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      get: () => ({ ...realLocation, hostname: "termix.example.com" }),
    });

    setup({ endpoints: [endpoint({ access: "tunnel", bindHost: "0.0.0.0" })] });
    expect(
      screen.getByText("hosts.webUiBindHostSharesSessionCookie"),
    ).toBeInTheDocument();

    Object.defineProperty(window, "location", {
      configurable: true,
      value: realLocation,
    });
  });

  it("explains why tunnelling is unavailable rather than leaving a dead option", () => {
    // A disabled control with no stated reason reads as the dropdown being
    // broken.
    setup({ endpoints: [endpoint()] }, { tunnelAvailable: false });
    expect(
      screen.getByText("hosts.webUiAccessTunnelUnavailable"),
    ).toBeInTheDocument();
  });

  it("reports a row the normalizer would drop", () => {
    setup({ endpoints: [endpoint({ label: "   " })] });
    expect(
      screen.getByText(/hosts.webUiErrorLabelRequired/),
    ).toBeInTheDocument();
  });

  it("removes an endpoint", () => {
    const setField = setup({
      endpoints: [endpoint(), endpoint({ id: "e2", label: "NAS" })],
    });
    fireEvent.click(screen.getAllByLabelText("hosts.webUiRemoveEndpoint")[0]);
    expect((setField.mock.calls[0][1] as WebUiConfig).endpoints).toHaveLength(
      1,
    );
    expect((setField.mock.calls[0][1] as WebUiConfig).endpoints[0].id).toBe(
      "e2",
    );
  });
});
