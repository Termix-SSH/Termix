const fs = require("node:fs");
const path = require("node:path");

const collectorPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "app-builder-lib",
  "out",
  "node-module-collector",
  "nodeModulesCollector.js",
);

const original = `                shell: true, // \`true\`\` is now required: https://github.com/electron-userland/electron-builder/issues/9488`;
const patched = `                shell: false, // Avoid Node DEP0190; .cmd files are wrapped through cmd.exe above.`;

if (!fs.existsSync(collectorPath)) {
  process.exit(0);
}

const source = fs.readFileSync(collectorPath, "utf8");

if (source.includes(patched)) {
  process.exit(0);
}

if (!source.includes(original)) {
  console.warn(
    "app-builder-lib node module collector patch was not applied; expected spawn shell option was not found.",
  );
  process.exit(0);
}

fs.writeFileSync(collectorPath, source.replace(original, patched));
