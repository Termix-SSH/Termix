/**
 * Validates a plugin manifest.json against scripts/plugin-manifest.schema.json.
 *
 * Hand-rolled rather than pulling in ajv: the schema is small and the checks
 * that matter (required fields, id pattern, semver, known permissions) are a
 * handful of straightforward comparisons.
 *
 * Usage: node scripts/validate-plugin-manifest.cjs <path-to-manifest.json>
 */

const fs = require("fs");
const path = require("path");
const semver = require("semver");

const SCHEMA_PATH = path.join(__dirname, "plugin-manifest.schema.json");

const ID_PATTERN = /^[a-z0-9-]+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?(\+[0-9A-Za-z-.]+)?$/;
const API_VERSION_PATTERN = /^[0-9]+$/;
const SERVICE_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const SECRET_KEY_PATTERN = /^[a-z0-9-]+$/;
// Dotted like a service name, but segments may be camelCase: these name a
// frontend function ("ai.openWithContext"), not a lowercase service contract.
const ACTION_ID_PATTERN = /^[a-z0-9-]+(\.[a-zA-Z0-9-]+)+$/;
const HANDLER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const OPEN_FROM_VALUES = ["rail", "host-context-menu", "palette"];
const ACTION_CONTRIBUTION_KINDS = ["button"];

function loadSchema() {
  const raw = fs.readFileSync(SCHEMA_PATH, "utf8");
  return JSON.parse(raw);
}

function knownPermissions(schema) {
  return schema.properties.permissions.items.enum;
}

function knownCategories(schema) {
  return schema.properties.category.enum;
}

