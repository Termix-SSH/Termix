const fs = require("node:fs");
const path = require("node:path");

// electron-builder's module collector checks a found package's version
// against the declared range even when the folder holds an npm alias
// (`"x": "npm:other@1"`), so an alias whose target version differs from the
// range is skipped. Only check versions when the package name matches. Every
// call site is patched, so a reshuffle upstream can't leave one out.
const moduleManagerPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "app-builder-lib",
  "out",
  "node-module-collector",
  "moduleManager.js",
);

const SIGNATURE = `    semverSatisfies(found, range) {
        if ((0, builder_util_1.isEmptyOrSpaces)(range) || range === "*") {`;
const SIGNATURE_PATCHED = `    semverSatisfies(found, range, packageNameMatches = true) {
        if (!packageNameMatches) {
            return true;
        }
        if ((0, builder_util_1.isEmptyOrSpaces)(range) || range === "*") {`;
const CALL = "this.semverSatisfies(json.version, requiredRange)";
const CALL_PATCHED =
  "this.semverSatisfies(json.version, requiredRange, json.name === pkgName)";

function patchModuleManager(filePath) {
  if (!fs.existsSync(filePath)) return;
  let source = fs.readFileSync(filePath, "utf8");
  const before = source;

  if (!source.includes(SIGNATURE_PATCHED)) {
    if (!source.includes(SIGNATURE)) {
      const msg =
        '[patch-app-builder-lib] Patch "npm alias version check" failed: semverSatisfies signature not found (changed upstream).';
      console.error(msg);
      throw new Error(msg);
    }
    source = source.replace(SIGNATURE, SIGNATURE_PATCHED);
  }
  if (!source.includes(CALL_PATCHED) && !source.includes(CALL)) {
    const msg =
      '[patch-app-builder-lib] Patch "npm alias version check" failed: semverSatisfies call site not found (changed upstream).';
    console.error(msg);
    throw new Error(msg);
  }
  source = source.replaceAll(CALL, CALL_PATCHED);

  if (source !== before) fs.writeFileSync(filePath, source);
}

module.exports = { patchModuleManager };

if (require.main === module) patchModuleManager(moduleManagerPath);
