import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AdminUserManagePanel } from "../../sidebar/AdminUserManagePanel";
import type { AdminUser } from "../../sidebar/AdminManagementSections";

const api = vi.hoisted(() => ({
  adminGetUserHosts: vi.fn(async () => [] as unknown[]),
  adminDeleteUserHost: vi.fn(async () => ({})),
  adminGetUserCredentials: vi.fn(async () => [] as unknown[]),
  adminDeleteUserCredential: vi.fn(async () => ({})),
  adminGetUserSnippets: vi.fn(async () => [] as unknown[]),
  adminCreateUserSnippet: vi.fn(async () => ({})),
  adminUpdateUserSnippet: vi.fn(async () => ({})),
  adminDeleteUserSnippet: vi.fn(async () => ({})),
  adminResetUserPassword: vi.fn(async () => ({ dataWiped: false })),
  adminDisableUserTotp: vi.fn(async () => ({})),
  adminExportUserData: vi.fn(async () => ({})),
  getSessions: vi.fn(async () => ({ sessions: [] as unknown[] })),
  revokeSession: vi.fn(async () => ({})),
  revokeAllUserSessions: vi.fn(async () => ({})),
  getApiKeys: vi.fn(async () => ({ apiKeys: [] as unknown[] })),
  createApiKey: vi.fn(async () => ({})),
  deleteApiKey: vi.fn(async () => ({})),
  deleteUser: vi.fn(async () => ({})),
  getUserRoles: vi.fn(async () => ({ roles: [] as unknown[] })),
  assignRoleToUser: vi.fn(async () => ({})),
  removeRoleFromUser: vi.fn(async () => ({})),
}));

vi.mock("@/main-axios", () => api);

vi.mock("../../sidebar/HostEditor", () => ({
  HostEditor: () => <div data-testid="host-editor" />,
}));

vi.mock("../../sidebar/CredentialEditorView", () => ({
  CredentialEditorView: () => <div data-testid="credential-editor" />,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "u2",
    username: "bob",
    isAdmin: false,
    isOidc: false,
    passwordHash: "hash",
    dataUnlocked: true,
    totpEnabled: false,
    ...overrides,
  };
}

function renderPanel(
  user: AdminUser,
  callbacks: Partial<Record<string, () => void>> = {},
) {
  return render(
    <AdminUserManagePanel
      user={user}
      roles={[]}
      onBack={callbacks.onBack ?? vi.fn()}
      onOpenHostTab={callbacks.onOpenHostTab as never}
      onUserDeleted={callbacks.onUserDeleted ?? vi.fn()}
      onTotpDisabled={callbacks.onTotpDisabled ?? vi.fn()}
    />,
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockClear();
});

describe("AdminUserManagePanel", () => {
  it("renders all manage tabs and loads the target user's data", async () => {
    renderPanel(makeUser());

    for (const tab of [
      "admin.manageTabAccount",
      "admin.manageTabHosts",
      "admin.manageTabCredentials",
      "admin.manageTabSnippets",
      "admin.manageTabSessions",
      "admin.manageTabDanger",
    ]) {
      expect(screen.getByText(tab)).toBeTruthy();
    }

    await waitFor(() => {
      expect(api.adminGetUserHosts).toHaveBeenCalledWith("u2");
      expect(api.adminGetUserCredentials).toHaveBeenCalledWith("u2");
      expect(api.adminGetUserSnippets).toHaveBeenCalledWith("u2");
      expect(api.getUserRoles).toHaveBeenCalledWith("u2");
    });
  });

  it("skips data fetches and shows the locked notice when data is locked", async () => {
    renderPanel(makeUser({ dataUnlocked: false }));

    expect(screen.getByText("admin.dataLockedBadge")).toBeTruthy();

    await userEvent.click(screen.getByText("admin.manageTabHosts"));
    expect(screen.getByText("admin.dataLockedNotice")).toBeTruthy();
    expect(screen.queryByText("admin.addHostForUser")).toBeNull();

    expect(api.adminGetUserHosts).not.toHaveBeenCalled();
    expect(api.adminGetUserCredentials).not.toHaveBeenCalled();
    expect(api.adminGetUserSnippets).not.toHaveBeenCalled();
  });

  it("lists the user's hosts and opens a tab via the connect button", async () => {
    api.adminGetUserHosts.mockResolvedValueOnce([
      {
        id: 7,
        name: "web-01",
        username: "root",
        ip: "10.0.0.5",
        port: 22,
        authType: "password",
        connectionType: "ssh",
      },
    ]);
    const onOpenHostTab = vi.fn();
    renderPanel(makeUser(), { onOpenHostTab });

    await userEvent.click(screen.getByText("admin.manageTabHosts"));
    await screen.findByText("web-01");

    await userEvent.click(screen.getByTitle("admin.connectToHost"));
    expect(onOpenHostTab).toHaveBeenCalledTimes(1);
    expect(onOpenHostTab.mock.calls[0][0]).toMatchObject({
      id: "7",
      ip: "10.0.0.5",
    });
  });

  it("disables TOTP through the confirm dialog", async () => {
    const onTotpDisabled = vi.fn();
    renderPanel(makeUser({ totpEnabled: true }), { onTotpDisabled });

    expect(screen.getByText("admin.totpStatusEnabled")).toBeTruthy();
    await userEvent.click(screen.getByText("admin.disableTotp"));
    await userEvent.click(screen.getByText("common.confirm"));

    await waitFor(() => {
      expect(api.adminDisableUserTotp).toHaveBeenCalledWith("u2");
      expect(onTotpDisabled).toHaveBeenCalled();
    });
    expect(screen.getByText("admin.totpStatusDisabled")).toBeTruthy();
  });

  it("creates a snippet for the target user", async () => {
    renderPanel(makeUser());

    await userEvent.click(screen.getByText("admin.manageTabSnippets"));
    await userEvent.click(screen.getByText("admin.addSnippetForUser"));
    await userEvent.type(
      screen.getByPlaceholderText("admin.snippetNamePlaceholder"),
      "restart",
    );
    await userEvent.type(
      screen.getByPlaceholderText("admin.snippetContentPlaceholder"),
      "systemctl restart nginx",
    );
    await userEvent.click(screen.getByText("common.save"));

    await waitFor(() => {
      expect(api.adminCreateUserSnippet).toHaveBeenCalledWith("u2", {
        name: "restart",
        content: "systemctl restart nginx",
        folder: null,
      });
    });
  });

  it("deletes the user from the danger tab after confirmation", async () => {
    const onUserDeleted = vi.fn();
    renderPanel(makeUser(), { onUserDeleted });

    await userEvent.click(screen.getByText("admin.manageTabDanger"));
    await userEvent.click(screen.getByText("admin.deleteUser"));
    await userEvent.click(screen.getByText("common.confirm"));

    await waitFor(() => {
      expect(api.deleteUser).toHaveBeenCalledWith("bob");
      expect(onUserDeleted).toHaveBeenCalled();
    });
  });

  it("blocks deleting admin accounts", async () => {
    renderPanel(makeUser({ isAdmin: true }));

    await userEvent.click(screen.getByText("admin.manageTabDanger"));
    const deleteBtn = screen
      .getByText("admin.deleteUser")
      .closest("button") as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(true);
    expect(screen.getByText("admin.deleteUserAdminBlocked")).toBeTruthy();
  });
});
