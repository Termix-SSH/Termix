/**
 * The role editor's permission catalog: plugin grouping, the disabled state,
 * and what actually gets saved.
 *
 * The behaviour that matters is that a disabled plugin's permission stays
 * ticked and stays in the payload. Dropping it would silently revoke a grant
 * just because the plugin happened to be off.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AdminRolesSection } from "../../sidebar/AdminManagementSections";
import type { PermissionCatalogEntry, Role } from "../../main-axios";

const api = vi.hoisted(() => ({
  getPermissionsCatalog: vi.fn(),
  updateRole: vi.fn(
    async (_roleId: number, _update: { permissions?: string[] }) => ({}),
  ),
  deleteRole: vi.fn(async () => ({})),
  getRoleMembers: vi.fn(async () => ({ members: [] as unknown[] })),
  getSessions: vi.fn(async () => ({ sessions: [] as unknown[] })),
  revokeSession: vi.fn(async () => ({})),
}));

vi.mock("@/main-axios", () => api);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const CATALOG: PermissionCatalogEntry[] = [
  {
    group: "hosts",
    labelKey: "admin.rolePermissions.groups.hosts",
    permissions: ["hosts.view", "hosts.create"],
  },
  {
    group: "ai",
    pluginId: "ai",
    label: "AI Assistant",
    icon: "Sparkles",
    enabled: false,
    permissions: ["ai.use"],
    items: [
      {
        permission: "ai.use",
        titleKey: "permissions.use.title",
        descriptionKey: "permissions.use.description",
      },
    ],
  },
  {
    group: "automations",
    pluginId: "automations",
    label: "Automations",
    icon: "Workflow",
    enabled: true,
    permissions: ["automations.run"],
    items: [
      {
        permission: "automations.run",
        titleKey: "permissions.run.title",
        descriptionKey: "permissions.run.description",
      },
    ],
  },
];

function makeRole(permissions: string[]): Role {
  return {
    id: 7,
    name: "operators",
    displayName: "Operators",
    description: null,
    isSystem: false,
    permissions,
    createdAt: "",
    updatedAt: "",
  };
}

function renderSection(role: Role) {
  return render(
    <AdminRolesSection
      open
      onToggle={() => {}}
      roles={[role]}
      setRoles={() => {}}
      showCreateRole={false}
      setShowCreateRole={() => {}}
      newRoleName=""
      setNewRoleName={() => {}}
      newRoleDisplayName=""
      setNewRoleDisplayName={() => {}}
      newRoleDescription=""
      setNewRoleDescription={() => {}}
      handleCreateRole={() => {}}
      createRoleLoading={false}
    />,
  );
}

async function openEditor(role: Role) {
  const user = userEvent.setup();
  renderSection(role);

  await user.click(
    screen.getByRole("button", { name: /admin.rolePermissions.editAction/i }),
  );
  await waitFor(() => expect(api.getPermissionsCatalog).toHaveBeenCalled());
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getPermissionsCatalog.mockResolvedValue({ catalog: CATALOG });
});

describe("role permission groups", () => {
  it("labels a core group by its i18n key, not the raw wildcard", async () => {
    await openEditor(makeRole([]));

    expect(screen.getByText("admin.rolePermissions.groups.hosts")).toBeTruthy();
    expect(screen.queryByText("hosts.*")).toBeNull();
  });

  it("labels a plugin group with the plugin's display name", async () => {
    await openEditor(makeRole([]));

    expect(screen.getByText("AI Assistant")).toBeTruthy();
    expect(screen.getByText("Automations")).toBeTruthy();
  });

  it("shows a plugin permission's title beside its raw id", async () => {
    await openEditor(makeRole([]));

    expect(screen.getByText("automations:permissions.run.title")).toBeTruthy();
    expect(screen.getByText("automations.run")).toBeTruthy();
  });

  it("marks a disabled plugin's group", async () => {
    await openEditor(makeRole([]));

    expect(
      screen.getByText("admin.rolePermissions.pluginDisabled"),
    ).toBeTruthy();
  });

  it("does not mark an enabled plugin's group", async () => {
    await openEditor(makeRole([]));

    expect(
      screen.getAllByText("admin.rolePermissions.pluginDisabled"),
    ).toHaveLength(1);
  });

  it("lists a group once per catalog entry", async () => {
    await openEditor(makeRole([]));

    expect(screen.getAllByText("AI Assistant")).toHaveLength(1);
  });
});

describe("saving a role", () => {
  // The regression A5 fixes: the permission must survive the round trip even
  // though its plugin is disabled.
  it("keeps a disabled plugin's permission in the payload", async () => {
    const role = makeRole(["hosts.view", "ai.use"]);
    const user = await openEditor(role);

    await user.click(
      screen.getByRole("button", { name: /admin.rolePermissions.save/i }),
    );

    await waitFor(() => expect(api.updateRole).toHaveBeenCalled());
    const [, payload] = api.updateRole.mock.calls[0];
    expect(payload.permissions).toContain("ai.use");
    expect(payload.permissions).toContain("hosts.view");
  });

  it("still lets a disabled plugin's permission be revoked deliberately", async () => {
    const role = makeRole(["hosts.view", "ai.use"]);
    const user = await openEditor(role);

    await user.click(screen.getByText("ai.use"));
    await user.click(
      screen.getByRole("button", { name: /admin.rolePermissions.save/i }),
    );

    await waitFor(() => expect(api.updateRole).toHaveBeenCalled());
    const [, payload] = api.updateRole.mock.calls[0];
    expect(payload.permissions).not.toContain("ai.use");
    expect(payload.permissions).toContain("hosts.view");
  });
});
