const fs = require("fs");
const path = require("path");
const { chmodSpawnHelpers } = require("../../scripts/patch-node-pty.cjs");

exports.default = async function afterPack(context) {
  const { targets, appOutDir } = context;

  const isDir = targets.some((t) => t.name === "dir");
  if (isDir) {
    const markerPath = path.join(appOutDir, ".portable");
    fs.writeFileSync(markerPath, "");
  }

  if (context.electronPlatformName === "win32") {
    return;
  }

  const resourcesDir =
    context.electronPlatformName === "darwin"
      ? path.join(
          appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources",
        )
      : path.join(appOutDir, "resources");

  const nodePtyDir = path.join(
    resourcesDir,
    "app.asar.unpacked",
    "node_modules",
    "node-pty",
  );
  const fixed = chmodSpawnHelpers(nodePtyDir);
  if (fixed > 0) {
    console.log(
      `[afterPack] Restored execute bit on ${fixed} packaged spawn-helper binary(ies)`,
    );
  }
};