function validateManifest(manifest, schema) {
  const errors = [];

  const requiredTopLevel = schema.required;
  for (const field of requiredTopLevel) {
    if (!(field in manifest)) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  if (typeof manifest.id === "string" && !ID_PATTERN.test(manifest.id)) {
    errors.push(`Field "id" must match ${ID_PATTERN}, got: "${manifest.id}"`);
  }

  if (
    typeof manifest.version === "string" &&
    !SEMVER_PATTERN.test(manifest.version)
  ) {
    errors.push(
      `Field "version" must be valid semver, got: "${manifest.version}"`,
    );
  }

  if (manifest.author && typeof manifest.author === "object") {
    if (!manifest.author.name) {
      errors.push('Field "author.name" is required');
    }
  }

  if (typeof manifest.category === "string") {
    const categories = knownCategories(schema);
    if (!categories.includes(manifest.category)) {
      errors.push(
        `Field "category" must be one of: ${categories.join(", ")}, got: "${manifest.category}"`,
      );
    }
  } else if ("category" in manifest) {
    errors.push('Field "category" must be a string');
  }

  if ("icon" in manifest && typeof manifest.icon !== "string") {
    errors.push('Field "icon" must be a string');
  }

  if (manifest.engine && typeof manifest.engine === "object") {
    if (!manifest.engine.termix) {
      errors.push('Field "engine.termix" is required');
    }
    if (!API_VERSION_PATTERN.test(String(manifest.engine.api))) {
      errors.push(
        `Field "engine.api" must be an integer-as-string, got: "${manifest.engine.api}"`,
      );
    }
  }

  if (manifest.capabilities && typeof manifest.capabilities === "object") {
    for (const field of ["backend", "frontend", "electron"]) {
      if (typeof manifest.capabilities[field] !== "boolean") {
        errors.push(`Field "capabilities.${field}" must be a boolean`);
      }
    }
    if (!Array.isArray(manifest.capabilities.platforms)) {
      errors.push('Field "capabilities.platforms" must be an array');
    }
  }

  const known = knownPermissions(schema);
  if (Array.isArray(manifest.permissions)) {
    for (const permission of manifest.permissions) {
      if (!known.includes(permission)) {
        errors.push(
          `Unknown permission: "${permission}". Known values: ${known.join(", ")}`,
        );
      }
    }
  } else if ("permissions" in manifest) {
    errors.push('Field "permissions" must be an array');
  }

  if (Array.isArray(manifest.sidecars)) {
    manifest.sidecars.forEach((sidecar, index) => {
      if (!sidecar || typeof sidecar !== "object") {
        errors.push(`sidecars[${index}] must be an object`);
        return;
      }
      if (!sidecar.id) errors.push(`sidecars[${index}].id is required`);
      if (!sidecar.binary) errors.push(`sidecars[${index}].binary is required`);
    });
  } else if ("sidecars" in manifest) {
    errors.push('Field "sidecars" must be an array');
  }

  errors.push(...validateProvides(manifest.provides));
  errors.push(...validateRequires(manifest.requires));
  errors.push(...validateProvidesSecret(manifest.providesSecret));
  errors.push(...validateRequiresSecret(manifest.requiresSecret));

  if (manifest.contributes && typeof manifest.contributes === "object") {
    errors.push(...validateContributes(manifest.contributes));
  }

  // A service permission has to be one the plugin's own permissionGroup
  // declares, or no admin could ever grant it.
  const declared = manifest.contributes?.permissionGroup?.permissions;
  if (Array.isArray(manifest.provides) && Array.isArray(declared)) {
    for (const entry of manifest.provides) {
      if (entry && entry.permission && !declared.includes(entry.permission)) {
        errors.push(
          `Service "${entry.service}" is gated by "${entry.permission}", which is not declared in contributes.permissionGroup.permissions`,
        );
      }
    }
  }

  // Same rule for a shared secret: sharing rides on the provider's own RBAC
  // permission rather than a separate grant mechanism.
  if (Array.isArray(manifest.providesSecret) && Array.isArray(declared)) {
    for (const entry of manifest.providesSecret) {
      if (entry && entry.permission && !declared.includes(entry.permission)) {
        errors.push(
          `Secret "${entry.key}" is gated by "${entry.permission}", which is not declared in contributes.permissionGroup.permissions`,
        );
      }
    }
  }

  if (Array.isArray(manifest.requiresSecret)) {
    for (const entry of manifest.requiresSecret) {
      if (entry && entry.plugin && entry.plugin === manifest.id) {
        errors.push(
          `requiresSecret entry for "${entry.key}" names this plugin itself; use ctx.secrets.get instead`,
        );
      }
    }
  }

  // Same rule for UI actions: a permission the catalog never sees is one no
  // admin can grant, so the action would be invisible rather than denied.
  const actions = manifest.contributes?.actions;
  if (Array.isArray(actions)) {
    for (const action of actions) {
      if (!action || !action.permission) continue;
      if (!Array.isArray(declared) || !declared.includes(action.permission)) {
        errors.push(
          `Action "${action.id}" is gated by "${action.permission}", which is not declared in contributes.permissionGroup.permissions`,
        );
      }
    }
  }

  return errors;
}

function validateProvides(provides) {
  if (provides === undefined) return [];
  if (!Array.isArray(provides)) return ['Field "provides" must be an array'];

  const errors = [];
  const seen = new Set();

  provides.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`provides[${index}] must be an object`);
      return;
    }

    if (
      typeof entry.service !== "string" ||
      !SERVICE_PATTERN.test(entry.service)
    ) {
      errors.push(
        `provides[${index}].service must match ${SERVICE_PATTERN}, got: "${entry.service}"`,
      );
    } else if (seen.has(entry.service)) {
      errors.push(
        `provides[${index}].service is a duplicate: "${entry.service}"`,
      );
    } else {
      seen.add(entry.service);
    }

    if (
      typeof entry.version !== "string" ||
      !SEMVER_PATTERN.test(entry.version)
    ) {
      errors.push(
        `provides[${index}].version must be valid semver, got: "${entry.version}"`,
      );
    }

    if (typeof entry.permission !== "string" || entry.permission.length === 0) {
      errors.push(`provides[${index}].permission is required`);
    }
  });

  return errors;
}

function validateRequires(requires) {
  if (requires === undefined) return [];
  if (!Array.isArray(requires)) return ['Field "requires" must be an array'];

  const errors = [];
  const seen = new Set();

  requires.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`requires[${index}] must be an object`);
      return;
    }

    if (
      typeof entry.service !== "string" ||
      !SERVICE_PATTERN.test(entry.service)
    ) {
      errors.push(
        `requires[${index}].service must match ${SERVICE_PATTERN}, got: "${entry.service}"`,
      );
    } else if (seen.has(entry.service)) {
      errors.push(
        `requires[${index}].service is a duplicate: "${entry.service}"`,
      );
    } else {
      seen.add(entry.service);
    }

    if (
      typeof entry.versionRange !== "string" ||
      semver.validRange(entry.versionRange) === null
    ) {
      errors.push(
        `requires[${index}].versionRange must be a valid semver range, got: "${entry.versionRange}"`,
      );
    }

    if ("optional" in entry && typeof entry.optional !== "boolean") {
      errors.push(`requires[${index}].optional must be a boolean`);
    }
  });

  return errors;
}

