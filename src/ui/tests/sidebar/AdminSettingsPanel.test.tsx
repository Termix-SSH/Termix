import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AdminSettingsPanel } from "../../sidebar/AdminSettingsPanel";
import type { AdminUser } from "../../sidebar/AdminManagementSections";

vi.mock("@/main-axios", () => ({
  getUserList: vi.fn(async () => ({ users: [], total: 0 })),
  getSessions: vi.fn(async () => ({ sessions: [] })),
  getRoles: vi.fn(async () => ({ roles: [] })),
  getApiKeys: vi.fn(async () => ({ apiKeys: [] })),
  getUserRoles: vi.fn(async () => ({ roles: [] })),
  isElectron: () => false,
}));

vi.mock("@/api/settings-api", () => ({}));
vi.mock("@/api/tls-api", () => ({ getTlsStatus: vi.fn(async () => null) }));
vi.mock("@/api/private-endpoints-api", () => ({}));

vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({ applyBranding: vi.fn() }),
}));

vi.mock("@/components/surface/surface-scope", () => ({
  useConfirm: () => vi.fn(async () => true),
}));

vi.mock("@/settings/FeatureSettingsSections", () => ({
  FeatureSettingsSection: () => null,
  featureSectionId: (id: string) => `feature:${id}`,
  useFeatureSettings: () => [],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { bob, section } = vi.hoisted(() => ({
  bob: {
    id: "u2",
    username: "bob",
    isAdmin: false,
    isExternal: false,
    passwordHash: "hash",
    dataUnlocked: true,
  } as AdminUser,
  section:
    (label: string) =>
    ({ open }: { open: boolean }) =>
      open ? <div>{label}</div> : null,
}));

vi.mock("../../sidebar/AdminManagementSections", () => ({
  AdminUsersSection: ({
    open,
    onManageUser,
  }: {
    open: boolean;
    onManageUser: (user: AdminUser) => void;
  }) =>
    open ? <button onClick={() => onManageUser(bob)}>manage bob</button> : null,
  AdminSessionsSection: section("sessions section"),
  AdminRolesSection: section("roles section"),
}));

vi.mock("../../sidebar/AdminSettingsSections", () => ({
  AdminGeneralSettingsSection: section("general section"),
  AdminHostDefaultsSection: section("host defaults section"),
  AdminDatabaseSection: section("database section"),
  AdminSSLSection: section("ssl section"),
}));

vi.mock("../../sidebar/AdminApiKeysSection", () => ({
  AdminApiKeysSection: section("api keys section"),
}));
vi.mock("../../sidebar/AdminAuditLogSection", () => ({
  AdminAuditLogSection: section("audit log section"),
}));
vi.mock("../../sidebar/AdminBrandingSection", () => ({
  AdminBrandingSection: section("branding section"),
}));
vi.mock("../../sidebar/AdminUserDialogs", () => ({
  AdminCreateUserDialog: () => null,
  AdminEditUserDialog: () => null,
  AdminLinkAccountDialog: () => null,
  AdminUnlinkAccountDialog: () => null,
}));
vi.mock("../../sidebar/AdminUserManagePanel", () => ({
  AdminUserManagePanel: ({ user }: { user: AdminUser }) => (
    <div>managing {user.username}</div>
  ),
}));

afterEach(cleanup);

describe("AdminSettingsPanel", () => {
  it("leaves the user manage view when another section is selected", async () => {
    const { rerender } = render(<AdminSettingsPanel section="users" />);

    await userEvent.click(screen.getByText("manage bob"));
    expect(screen.getByText("managing bob")).toBeTruthy();

    rerender(<AdminSettingsPanel section="sessions" />);

    expect(screen.getByText("sessions section")).toBeTruthy();
    expect(screen.queryByText("managing bob")).toBeNull();
  });
});
