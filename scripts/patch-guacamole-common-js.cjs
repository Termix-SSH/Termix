const fs = require("fs");
const path = require("path");

const packageRoot = path.join(
  __dirname,
  "..",
  "node_modules",
  "guacamole-common-js",
);

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
