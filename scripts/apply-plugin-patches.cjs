/**
 * Applies every workspace plugin's dependency patches after npm install, so
 * the Vite dev server serves the same patched libraries a build bundles.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "packages", "plugin-sdk", "cli", "index.mjs");
const plugins = path.join(root, "plugins");

for (const id of fs.readdirSync(plugins)) {
  const dir = path.join(plugins, id);
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (!pkg.termix?.patches?.length && !fs.existsSync(path.join(dir, "patches")))
    continue;
  const result = spawnSync(process.execPath, [cli, "patch"], {
    cwd: dir,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
