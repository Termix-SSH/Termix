import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SftpTransferTab } from "@/features/sftp/SftpTransferTab";

const api = vi.hoisted(() => ({
  browseSSHDirectory: vi.fn(),
  changeSSHPermissions: vi.fn(),
  createSSHFolder: vi.fn(),
  deleteSSHItem: vi.fn(),
  ensureSSHSessionForHost: vi.fn(),
  getSSHHosts: vi.fn(),
  listSSHFiles: vi.fn(),
  readSSHFile: vi.fn(),
  renameSSHItem: vi.fn(),
  transferToHost: vi.fn(),
  uploadSSHFile: vi.fn(),
  beginTransferProgressMonitoring: vi.fn(),
}));

vi.mock("@/main-axios", () => ({
  browseSSHDirectory: api.browseSSHDirectory,
  changeSSHPermissions: api.changeSSHPermissions,
  createSSHFolder: api.createSSHFolder,
  deleteSSHItem: api.deleteSSHItem,
  ensureSSHSessionForHost: api.ensureSSHSessionForHost,
  getSSHHosts: api.getSSHHosts,
  listSSHFiles: api.listSSHFiles,
  readSSHFile: api.readSSHFile,
  renameSSHItem: api.renameSSHItem,
  transferToHost: api.transferToHost,
  uploadSSHFile: api.uploadSSHFile,
}));

vi.mock("@/features/file-manager/transferProgressMonitor", () => ({
  beginTransferProgressMonitoring: api.beginTransferProgressMonitoring,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function installElectronApi() {
  const electronAPI = {
    getLocalHomeDirectory: vi.fn().mockResolvedValue("/Users/test"),
    listLocalDirectory: vi.fn().mockResolvedValue({
      success: true,
      path: "/Users/test",
      parent: "/Users",
      entries: [
        {
          name: "local.txt",
          path: "/Users/test/local.txt",
          type: "file",
          size: 12,
          modified: "2026-07-20T00:00:00.000Z",
          permissions: "644",
        },
      ],
    }),
    createLocalFolder: vi.fn().mockResolvedValue({ success: true }),
    renameLocalPath: vi.fn().mockResolvedValue({ success: true }),
    trashLocalPath: vi.fn().mockResolvedValue({ success: true }),
    chmodLocalPath: vi.fn().mockResolvedValue({ success: true }),
    writeLocalFile: vi.fn().mockResolvedValue({ success: true }),
    collectLocalFiles: vi.fn().mockResolvedValue({
      success: true,
      files: [
        {
          path: "/Users/test/local.txt",
          name: "local.txt",
          relativePath: "local.txt",
          size: 12,
          modified: "2026-07-20T00:00:00.000Z",
        },
      ],
    }),
    readLocalFile: vi.fn().mockResolvedValue({
      success: true,
      path: "/Users/test/local.txt",
      name: "local.txt",
      data: "aGVsbG8=",
    }),
  };

  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: electronAPI,
  });

  return electronAPI;
}

beforeEach(() => {
  api.getSSHHosts.mockResolvedValue([
    {
      id: 1,
      name: "prod",
      ip: "10.0.0.1",
      enableFileManager: true,
      connectionType: "ssh",
    },
  ]);
  api.ensureSSHSessionForHost.mockResolvedValue({
    state: "ready",
    sessionId: "session-1",
  });
  api.listSSHFiles.mockResolvedValue({
    path: "/srv",
    files: [{ name: "remote.txt", type: "file", size: 24 }],
  });
  api.browseSSHDirectory.mockResolvedValue({
    status: "ok",
    path: "/srv",
    files: [{ name: "remote.txt", type: "file", size: 24 }],
  });
  api.transferToHost.mockResolvedValue({ transferId: "transfer-1" });
  installElectronApi();
});

describe("SftpTransferTab context menus", () => {
  it("renames a local file from the row context menu", async () => {
    const electronAPI = installElectronApi();
    render(<SftpTransferTab />);

    fireEvent.contextMenu(await screen.findByText("local.txt"));
    await userEvent.click(screen.getByText("Rename"));
    const nameInput = screen.getByDisplayValue("local.txt");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "renamed.txt");
    await userEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(electronAPI.renameLocalPath).toHaveBeenCalledWith(
        "/Users/test/local.txt",
        "renamed.txt",
      );
    });
  });

  it("copies a source server file to the destination server pane", async () => {
    render(<SftpTransferTab />);

    await userEvent.click(screen.getByText("Server to Server"));
    const selects = await screen.findAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "1" } });
    fireEvent.change(selects[1], { target: { value: "1" } });

    const remoteRows = await screen.findAllByText("remote.txt");
    fireEvent.contextMenu(remoteRows[0]);
    await userEvent.click(screen.getByText("Copy to Target Directory"));

    await waitFor(() => {
      expect(api.transferToHost).toHaveBeenCalledWith(
        "session-1",
        ["/srv/remote.txt"],
        "session-1",
        "/srv",
        false,
        "auto",
        2,
      );
    });
  });
});
