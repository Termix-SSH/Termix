const fs = require("node:fs");
const path = require("node:path");

const nodePtyDir = path.join(__dirname, "..", "node_modules", "node-pty");

const unixTerminalPath = path.join(nodePtyDir, "lib", "unixTerminal.js");

// Older installs may still carry the first version of this patch.
const knownHelperRewrites = [
  [
    "helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');",
    "helperPath = helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked');",
  ].join("\n"),
  [
    "if (!helperPath.includes('app.asar.unpacked')) {",
    "    helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');",
    "}",
    "if (!helperPath.includes('node_modules.asar.unpacked')) {",
    "    helperPath = helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked');",
    "}",
  ].join("\n"),
];

// A universal macOS build ships app-arm64.asar and app-x64.asar, not app.asar.
const patchedHelperRewrite =
  "helperPath = helperPath.replace(/\\b(app(?:-[a-z0-9]+)?|node_modules)\\.asar(?!\\.unpacked)/g, '$1.asar.unpacked');";

function patchUnixTerminalHelperRewrite(file = unixTerminalPath) {
  if (!fs.existsSync(file)) {
    return false;
  }

  const source = fs.readFileSync(file, "utf8");
  if (source.includes(patchedHelperRewrite)) {
    return false;
  }
  const known = knownHelperRewrites.find((rewrite) => source.includes(rewrite));
  if (!known) {
    return false;
  }

  fs.writeFileSync(
    file,
    source.replace(known, () => patchedHelperRewrite),
  );
  return true;
}

function chmodSpawnHelpers(rootDir) {
  const candidates = [
    path.join(rootDir, "build", "Release", "spawn-helper"),
    path.join(rootDir, "build", "Debug", "spawn-helper"),
    path.join(rootDir, "prebuilds", "darwin-arm64", "spawn-helper"),
    path.join(rootDir, "prebuilds", "darwin-x64", "spawn-helper"),
    path.join(rootDir, "prebuilds", "linux-x64", "spawn-helper"),
    path.join(rootDir, "prebuilds", "linux-arm64", "spawn-helper"),
    path.join(rootDir, "prebuilds", "linux-arm", "spawn-helper"),
  ];

  let fixed = 0;
  for (const helper of candidates) {
    if (!fs.existsSync(helper)) continue;
    const mode = fs.statSync(helper).mode;
    if ((mode & 0o111) === 0) {
      fs.chmodSync(helper, mode | 0o755);
      fixed += 1;
    }
  }
  return fixed;
}

// Tests and afterPack require this file; only a direct run patches node_modules.
function main() {
  if (!fs.existsSync(nodePtyDir)) {
    console.log("[patch-node-pty] node-pty not found, skipping");
    return;
  }

  const helperRewritePatched = patchUnixTerminalHelperRewrite();
  const helpersChmodded = chmodSpawnHelpers(nodePtyDir);

  if (helperRewritePatched) {
    console.log("[patch-node-pty] Patched unixTerminal helper path rewrite");
  }
  if (helpersChmodded > 0) {
    console.log(
      `[patch-node-pty] Restored execute bit on ${helpersChmodded} spawn-helper binary(ies)`,
    );
  }
  if (!helperRewritePatched && helpersChmodded === 0) {
    console.log("[patch-node-pty] Already patched or target files not found");
  }
}

if (require.main === module) {
  main();
}

module.exports = { chmodSpawnHelpers, patchUnixTerminalHelperRewrite };
