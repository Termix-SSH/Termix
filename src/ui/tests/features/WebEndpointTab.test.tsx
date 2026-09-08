import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { WebEndpoint } from "@/types/index";
import type { Host } from "@/types/ui-types";

const openWebEndpointTunnel = vi.hoisted(() => vi.fn());
const allowInvalidCertificateForOrigin = vi.hoisted(() => vi.fn());

vi.mock("@/api/web-endpoint-api", async (importOriginal) => {
  // requireNumericHostId is left as the real implementation -- the "no saved
  // host" case exercises the actual validation, not a re-implementation of it
  // that could drift.
  const actual =
    await importOriginal<typeof import("@/api/web-endpoint-api")>();
  return {
    ...actual,
    openWebEndpointTunnel: (...args: unknown[]) =>
      openWebEndpointTunnel(...args),
    allowInvalidCertificateForOrigin: (...args: unknown[]) =>
      allowInvalidCertificateForOrigin(...args),
  };
});

const electron = vi.hoisted(() => ({ isElectron: vi.fn(() => true) }));
vi.mock("@/lib/electron", () => electron);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function endpoint(overrides: Partial<WebEndpoint> = {}): WebEndpoint {
  return {
    id: "e1",
    label: "Proxmox",
    scheme: "https",
    port: 8006,
    path: "/",
    access: "direct",
    render: "embedded",
    ...overrides,
  };
}

function host(
  overrides: Partial<Host> = {},
  endpoints: WebEndpoint[] = [],
): Host {
  return {
    id: "7",
    ip: "192.168.1.10",
    webUiConfig: { endpoints },
    ...overrides,
  } as unknown as Host;
}

let pageHostname = "localhost";
const realLocation = window.location;

beforeEach(() => {
  pageHostname = "localhost";
  electron.isElectron.mockReturnValue(true);
  Object.defineProperty(window, "location", {
    configurable: true,
    get: () => ({ ...realLocation, hostname: pageHostname }),
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: realLocation,
  });
  openWebEndpointTunnel.mockReset();
  allowInvalidCertificateForOrigin.mockReset();
});

