const fs = require("fs");
const path = require("path");

// Run by `termix-plugin build` with TERMIX_PATCH_ROOT set to the plugin, so
// the package resolves the way the plugin's bundle will resolve it.
function packageDir(name) {
  const root = process.env.TERMIX_PATCH_ROOT || process.cwd();
  // Walked by hand: a package whose exports map hides package.json cannot be
  // found with require.resolve.
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    if (path.dirname(dir) === dir) return path.join(root, "node_modules", name);
  }
}

const packageRoot = path.join(packageDir("guacamole-common-js"));

const bundlePaths = [
  path.join(packageRoot, "dist", "esm", "guacamole-common.js"),
  path.join(packageRoot, "dist", "cjs", "guacamole-common.js"),
];

const oldFlushBlock =
  "        if (window.requestAnimationFrame && document.hasFocus())\n" +
  "            asyncFlush();\n" +
  "        else\n" +
  "            syncFlush();";

const newFlushBlock =
  "        // Electron can throttle or skip requestAnimationFrame() for inactive\n" +
  "        // windows/tabs even while guacd is still sending display frames. Flush\n" +
  "        // synchronously so Guacamole connections do not stall while waiting for\n" +
  "        // a frame callback that may never run.\n" +
  "        syncFlush();";

let patched = false;
let foundBundle = false;

for (const bundlePath of bundlePaths) {
  if (!fs.existsSync(bundlePath)) {
    console.log(
      `[patch-guacamole-common-js] ${bundlePath} not found, skipping`,
    );
    continue;
  }

  foundBundle = true;
  let content = fs.readFileSync(bundlePath, "utf8");
  if (content.includes(newFlushBlock)) continue;

  if (!content.includes(oldFlushBlock)) {
    console.log(
      `[patch-guacamole-common-js] Flush target not found in ${bundlePath}, skipping`,
    );
    continue;
  }

  content = content.replace(oldFlushBlock, newFlushBlock);
  fs.writeFileSync(bundlePath, content);
  patched = true;
}

if (!foundBundle) {
  console.log("[patch-guacamole-common-js] File not found, skipping");
  process.exit(0);
}

if (!patched) {
  console.log("[patch-guacamole-common-js] Already patched");
  process.exit(0);
}

console.log(
  "[patch-guacamole-common-js] Patched display flush to avoid Electron requestAnimationFrame stalls",
);
