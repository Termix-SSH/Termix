const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sdk = path.join(root, "packages/plugin-sdk/dist/changelog.js");

if (!fs.existsSync(sdk)) {
  console.error("check-changelog: build the SDK first (npm run build:sdk)");
  process.exit(1);
}

const { parseChangelog } = require(sdk);
const { problems } = parseChangelog(
  fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"),
);
if (problems.length > 0) {
  for (const problem of problems) console.error(`  CHANGELOG.md: ${problem}`);
  process.exit(1);
}
