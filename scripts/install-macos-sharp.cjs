const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function findPackage(start) {
  let directory = path.dirname(start);
  while (directory !== path.dirname(directory)) {
    const manifest = path.join(directory, "package.json");
    if (fs.existsSync(manifest)) return JSON.parse(fs.readFileSync(manifest));
    directory = path.dirname(directory);
  }
  throw new Error("Could not locate the installed sharp package manifest");
}

const sharpPackage = findPackage(require.resolve("sharp"));
const packages = [
  "@img/sharp-darwin-arm64",
  "@img/sharp-darwin-x64",
  "@img/sharp-libvips-darwin-arm64",
  "@img/sharp-libvips-darwin-x64",
].map((name) => `${name}@${sharpPackage.optionalDependencies[name]}`);

execFileSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["install", "--force", "--no-save", ...packages],
  { stdio: "inherit" },
);