function validateProvidesSecret(providesSecret) {
  if (providesSecret === undefined) return [];
  if (!Array.isArray(providesSecret)) {
    return ['Field "providesSecret" must be an array'];
  }

  const errors = [];
  const seen = new Set();

  providesSecret.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`providesSecret[${index}] must be an object`);
      return;
    }

    if (typeof entry.key !== "string" || !SECRET_KEY_PATTERN.test(entry.key)) {
      errors.push(
        `providesSecret[${index}].key must match ${SECRET_KEY_PATTERN}, got: "${entry.key}"`,
      );
    } else if (seen.has(entry.key)) {
      errors.push(
        `providesSecret[${index}].key is a duplicate: "${entry.key}"`,
      );
    } else {
      seen.add(entry.key);
    }

    if (typeof entry.permission !== "string" || entry.permission.length === 0) {
      errors.push(`providesSecret[${index}].permission is required`);
    }

    if (
      "descriptionKey" in entry &&
      (typeof entry.descriptionKey !== "string" ||
        entry.descriptionKey.length === 0)
    ) {
      errors.push(`providesSecret[${index}].descriptionKey must be a string`);
    }
  });

  return errors;
}

function validateRequiresSecret(requiresSecret) {
  if (requiresSecret === undefined) return [];
  if (!Array.isArray(requiresSecret)) {
    return ['Field "requiresSecret" must be an array'];
  }

  const errors = [];
  const seen = new Set();

  requiresSecret.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`requiresSecret[${index}] must be an object`);
      return;
    }

    if (typeof entry.plugin !== "string" || !ID_PATTERN.test(entry.plugin)) {
      errors.push(
        `requiresSecret[${index}].plugin must match ${ID_PATTERN}, got: "${entry.plugin}"`,
      );
    }

    if (typeof entry.key !== "string" || !SECRET_KEY_PATTERN.test(entry.key)) {
      errors.push(
        `requiresSecret[${index}].key must match ${SECRET_KEY_PATTERN}, got: "${entry.key}"`,
      );
    }

    if (typeof entry.plugin === "string" && typeof entry.key === "string") {
      const id = `${entry.plugin}:${entry.key}`;
      if (seen.has(id)) {
        errors.push(`requiresSecret[${index}] is a duplicate: "${id}"`);
      } else {
        seen.add(id);
      }
    }

    if ("optional" in entry && typeof entry.optional !== "boolean") {
      errors.push(`requiresSecret[${index}].optional must be a boolean`);
    }
  });

  return errors;
}

