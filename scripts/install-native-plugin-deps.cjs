/**
 * Installs the native dependencies bundled plugins declare. esbuild leaves a
 * nativeDependencies package out of the plugin bundle, so the server's own
 * node_modules has to have it. Run in the production image after npm ci.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const plugins = path.resolve(root, process.argv[2] ?? "plugins");
const wanted = new Map();

for (const id of fs.existsSync(plugins) ? fs.readdirSync(plugins) : []) {
  const manifestPath = path.join(plugins, id, "manifest.json");
  const pkgPath = path.join(plugins, id, "package.json");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(pkgPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  for (const name of manifest.nativeDependencies ?? []) {
    const range = pkg.dependencies?.[name];
    if (!range) {
      console.error(`${id}: native dependency ${name} has no version`);
      process.exit(1);
    }
    wanted.set(name, range);
  }
}

if (wanted.size === 0) process.exit(0);

const specs = [...wanted].map(([name, range]) => `${name}@${range}`);
console.log(`Installing native plugin dependencies: ${specs.join(" ")}`);
const result = spawnSync(
  "npm",
  ["install", "--no-save", "--omit=dev", "--no-audit", "--no-fund", ...specs],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(result.status ?? 1);
