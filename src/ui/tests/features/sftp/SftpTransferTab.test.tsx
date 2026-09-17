import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SftpTransferTab } from "@/features/sftp/SftpTransferTab";

const api = vi.hoisted(() => ({
  addTransferRecent: vi.fn(),
  browseSSHDirectory: vi.fn(),
  changeSSHPermissions: vi.fn(),
  createSSHFolder: vi.fn(),
  deleteSSHItem: vi.fn(),
  ensureSSHSessionForHost: vi.fn(),
  getSSHHosts: vi.fn(),
  getTransferProgressPercent: vi.fn(() => undefined),
  renameSSHItem: vi.fn(),
  transferToHost: vi.fn(),
  beginTransferProgressMonitoring: vi.fn(),
}));

vi.mock("@/main-axios", () => ({
  addTransferRecent: api.addTransferRecent,
  browseSSHDirectory: api.browseSSHDirectory,
  changeSSHPermissions: api.changeSSHPermissions,
  createSSHFolder: api.createSSHFolder,
  deleteSSHItem: api.deleteSSHItem,
  ensureSSHSessionForHost: api.ensureSSHSessionForHost,
  getSSHHosts: api.getSSHHosts,
  getTransferProgressPercent: api.getTransferProgressPercent,
  renameSSHItem: api.renameSSHItem,
  transferToHost: api.transferToHost,
}));

vi.mock("@/features/file-manager/transferProgressMonitor", () => ({
  beginTransferProgressMonitoring: api.beginTransferProgressMonitoring,
}));

vi.mock("@/features/file-manager/transferMetricsFormat", () => ({
  createFormatTransferMetrics: () => () => "",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.getSSHHosts.mockResolvedValue([
    {
      id: 1,
      name: "prod",
      ip: "10.0.0.1",
      enableFileManager: true,
      connectionType: "ssh",
      defaultPath: "/srv",
    },
    {
      id: 2,
      name: "backup",
      ip: "10.0.0.2",
      enableFileManager: true,
      connectionType: "ssh",
      defaultPath: "/srv",
    },
  ]);
  api.ensureSSHSessionForHost.mockImplementation(async (host) => ({
    state: "ready",
    sessionId: String(host.id),
  }));
  api.browseSSHDirectory.mockImplementation(
    async (sessionId: string, path: string) => ({
      status: "ok",
      path,
      files: [
        {
          name: `remote-${sessionId}.txt`,
          type: "file",
          size: 24,
          modified: "2026-07-18T10:30:00.000Z",
        },
      ],
    }),
  );
  api.transferToHost.mockResolvedValue({ transferId: "transfer-1" });
  api.beginTransferProgressMonitoring.mockReturnValue({
    toastId: "toast-1",
    waitForCompletion: Promise.resolve({
      transferId: "transfer-1",
      status: "success",
      phase: "transferring",
    }),
  });
});

async function selectHosts() {
  const selects = await screen.findAllByRole("combobox");
  fireEvent.change(selects[0], { target: { value: "1" } });
  fireEvent.change(selects[1], { target: { value: "2" } });
  await screen.findByText("remote-1.txt");
  await screen.findByText("remote-2.txt");
}

describe("SftpTransferTab", () => {
  it("loads file manager-enabled hosts into both host pickers", async () => {
    render(<SftpTransferTab />);
    const selects = await screen.findAllByRole("combobox");
    expect(selects).toHaveLength(2);
    expect(api.getSSHHosts).toHaveBeenCalled();
  });

  it("copies a source server file to the destination server via the context menu", async () => {
    render(<SftpTransferTab />);
    await selectHosts();

    fireEvent.contextMenu(screen.getByText("remote-1.txt"));
    await userEvent.click(screen.getByText("sftpTransfer.copyToTarget"));

    await waitFor(() => {
      expect(api.transferToHost).toHaveBeenCalledWith(
        "1",
        ["/srv/remote-1.txt"],
        "2",
        "/srv",
        false,
        "auto",
      );
    });
  });

  it("records the destination as a transfer recent after a successful copy", async () => {
    render(<SftpTransferTab />);
    await selectHosts();

    fireEvent.contextMenu(screen.getByText("remote-1.txt"));
    await userEvent.click(screen.getByText("sftpTransfer.copyToTarget"));

    await waitFor(() => {
      expect(api.addTransferRecent).toHaveBeenCalledWith(1, 2, "/srv", "/srv");
    });
  });

  it("blocks a same-host transfer where the destination is inside the source path", async () => {
    render(<SftpTransferTab />);
    const selects = await screen.findAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "1" } });
    fireEvent.change(selects[1], { target: { value: "1" } });
    const rows = await screen.findAllByText("remote-1.txt");

    // Destination pane starts at the same "/srv" listing as the source, so
    // browsing into the selected source file's own path (as if it were a
    // folder) makes the destination nested inside the source selection.
    const destPathInput = screen.getAllByDisplayValue("/srv")[1];
    fireEvent.change(destPathInput, {
      target: { value: "/srv/remote-1.txt" },
    });
    fireEvent.keyDown(destPathInput, { key: "Enter" });
    await waitFor(() =>
      expect(api.browseSSHDirectory).toHaveBeenCalledTimes(3),
    );

    fireEvent.contextMenu(rows[0]);
    await userEvent.click(screen.getByText("sftpTransfer.copyToTarget"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "sftpTransfer.destinationInsideSource",
      );
    });
    expect(api.transferToHost).not.toHaveBeenCalled();
  });

  it("renames a remote file from the row context menu", async () => {
    render(<SftpTransferTab />);
    await selectHosts();

    fireEvent.contextMenu(screen.getByText("remote-1.txt"));
    await userEvent.click(screen.getByText("sftpTransfer.rename"));
    const nameInput = screen.getByDisplayValue("remote-1.txt");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "renamed.txt");
    await userEvent.click(screen.getByText("sftpTransfer.save"));

    await waitFor(() => {
      expect(api.renameSSHItem).toHaveBeenCalledWith(
        "1",
        "/srv/remote-1.txt",
        "renamed.txt",
      );
    });
  });

  it("deletes a remote file after confirming", async () => {
    render(<SftpTransferTab />);
    await selectHosts();

    fireEvent.contextMenu(screen.getByText("remote-1.txt"));
    await userEvent.click(screen.getByText("sftpTransfer.delete"));
    const confirmButtons = await screen.findAllByText("sftpTransfer.delete");
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(api.deleteSSHItem).toHaveBeenCalledWith(
        "1",
        "/srv/remote-1.txt",
        false,
      );
    });
  });
});
