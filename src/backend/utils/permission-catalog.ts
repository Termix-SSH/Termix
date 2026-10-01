// Single source of truth for role permission strings. The admin role editor
// renders this catalog and PUT /rbac/roles/:id validates against it;
// PermissionManager.hasPermission resolves wildcards ("*", "<group>.*").
export interface PermissionCatalogItem {
  permission: string;
  /** Plugin-relative i18n keys; the frontend resolves them per plugin. */
  titleKey: string;
  descriptionKey: string;
}

export interface PermissionCatalogEntry {
  group: string;
  permissions: string[];
  /** Set for a group a plugin contributed. */
  pluginId?: string;
  /** Core groups carry an i18n key, plugin groups their display name. */
  labelKey?: string;
  label?: string;
  icon?: string;
  /** False once the owning plugin is disabled or gone. */
  enabled?: boolean;
  items?: PermissionCatalogItem[];
}

export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  {
    group: "hosts",
    labelKey: "admin.rolePermissions.groups.hosts",
    permissions: [
      "hosts.view",
      "hosts.create",
      "hosts.edit",
      "hosts.delete",
      "hosts.share",
    ],
  },
  {
    group: "credentials",
    labelKey: "admin.rolePermissions.groups.credentials",
    permissions: [
      "credentials.view",
      "credentials.create",
      "credentials.edit",
      "credentials.delete",
      "credentials.share",
    ],
  },
  {
    group: "admin",
    labelKey: "admin.rolePermissions.groups.admin",
    permissions: [
      "admin.users.view",
      "admin.users.manage",
      "admin.roles.manage",
      "admin.settings.manage",
      "admin.sessions.manage",
      "admin.plugins.manage",
    ],
  },
];

// Groups registered at runtime by plugins. Kept separate from the static
// catalog so plugin state never mutates the built-in array.
const pluginPermissionGroups = new Map<string, PermissionCatalogEntry>();

/**
 * Every permission string core has ever registered, loaded from
 * rbac_known_permissions at boot.
 *
 * This is what lets a role keep a plugin's permission while that plugin is
 * disabled or uninstalled. Without it, unregistering a group made
 * PUT /rbac/roles/:id reject the whole role, so an admin could not save an
 * unrelated change to any role that still held one.
 */
const knownPermissions = new Set<string>();
const knownGroups = new Set<string>();

let validPermissionsCache: Set<string> | null = null;

function buildValidPermissions(): Set<string> {
  const valid = new Set<string>(["*"]);
  for (const entry of [
    ...PERMISSION_CATALOG,
    ...pluginPermissionGroups.values(),
  ]) {
    valid.add(`${entry.group}.*`);
    for (const permission of entry.permissions) valid.add(permission);
  }
  for (const permission of knownPermissions) valid.add(permission);
  for (const group of knownGroups) valid.add(`${group}.*`);
  return valid;
}

function getValidPermissions(): Set<string> {
  if (!validPermissionsCache) {
    validPermissionsCache = buildValidPermissions();
  }
  return validPermissionsCache;
}

/** Records permissions as known, so they stay valid without the plugin. */
export function rememberPermissions(permissions: Iterable<string>): void {
  for (const permission of permissions) {
    knownPermissions.add(permission);
    const group = permission.split(".")[0];
    if (group) knownGroups.add(group);
  }
  validPermissionsCache = null;
}

/**
 * Records a group as known without naming a permission in it.
 *
 * A role can hold only "ai.*", with no concrete ai permission anywhere, and it
 * still has to keep saving while the plugin is off.
 */
export function rememberPermissionGroup(group: string): void {
  if (!group) return;
  knownGroups.add(group);
  validPermissionsCache = null;
}

/** Seeds the known set at boot, before any request is served. */
export function loadKnownPermissions(permissions: Iterable<string>): void {
  rememberPermissions(permissions);
}

export function registerPluginPermissions(entry: PermissionCatalogEntry): void {
  pluginPermissionGroups.set(entry.group, { ...entry, enabled: true });
  rememberPermissions(entry.permissions);
}

/**
 * Marks a plugin's group disabled without removing it.
 *
 * The permissions stay valid, because a role that holds one is not wrong just
 * because the plugin is off. The editor greys the group instead.
 */
export function markPluginPermissionsDisabled(pluginId: string): void {
  for (const [group, entry] of pluginPermissionGroups) {
    if (entry.pluginId !== pluginId) continue;
    pluginPermissionGroups.set(group, { ...entry, enabled: false });
  }
  validPermissionsCache = null;
}

// Static entries plus any groups registered at runtime.
export function getPermissionCatalog(): PermissionCatalogEntry[] {
  return [...PERMISSION_CATALOG, ...pluginPermissionGroups.values()];
}

export function isValidPermission(permission: string): boolean {
  return getValidPermissions().has(permission);
}

/** Test seam. */
export function resetPermissionCatalog(): void {
  pluginPermissionGroups.clear();
  knownPermissions.clear();
  knownGroups.clear();
  validPermissionsCache = null;
}

// What the seeded system roles grant. Applied only to a role row that has no
// permissions yet, so an admin's edits to these roles survive restarts.
// Plugin permissions are not listed here; a plugin asks for its own defaults
// through contributes.permissions[].defaultRoles.
export const SYSTEM_ROLE_DEFAULTS = {
  admin: {
    description: "Administrator with full access",
    permissions: ["*"],
  },
  user: {
    description: "Regular user",
    permissions: ["hosts.*", "credentials.*"],
  },
} as const;
