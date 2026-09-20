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

const SCHEMA_PATH = path.join(__dirname, "plugin-manifest.schema.json");

const ID_PATTERN = /^[a-z0-9-]+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?(\+[0-9A-Za-z-.]+)?$/;
const API_VERSION_PATTERN = /^[0-9]+$/;
const OPEN_FROM_VALUES = ["rail", "host-context-menu", "palette"];

function loadSchema() {
  const raw = fs.readFileSync(SCHEMA_PATH, "utf8");
  return JSON.parse(raw);
}

function knownPermissions(schema) {
  return schema.properties.permissions.items.enum;
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

  if (manifest.contributes && typeof manifest.contributes === "object") {
    errors.push(...validateContributes(manifest.contributes));
  }

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
    for (const field of ["key", "labelKey", "editorTab"]) {
      if (!(field in (contributes.hostCapability || {}))) {
        errors.push(`contributes.hostCapability.${field} is required`);
      }
    }
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
