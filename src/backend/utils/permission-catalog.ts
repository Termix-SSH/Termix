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
    group: "automations",
    permissions: [
      "automations.view",
      "automations.create",
      "automations.edit",
      "automations.delete",
      "automations.run",
    ],
  },
  {
    group: "credentials",
    permissions: [
      "credentials.view",
      "credentials.create",
      "credentials.edit",
      "credentials.delete",
      "credentials.share",
    ],
  },
  {
    group: "ai",
    permissions: ["ai.use", "ai.manage_providers", "ai.apply_proposals"],
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

// Groups registered at runtime, e.g. by plugins. Kept separate from the
// static catalog so plugin state never mutates the built-in array.
const runtimePermissionGroups = new Map<string, PermissionCatalogEntry>();

let validPermissionsCache: Set<string> | null = null;

function buildValidPermissions(): Set<string> {
  return new Set<string>(
    [...PERMISSION_CATALOG, ...runtimePermissionGroups.values()]
      .flatMap((entry) => [...entry.permissions, `${entry.group}.*`])
      .concat("*"),
  );
}

function getValidPermissions(): Set<string> {
  if (!validPermissionsCache) {
    validPermissionsCache = buildValidPermissions();
  }
  return validPermissionsCache;
}

export function registerPermissionGroup(entry: PermissionCatalogEntry): void {
  runtimePermissionGroups.set(entry.group, entry);
  validPermissionsCache = null;
}

export function unregisterPermissionGroup(group: string): void {
  runtimePermissionGroups.delete(group);
  validPermissionsCache = null;
}

// Static entries plus any groups registered at runtime.
export function getPermissionCatalog(): PermissionCatalogEntry[] {
  return [...PERMISSION_CATALOG, ...runtimePermissionGroups.values()];
}

export function isValidPermission(permission: string): boolean {
  return getValidPermissions().has(permission);
}

// What the seeded system roles grant. Applied only to a role row that has no
// permissions yet, so an admin's edits to these roles survive restarts.
export const SYSTEM_ROLE_DEFAULTS = {
  admin: {
    description: "Administrator with full access",
    permissions: ["*"],
  },
  user: {
    description: "Regular user",
    permissions: [
      "hosts.*",
      "snippets.*",
      "automations.*",
      "credentials.*",
      "ai.*",
    ],
  },
} as const;
