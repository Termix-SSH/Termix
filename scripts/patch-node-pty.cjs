const fs = require("node:fs");
const path = require("node:path");

const nodePtyDir = path.join(__dirname, "..", "node_modules", "node-pty");

if (!fs.existsSync(nodePtyDir)) {
  console.log("[patch-node-pty] node-pty not found, skipping");
  process.exit(0);
}

const unixTerminalPath = path.join(nodePtyDir, "lib", "unixTerminal.js");

const originalHelperRewrite = [
  "helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');",
  "helperPath = helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked');",
].join("\n");

const patchedHelperRewrite = [
  "if (!helperPath.includes('app.asar.unpacked')) {",
  "    helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');",
  "}",
  "if (!helperPath.includes('node_modules.asar.unpacked')) {",
  "    helperPath = helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked');",
  "}",
].join("\n");

function patchUnixTerminalHelperRewrite() {
  if (!fs.existsSync(unixTerminalPath)) {
    return false;
  }

  const source = fs.readFileSync(unixTerminalPath, "utf8");
  if (source.includes(patchedHelperRewrite)) {
    return false;
  }
  if (!source.includes(originalHelperRewrite)) {
    return false;
  }

  fs.writeFileSync(
    unixTerminalPath,
    source.replace(originalHelperRewrite, patchedHelperRewrite),
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

module.exports = { chmodSpawnHelpers, patchUnixTerminalHelperRewrite };
