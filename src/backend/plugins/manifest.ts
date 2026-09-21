/**
 * Runtime plugin manifest validation.
 *
 * This is a TypeScript port of scripts/validate-plugin-manifest.cjs. The two
 * are deliberately separate: the .cjs one is a build/authoring tool run from a
 * checkout, this one runs inside the server, where scripts/ does not exist
 * (the Docker image only ships dist/). Both enforce the same contract, which
 * is written down in scripts/plugin-manifest.schema.json.
 *
 * The enums below are duplicated from that schema rather than read from it at
 * runtime, for the same reason. If you change the schema, change both.
 */

import { isFirstParty, TRANSPORT_OWNER_CAPABILITY } from "./first-party.js";

export const PLUGIN_PERMISSIONS = [
  "hosts.read",
  "hosts.write",
  "credentials.use",
  "ssh.exec",
  "ssh.sftp",
  "storage.own",
  "storage.secrets",
  "network.outbound",
  "events.read",
  "notify.send",
  "users.read",
  "process.sidecar",
  // Reserved for first-party plugins. parseManifest refuses it for any id not
  // on the hardcoded allowlist in first-party.ts, so declaring it does not
  // grant it.
  "process:transport-owner",
  "ui.tab",
  "ui.rail",
  "ui.card",
  "ui.settings",
  "ui.palette",
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export const PLUGIN_CATEGORIES = [
  "Terminal",
  "Files & Transfer",
  "Infrastructure",
  "Monitoring",
  "Networking",
  "Access & Security",
  "Productivity",
] as const;

const OPEN_FROM_VALUES = ["rail", "host-context-menu", "palette"];

const REQUIRED_TOP_LEVEL = [
  "id",
  "name",
  "version",
  "description",
  "author",
  "license",
  "engine",
  "category",
  "capabilities",
  "permissions",
  "sidecars",
];

const ID_PATTERN = /^[a-z0-9-]+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?(\+[0-9A-Za-z-.]+)?$/;
const API_VERSION_PATTERN = /^[0-9]+$/;
const API_PREFIX_PATTERN = /^[a-z0-9-]+$/;

/**
 * The plugin SDK major version this build implements. A manifest asking for a
 * different engine.api is refused rather than loaded and hoped for -- this is
 * the real compatibility gate (engine.termix is informational only).
 */
export const SUPPORTED_PLUGIN_API_VERSION = "1";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: { name: string; url?: string };
  license: string;
  repository?: string;
  category: string;
  icon?: string;
  engine: { termix: string; api: string };
  capabilities: {
    backend: boolean;
    frontend: boolean;
    electron: boolean;
    platforms: string[];
  };
  permissions: string[];
  contributes?: {
    tabs?: Array<{
      id: string;
      titleKey: string;
      icon: string;
      openFrom: string[];
    }>;
    hostCapability?: { key: string; labelKey: string; editorTab: string };
    permissionGroup?: {
      group: string;
      permissions: string[];
      defaultForRole?: Record<string, string[]>;
    };
    settingsPanel?: { titleKey: string };
    dashboardCards?: Array<{ id: string; titleKey: string }>;
    apiPrefix?: string;
  };
  dependencies?: { plugins?: Record<string, string> };
  sidecars: Array<{ id: string; binary: string }>;
}

export function validateManifest(manifest: unknown): string[] {
  const errors: string[] = [];

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["Manifest must be a JSON object"];
  }

  const m = manifest as Record<string, unknown>;

  for (const field of REQUIRED_TOP_LEVEL) {
    if (!(field in m)) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  if (typeof m.id === "string" && !ID_PATTERN.test(m.id)) {
    errors.push(`Field "id" must match ${ID_PATTERN}, got: "${m.id}"`);
  }

  if (typeof m.version === "string" && !SEMVER_PATTERN.test(m.version)) {
    errors.push(`Field "version" must be valid semver, got: "${m.version}"`);
  }

  if (m.author && typeof m.author === "object") {
    if (!(m.author as Record<string, unknown>).name) {
      errors.push('Field "author.name" is required');
    }
  }

  if (typeof m.category === "string") {
    if (!PLUGIN_CATEGORIES.includes(m.category as never)) {
      errors.push(
        `Field "category" must be one of: ${PLUGIN_CATEGORIES.join(", ")}, got: "${m.category}"`,
      );
    }
  } else if ("category" in m) {
    errors.push('Field "category" must be a string');
  }

  if ("icon" in m && typeof m.icon !== "string") {
    errors.push('Field "icon" must be a string');
  }

  if (m.engine && typeof m.engine === "object") {
    const engine = m.engine as Record<string, unknown>;
    if (!engine.termix) {
      errors.push('Field "engine.termix" is required');
    }
    if (!API_VERSION_PATTERN.test(String(engine.api))) {
      errors.push(
        `Field "engine.api" must be an integer-as-string, got: "${engine.api}"`,
      );
    }
  }

  if (m.capabilities && typeof m.capabilities === "object") {
    const caps = m.capabilities as Record<string, unknown>;
    for (const field of ["backend", "frontend", "electron"]) {
      if (typeof caps[field] !== "boolean") {
        errors.push(`Field "capabilities.${field}" must be a boolean`);
      }
    }
    if (!Array.isArray(caps.platforms)) {
      errors.push('Field "capabilities.platforms" must be an array');
    }
  }

  if (Array.isArray(m.permissions)) {
    for (const permission of m.permissions) {
      if (!PLUGIN_PERMISSIONS.includes(permission as never)) {
        errors.push(
          `Unknown permission: "${permission}". Known values: ${PLUGIN_PERMISSIONS.join(", ")}`,
        );
      }
    }
  } else if ("permissions" in m) {
    errors.push('Field "permissions" must be an array');
  }

  if (Array.isArray(m.sidecars)) {
    m.sidecars.forEach((sidecar: unknown, index: number) => {
      if (!sidecar || typeof sidecar !== "object") {
        errors.push(`sidecars[${index}] must be an object`);
        return;
      }
      const s = sidecar as Record<string, unknown>;
      if (!s.id) errors.push(`sidecars[${index}].id is required`);
      if (!s.binary) errors.push(`sidecars[${index}].binary is required`);
    });
  } else if ("sidecars" in m) {
    errors.push('Field "sidecars" must be an array');
  }

  if (m.contributes && typeof m.contributes === "object") {
    errors.push(
      ...validateContributes(m.contributes as Record<string, unknown>),
    );
  }

  return errors;
}

