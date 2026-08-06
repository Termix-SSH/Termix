import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import type { SSHHostWithStatus } from "@/main-axios";

const mainAxios = vi.hoisted(() => ({
  exportAllSSHHosts: vi.fn(),
}));

vi.mock("@/main-axios", () => mainAxios);

const i18n = vi.hoisted(() => ({
  t: (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${JSON.stringify(opts)}` : key,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => i18n,
}));

vi.mock("@/sidebar/SidebarTree", () => ({ isFolder: () => false }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { HostExportDialog } from "../../sidebar/HostExportDialog";

function sshHost(
  overrides: Partial<SSHHostWithStatus> = {},
): SSHHostWithStatus {
  return {
    id: 1,
    name: "web",
    ip: "10.0.0.1",
    port: 22,
    username: "deploy",
    folder: "",
    tags: [],
    pin: false,
    authType: "password",
    connectionType: "ssh",
    enableTerminal: true,
    enableSessionLogging: false,
    enableCommandHistory: false,
    enableTunnel: false,
    enableFileManager: false,
    enableDocker: false,
    enableProxmox: false,
    enableTmuxMonitor: false,
    showTerminalInSidebar: true,
    showFileManagerInSidebar: false,
    showTunnelInSidebar: false,
    showDockerInSidebar: false,
    showServerStatsInSidebar: false,
    defaultPath: "",
    tunnelConnections: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "online",
    ...overrides,
  };
}

function rawPayload() {
  return {
    hosts: [
      {
        connectionType: "ssh",
        name: "web",
        ip: "10.0.0.1",
        port: 22,
        username: "deploy",
        password: "hunter2",
        guacamoleConfig: {
          "gateway-hostname": "gw.example.com",
          "gateway-password": "gw-secret",
        },
      },
    ],
  };
}

function checkboxFor(labelKey: string): HTMLElement {
  const label = screen.getByText(labelKey).closest("label");
  if (!label) throw new Error(`no label wrapping ${labelKey}`);
  const checkbox = label.querySelector('[role="checkbox"]');
  if (!checkbox) throw new Error(`no checkbox inside ${labelKey}`);
  return checkbox as HTMLElement;
}

beforeEach(() => {
  mainAxios.exportAllSSHHosts.mockReset();
  mainAxios.exportAllSSHHosts.mockResolvedValue(rawPayload());
});

afterEach(() => {
  cleanup();
});

describe("HostExportDialog - credential handling", () => {
  it("calls the masked export endpoint by default on open", async () => {
    render(<HostExportDialog open onClose={() => {}} hosts={[sshHost()]} />);

    await waitFor(() => {
      expect(mainAxios.exportAllSSHHosts).toHaveBeenCalledTimes(1);
    });
    expect(mainAxios.exportAllSSHHosts).toHaveBeenCalledWith({ share: true });
  });

  it("calls the full export endpoint after the credentials checkbox is toggled", async () => {
    render(<HostExportDialog open onClose={() => {}} hosts={[sshHost()]} />);

    await waitFor(() => {
      expect(mainAxios.exportAllSSHHosts).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(checkboxFor("hosts.export.groupCredentials"));

    await waitFor(() => {
      expect(mainAxios.exportAllSSHHosts).toHaveBeenCalledTimes(2);
    });
    expect(mainAxios.exportAllSSHHosts).toHaveBeenNthCalledWith(1, {
      share: true,
    });
    expect(mainAxios.exportAllSSHHosts).toHaveBeenNthCalledWith(2);
  });

  it("masks the secret in the preview but includes it in the exported file", async () => {
    render(<HostExportDialog open onClose={() => {}} hosts={[sshHost()]} />);

    await waitFor(() => {
      expect(mainAxios.exportAllSSHHosts).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(checkboxFor("hosts.export.groupCredentials"));

    await waitFor(() => {
      expect(mainAxios.exportAllSSHHosts).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(document.querySelector("pre")?.textContent).toContain(
        "<included>",
      );
    });
    expect(document.querySelector("pre")?.textContent).not.toContain("hunter2");

    let capturedBlob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return "blob:mock";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const exportButton = screen
      .getByText("hosts.export.confirm")
      .closest("button")!;
    await waitFor(() =>
      expect((exportButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(exportButton);

    await waitFor(() => expect(capturedBlob).toBeDefined());
    const text = await capturedBlob!.text();
    expect(text).toContain("hunter2");
    expect(text).not.toContain("<included>");
  });

  it("omits the nested guacamole secret from the exported file when credentials are excluded", async () => {
    render(<HostExportDialog open onClose={() => {}} hosts={[sshHost()]} />);

    await waitFor(() => {
      expect(mainAxios.exportAllSSHHosts).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(document.querySelector("pre")?.textContent).toContain(
        "gateway-hostname",
      );
    });

    let capturedBlob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return "blob:mock";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const exportButton = screen
      .getByText("hosts.export.confirm")
      .closest("button")!;
    await waitFor(() =>
      expect((exportButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(exportButton);

    await waitFor(() => expect(capturedBlob).toBeDefined());
    const text = await capturedBlob!.text();
    expect(text).not.toContain("gw-secret");
    expect(text).toContain("gw.example.com");

    const parsed = JSON.parse(text);
    expect(parsed.hosts[0].guacamoleConfig["gateway-password"]).toBeNull();
  });
});
