// Modified for the local macOS build — see README_LOCAL.md.
// 2026-09-19: restore the execute bit on packaged node-pty spawn-helper
// binaries before signing (Apache-2.0 §4b notice).
const fs = require("fs");
const path = require("path");
const { chmodSpawnHelpers } = require("../../scripts/patch-node-pty.cjs");

/**
 * npm extracts node-pty's spawn-helper without the execute bit, so
 * posix_spawn() fails with EACCES and the local terminal is unusable
 * ("posix_spawnp failed."). electron-builder copies the file as-is, so the
 * execute bit has to be restored inside the packaged app, before signing.
 */
function fixPackedSpawnHelpers(resourcesDir) {
  let fixed = 0;

  let entries;
  try {
    entries = fs.readdirSync(resourcesDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(".asar.unpacked")) continue;

    const nodePtyDir = path.join(
      resourcesDir,
      entry.name,
      "node_modules",
      "node-pty",
    );
    fixed += chmodSpawnHelpers(nodePtyDir);
  }

  return fixed;
}

exports.default = async function afterPack(context) {
  const { targets, appOutDir } = context;

  const isDir = targets.some((t) => t.name === "dir");
  if (isDir) {
    const markerPath = path.join(appOutDir, ".portable");
    fs.writeFileSync(markerPath, "");
  }

  if (context.electronPlatformName === "win32") return;

  const resourcesDir =
    context.electronPlatformName === "darwin"
      ? path.join(
          appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources",
        )
      : path.join(appOutDir, "resources");

  const fixed = fixPackedSpawnHelpers(resourcesDir);
  if (fixed > 0) {
    console.log(
      `[afterPack] Restored execute bit on ${fixed} packaged spawn-helper binary(ies)`,
    );
  }
};