function validateContributes(contributes: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if ("tabs" in contributes) {
    if (!Array.isArray(contributes.tabs)) {
      errors.push('Field "contributes.tabs" must be an array');
    } else {
      contributes.tabs.forEach((tab: unknown, index: number) => {
        const t = (tab ?? {}) as Record<string, unknown>;
        for (const field of ["id", "titleKey", "icon", "openFrom"]) {
          if (!(field in t)) {
            errors.push(`contributes.tabs[${index}].${field} is required`);
          }
        }
        if (Array.isArray(t.openFrom)) {
          for (const value of t.openFrom) {
            if (!OPEN_FROM_VALUES.includes(value as string)) {
              errors.push(
                `contributes.tabs[${index}].openFrom has unknown value: "${value}"`,
              );
            }
          }
        }
      });
    }
  }

  if ("hostCapability" in contributes) {
    const hostCapability = (contributes.hostCapability ?? {}) as Record<
      string,
      unknown
    >;
    for (const field of ["key", "labelKey", "editorTab"]) {
      if (!(field in hostCapability)) {
        errors.push(`contributes.hostCapability.${field} is required`);
      }
    }
  }

  if ("permissionGroup" in contributes) {
    const group = (contributes.permissionGroup ?? {}) as Record<
      string,
      unknown
    >;
    if (!group.group) {
      errors.push("contributes.permissionGroup.group is required");
    }
    if (!Array.isArray(group.permissions) || group.permissions.length === 0) {
      errors.push(
        "contributes.permissionGroup.permissions must be a non-empty array",
      );
    }
  }

  if ("settingsPanel" in contributes) {
    const panel = (contributes.settingsPanel ?? {}) as Record<string, unknown>;
    if (!panel.titleKey) {
      errors.push("contributes.settingsPanel.titleKey is required");
    }
  }

  if ("dashboardCards" in contributes) {
    if (!Array.isArray(contributes.dashboardCards)) {
      errors.push('Field "contributes.dashboardCards" must be an array');
    } else {
      contributes.dashboardCards.forEach((card: unknown, index: number) => {
        const c = (card ?? {}) as Record<string, unknown>;
        for (const field of ["id", "titleKey"]) {
          if (!(field in c)) {
            errors.push(
              `contributes.dashboardCards[${index}].${field} is required`,
            );
          }
        }
      });
    }
  }

  if ("apiPrefix" in contributes) {
    if (
      typeof contributes.apiPrefix !== "string" ||
      !API_PREFIX_PATTERN.test(contributes.apiPrefix)
    ) {
      errors.push(
        `Field "contributes.apiPrefix" must match ${API_PREFIX_PATTERN}`,
      );
    }
  }

  return errors;
}

/**
 * Validates and narrows in one step. Unlike validateManifest, this also
 * enforces the SDK compatibility gate, which only the runtime cares about --
 * the authoring-time validator has no single Termix build to check against.
 */
export function parseManifest(raw: unknown): {
  manifest?: PluginManifest;
  errors: string[];
} {
  const errors = validateManifest(raw);
  if (errors.length > 0) return { errors };

  const manifest = raw as PluginManifest;
  if (manifest.engine.api !== SUPPORTED_PLUGIN_API_VERSION) {
    return {
      errors: [
        `Plugin targets SDK api version "${manifest.engine.api}", this Termix build implements "${SUPPORTED_PLUGIN_API_VERSION}"`,
      ],
    };
  }

  // Refused outright rather than ignored: a plugin that asked to run in-process
  // and was quietly downgraded to a worker would fail later in a confusing way,
  // and the manifest would still claim reach it does not have.
  if (
    manifest.permissions.includes(TRANSPORT_OWNER_CAPABILITY) &&
    !isFirstParty(manifest.id)
  ) {
    return {
      errors: [
        `Permission "${TRANSPORT_OWNER_CAPABILITY}" is reserved for first-party plugins and cannot be declared by "${manifest.id}"`,
      ],
    };
  }

  return { manifest, errors: [] };
}