function validateContributes(contributes) {
  const errors = [];

  if ("tabs" in contributes) {
    if (!Array.isArray(contributes.tabs)) {
      errors.push('Field "contributes.tabs" must be an array');
    } else {
      contributes.tabs.forEach((tab, index) => {
        for (const field of ["id", "titleKey", "icon", "openFrom"]) {
          if (!(field in (tab || {}))) {
            errors.push(`contributes.tabs[${index}].${field} is required`);
          }
        }
        if (Array.isArray(tab?.openFrom)) {
          for (const value of tab.openFrom) {
            if (!OPEN_FROM_VALUES.includes(value)) {
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
    const raw = contributes.hostCapability;
    const entries = Array.isArray(raw) ? raw : [raw];
    const seenKeys = new Set();
    entries.forEach((entry, index) => {
      const hc = entry || {};
      const prefix = Array.isArray(raw)
        ? `contributes.hostCapability[${index}]`
        : "contributes.hostCapability";
      for (const field of ["key", "labelKey", "editorTab"]) {
        if (!(field in hc)) {
          errors.push(`${prefix}.${field} is required`);
        }
      }
      if (typeof hc.key === "string") {
        if (seenKeys.has(hc.key)) {
          errors.push(`${prefix}.key is a duplicate: "${hc.key}"`);
        }
        seenKeys.add(hc.key);
      }
    });
  }

  if ("permissionGroup" in contributes) {
    const group = contributes.permissionGroup || {};
    if (!group.group)
      errors.push("contributes.permissionGroup.group is required");
    if (!Array.isArray(group.permissions) || group.permissions.length === 0) {
      errors.push(
        "contributes.permissionGroup.permissions must be a non-empty array",
      );
    }
  }

  if ("settingsPanel" in contributes) {
    if (!contributes.settingsPanel?.titleKey) {
      errors.push("contributes.settingsPanel.titleKey is required");
    }
  }

  if ("dashboardCards" in contributes) {
    if (!Array.isArray(contributes.dashboardCards)) {
      errors.push('Field "contributes.dashboardCards" must be an array');
    } else {
      contributes.dashboardCards.forEach((card, index) => {
        for (const field of ["id", "titleKey"]) {
          if (!(field in (card || {}))) {
            errors.push(
              `contributes.dashboardCards[${index}].${field} is required`,
            );
          }
        }
      });
    }
  }

  if ("actions" in contributes) {
    errors.push(...validateActions(contributes.actions));
  }

  if ("actionSlots" in contributes) {
    errors.push(...validateActionSlots(contributes.actionSlots));
  }

  return errors;
}

function validateActions(actions) {
  if (!Array.isArray(actions)) {
    return ['Field "contributes.actions" must be an array'];
  }

  const errors = [];
  const seen = new Set();

  actions.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`contributes.actions[${index}] must be an object`);
      return;
    }

    if (typeof entry.id !== "string" || !ACTION_ID_PATTERN.test(entry.id)) {
      errors.push(
        `contributes.actions[${index}].id must match ${ACTION_ID_PATTERN}, got: "${entry.id}"`,
      );
    } else if (seen.has(entry.id)) {
      errors.push(
        `contributes.actions[${index}].id is a duplicate: "${entry.id}"`,
      );
    } else {
      seen.add(entry.id);
    }

    if (typeof entry.titleKey !== "string" || entry.titleKey.length === 0) {
      errors.push(`contributes.actions[${index}].titleKey is required`);
    }

    if (
      typeof entry.handler !== "string" ||
      !HANDLER_PATTERN.test(entry.handler)
    ) {
      errors.push(
        `contributes.actions[${index}].handler must match ${HANDLER_PATTERN}, got: "${entry.handler}"`,
      );
    }

    if ("icon" in entry && typeof entry.icon !== "string") {
      errors.push(`contributes.actions[${index}].icon must be a string`);
    }

    if ("permission" in entry && typeof entry.permission !== "string") {
      errors.push(`contributes.actions[${index}].permission must be a string`);
    }

    if (
      "slot" in entry &&
      (typeof entry.slot !== "string" || !ACTION_ID_PATTERN.test(entry.slot))
    ) {
      errors.push(
        `contributes.actions[${index}].slot must match ${ACTION_ID_PATTERN}, got: "${entry.slot}"`,
      );
    }

    if ("kind" in entry && !ACTION_CONTRIBUTION_KINDS.includes(entry.kind)) {
      errors.push(
        `contributes.actions[${index}].kind must be one of: ${ACTION_CONTRIBUTION_KINDS.join(", ")}, got: "${entry.kind}"`,
      );
    }
  });

  return errors;
}

function validateActionSlots(slots) {
  if (!Array.isArray(slots)) {
    return ['Field "contributes.actionSlots" must be an array'];
  }

  const errors = [];
  const seen = new Set();

  slots.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`contributes.actionSlots[${index}] must be an object`);
      return;
    }

    if (typeof entry.id !== "string" || !ACTION_ID_PATTERN.test(entry.id)) {
      errors.push(
        `contributes.actionSlots[${index}].id must match ${ACTION_ID_PATTERN}, got: "${entry.id}"`,
      );
    } else if (seen.has(entry.id)) {
      errors.push(
        `contributes.actionSlots[${index}].id is a duplicate: "${entry.id}"`,
      );
    } else {
      seen.add(entry.id);
    }

    if (!Array.isArray(entry.accepts) || entry.accepts.length === 0) {
      errors.push(
        `contributes.actionSlots[${index}].accepts must be a non-empty array`,
      );
    } else {
      for (const kind of entry.accepts) {
        if (!ACTION_CONTRIBUTION_KINDS.includes(kind)) {
          errors.push(
            `contributes.actionSlots[${index}].accepts has unknown value: "${kind}". Known values: ${ACTION_CONTRIBUTION_KINDS.join(", ")}`,
          );
        }
      }
    }

    if ("descriptionKey" in entry && typeof entry.descriptionKey !== "string") {
      errors.push(
        `contributes.actionSlots[${index}].descriptionKey must be a string`,
      );
    }
  });

  return errors;
}

function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error(
      "Usage: node scripts/validate-plugin-manifest.cjs <path-to-manifest.json>",
    );
    process.exit(1);
  }

  const resolvedPath = path.resolve(manifestPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Manifest not found: ${resolvedPath}`);
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch (err) {
    console.error(`Manifest is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  const schema = loadSchema();
  const errors = validateManifest(manifest, schema);

  if (errors.length > 0) {
    console.error(`Invalid plugin manifest: ${resolvedPath}`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log(`Valid plugin manifest: ${resolvedPath}`);
}

if (require.main === module) {
  main();
}

module.exports = { validateManifest, loadSchema };
