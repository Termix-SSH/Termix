// Single source of truth for role permission strings. The admin role editor
// renders this catalog and PUT /rbac/roles/:id validates against it;
// PermissionManager.hasPermission resolves wildcards ("*", "<group>.*").
export interface PermissionCatalogEntry {
  group: string;
  permissions: string[];
}

export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  {
    group: "hosts",
    permissions: [
      "hosts.view",
      "hosts.create",
      "hosts.edit",
      "hosts.delete",
      "hosts.share",
    ],
  },
  {
    group: "snippets",
    permissions: [
      "snippets.view",
      "snippets.create",
      "snippets.edit",
      "snippets.delete",
      "snippets.share",
    ],
  },
  {
    group: "credentials",
    permissions: [
      "credentials.view",
      "credentials.create",
      "credentials.edit",
      "credentials.delete",
    ],
  },
  {
    group: "admin",
    permissions: [
      "admin.users.view",
      "admin.users.manage",
      "admin.roles.manage",
      "admin.settings.manage",
      "admin.sessions.manage",
    ],
  },
];

const VALID_PERMISSIONS = new Set<string>(
  PERMISSION_CATALOG.flatMap((entry) => [
    ...entry.permissions,
    `${entry.group}.*`,
  ]).concat("*"),
);

export function isValidPermission(permission: string): boolean {
  return VALID_PERMISSIONS.has(permission);
}
