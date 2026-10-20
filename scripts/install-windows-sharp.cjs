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

// The build runs on x64 but ships arm64 and ia32 too, so npm ci alone
// only installs the x64 binary.
const sharpPackage = findPackage(require.resolve("sharp"));
const packages = [
  "@img/sharp-win32-arm64",
  "@img/sharp-win32-ia32",
  "@img/sharp-win32-x64",
].map((name) => `${name}@${sharpPackage.optionalDependencies[name]}`);

// A .cmd file only starts through a shell on current Node.
execFileSync("npm.cmd", ["install", "--force", "--no-save", ...packages], {
  stdio: "inherit",
  shell: true,
});