describe("WebEndpointTab", () => {
  it("renders an iframe at the direct URL", async () => {
    const { WebEndpointTab } =
      await import("@/features/web-endpoint/WebEndpointTab");
    render(<WebEndpointTab host={host({}, [endpoint()])} endpointId="e1" />);
    await waitFor(() =>
      expect(screen.getByTitle("Proxmox")).toHaveAttribute(
        "src",
        "https://192.168.1.10:8006/",
      ),
    );
  });

  it("opens the tunnel through the numeric host id and frames the loopback URL", async () => {
    openWebEndpointTunnel.mockResolvedValue(41234);
    const { WebEndpointTab } =
      await import("@/features/web-endpoint/WebEndpointTab");
    render(
      <WebEndpointTab
        host={host({}, [endpoint({ access: "tunnel" })])}
        endpointId="e1"
      />,
    );
    await waitFor(() => {
      expect(openWebEndpointTunnel).toHaveBeenCalledWith(7, "e1");
      expect(screen.getByTitle("Proxmox")).toHaveAttribute(
        "src",
        "https://127.0.0.1:41234/",
      );
    });
  });

  it("registers the certificate allowance for a direct endpoint with ignoreCert", async () => {
    const { WebEndpointTab } =
      await import("@/features/web-endpoint/WebEndpointTab");
    render(
      <WebEndpointTab
        host={host({}, [endpoint({ ignoreCert: true })])}
        endpointId="e1"
      />,
    );
    await waitFor(() =>
      expect(allowInvalidCertificateForOrigin).toHaveBeenCalledWith(
        "https://192.168.1.10:8006",
      ),
    );
  });

  it("reframes at the new port when a reopened tunnel binds a different one", async () => {
    openWebEndpointTunnel
      .mockResolvedValueOnce(41234)
      .mockResolvedValueOnce(51234);
    const { WebEndpointTab } =
      await import("@/features/web-endpoint/WebEndpointTab");
    render(
      <WebEndpointTab
        host={host({}, [endpoint({ access: "tunnel" })])}
        endpointId="e1"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTitle("Proxmox")).toHaveAttribute(
        "src",
        "https://127.0.0.1:41234/",
      ),
    );

    fireEvent.click(screen.getByTitle("webEndpoint.reload"));

    await waitFor(() =>
      expect(screen.getByTitle("Proxmox")).toHaveAttribute(
        "src",
        "https://127.0.0.1:51234/",
      ),
    );
    expect(openWebEndpointTunnel).toHaveBeenCalledTimes(2);
  });

  /**
   * The case the port-changed test above CANNOT exercise, and the one that
   * matters most: a live tunnel returns the SAME port on every open, and a
   * direct endpoint's URL never changes at all. If reload just did
   * setUrl(resolved), React would bail out of the same-value setState and the
   * frame would never remount -- so the button would do nothing in the two
   * most common cases. Capturing the DOM node before and after is what catches
   * that: a same-value setState never touches the DOM.
   */
  it("remounts the frame on reload even when the resolved URL is unchanged", async () => {
    openWebEndpointTunnel.mockResolvedValue(41234);
    const { WebEndpointTab } =
      await import("@/features/web-endpoint/WebEndpointTab");
    render(
      <WebEndpointTab
        host={host({}, [endpoint({ access: "tunnel" })])}
        endpointId="e1"
      />,
    );
    const firstFrame = await screen.findByTitle("Proxmox");
    expect(firstFrame).toHaveAttribute("src", "https://127.0.0.1:41234/");

    fireEvent.click(screen.getByTitle("webEndpoint.reload"));
    await waitFor(() => expect(openWebEndpointTunnel).toHaveBeenCalledTimes(2));

    // Polled rather than asserted once: against the defective implementation
    // this never becomes true and the test times out -- a real failure, not a
    // race.
    await waitFor(() => {
      expect(screen.getByTitle("Proxmox")).not.toBe(firstFrame);
    });
  });

  it("shows the failure reason when the tunnel cannot open", async () => {
    openWebEndpointTunnel.mockRejectedValue(
      new Error("Timed out reaching the endpoint port"),
    );
    const { WebEndpointTab } =
      await import("@/features/web-endpoint/WebEndpointTab");
    render(
      <WebEndpointTab
        host={host({}, [endpoint({ access: "tunnel" })])}
        endpointId="e1"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Timed out reaching the endpoint port/),
      ).toBeInTheDocument(),
    );
  });

  it("shows a plain message when the endpoint id matches nothing on the host", async () => {
    const { WebEndpointTab } =
      await import("@/features/web-endpoint/WebEndpointTab");
    render(<WebEndpointTab host={host({}, [])} endpointId="deleted" />);
    await waitFor(() =>
      expect(screen.getByText("webEndpoint.notFound")).toBeInTheDocument(),
    );
    expect(openWebEndpointTunnel).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("explains that a tunnel needs a saved host, instead of calling the route", async () => {
    const { WebEndpointTab } =
      await import("@/features/web-endpoint/WebEndpointTab");
    render(
      <WebEndpointTab
        host={host({ id: "quick-connect-1" }, [endpoint({ access: "tunnel" })])}
        endpointId="e1"
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/requires a saved host/)).toBeInTheDocument(),
    );
    expect(openWebEndpointTunnel).not.toHaveBeenCalled();
  });

  it("resolves a direct endpoint normally on the same quick-connect host", async () => {
    // The positive case: requireNumericHostId must be consulted only on the
    // tunnel branch, or direct endpoints would break on unsaved hosts too.
    const { WebEndpointTab } =
      await import("@/features/web-endpoint/WebEndpointTab");
    render(
      <WebEndpointTab
        host={host({ id: "quick-connect-1" }, [endpoint({ access: "direct" })])}
        endpointId="e1"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTitle("Proxmox")).toHaveAttribute(
        "src",
        "https://192.168.1.10:8006/",
      ),
    );
    expect(openWebEndpointTunnel).not.toHaveBeenCalled();
  });

  it("frames a tunnel at the OTHER loopback spelling in a web deployment", async () => {
    // jsdom serves the page at "localhost". The forward binds where the
    // backend runs, so the browser must reach it on this same machine -- but
    // NOT at the same host string, or the tunnelled service receives Termix's
    // session cookie.
    electron.isElectron.mockReturnValue(false);
    openWebEndpointTunnel.mockResolvedValue(41234);
    const { WebEndpointTab } =
      await import("@/features/web-endpoint/WebEndpointTab");
    render(
      <WebEndpointTab
        host={host({}, [endpoint({ access: "tunnel", bindHost: "0.0.0.0" })])}
        endpointId="e1"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTitle("Proxmox")).toHaveAttribute(
        "src",
        "https://127.0.0.1:41234/",
      ),
    );
    // The assertion carrying the security property: whatever host the frame
    // lands on, it must not be the one serving Termix.
    const framed = new URL(
      screen.getByTitle("Proxmox").getAttribute("src") as string,
    ).hostname;
    expect(framed).not.toBe(window.location.hostname);
  });

  it("refuses a loopback-bound tunnel in a browser instead of framing a dead port", async () => {
    electron.isElectron.mockReturnValue(false);
    const { WebEndpointTab } =
      await import("@/features/web-endpoint/WebEndpointTab");
    render(
      <WebEndpointTab
        host={host({}, [endpoint({ access: "tunnel" })])}
        endpointId="e1"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByText("webEndpoint.tunnelUnreachableFromBrowser"),
      ).toBeInTheDocument(),
    );
    expect(openWebEndpointTunnel).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("refuses when the page host has no separate loopback spelling", async () => {
    electron.isElectron.mockReturnValue(false);
    pageHostname = "termix.example.com";
    const { WebEndpointTab } =
      await import("@/features/web-endpoint/WebEndpointTab");
    render(
      <WebEndpointTab
        host={host({}, [endpoint({ access: "tunnel", bindHost: "0.0.0.0" })])}
        endpointId="e1"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByText("webEndpoint.tunnelSharesSessionCookie"),
      ).toBeInTheDocument(),
    );
    // Refusing after opening would still have bound the port and still have
    // leaked on the first frame load.
    expect(openWebEndpointTunnel).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("still frames a DIRECT endpoint on a hostname that refuses tunnels", async () => {
    electron.isElectron.mockReturnValue(false);
    pageHostname = "termix.example.com";
    const { WebEndpointTab } =
      await import("@/features/web-endpoint/WebEndpointTab");
    render(<WebEndpointTab host={host({}, [endpoint()])} endpointId="e1" />);
    await waitFor(() =>
      expect(screen.getByTitle("Proxmox")).toHaveAttribute(
        "src",
        "https://192.168.1.10:8006/",
      ),
    );
  });
});
