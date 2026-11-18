#!/usr/bin/env node
/**
 * CI installs skip package scripts, so cpu-features (an optional ssh2
 * dependency) is left without the buildcheck.gypi its install script writes,
 * and electron-builder's native rebuild then fails on it. ssh2 loads it in a
 * try/catch and works without it, so an unbuilt copy is removed instead of
 * letting its install script run.
 */

const fs = require("node:fs");
const path = require("node:path");

function dropCpuFeatures(root) {
  const dir = path.join(root, "node_modules", "cpu-features");
  if (!fs.existsSync(dir)) return false;
  if (fs.existsSync(path.join(dir, "buildcheck.gypi"))) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

if (require.main === module) {
  if (dropCpuFeatures(path.join(__dirname, ".."))) {
    console.log("Removed unbuilt cpu-features (optional for ssh2).");
  }
}

module.exports = { dropCpuFeatures };
