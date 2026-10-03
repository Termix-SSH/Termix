const fs = require("fs");
const path = require("path");
const { chmodSpawnHelpers } = require("../../scripts/patch-node-pty.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");

/**
 * The SDK is a workspace package, so electron-builder skips it, yet core and
 * every plugin import it at runtime. Ship its package.json and dist the way
 * the Docker image does.
 */
function copyPluginSdk(resourcesDir, sdkDir = path.join(repoRoot, "packages", "plugin-sdk")) {
  const target = path.join(
    resourcesDir,
    "app.asar.unpacked",
    "node_modules",
    "@termix",
    "plugin-sdk",
  );
  const dist = path.join(sdkDir, "dist");
  if (!fs.existsSync(dist)) {
    throw new Error(`Plugin SDK is not built (${dist}). Run: npm run build:sdk`);
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(sdkDir, "package.json"), path.join(target, "package.json"));
  fs.cpSync(dist, path.join(target, "dist"), { recursive: true });
  return target;
}

exports.copyPluginSdk = copyPluginSdk;

/** Mac App Store builds report "mas", not "darwin", but are still .app bundles. */
function resourcesDirFor({ electronPlatformName, appOutDir, packager }) {
  return ["darwin", "mas"].includes(electronPlatformName)
    ? path.join(
        appOutDir,
        `${packager.appInfo.productFilename}.app`,
        "Contents",
        "Resources",
      )
    : path.join(appOutDir, "resources");
}

exports.resourcesDirFor = resourcesDirFor;

exports.default = async function afterPack(context) {
  const { targets, appOutDir } = context;

  const isDir = targets.some((t) => t.name === "dir");
  if (isDir) {
    const markerPath = path.join(appOutDir, ".portable");
    fs.writeFileSync(markerPath, "");
  }

  const resourcesDir = resourcesDirFor(context);

  copyPluginSdk(resourcesDir);

  if (context.electronPlatformName === "win32") {
    return;
  }

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
