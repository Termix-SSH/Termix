const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sdk = path.join(root, "packages/plugin-sdk/dist/changelog.js");

if (!fs.existsSync(sdk)) {
  console.error("check-changelog: build the SDK first (npm run build:sdk)");
  process.exit(1);
}

const { parseChangelog, validateChangelog } = require(sdk);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const problems = parseChangelog(read("CHANGELOG.md")).problems.map(
  (problem) => `CHANGELOG.md: ${problem}`,
);

// The SDK is published on its own, so its newest release has to be the package version.
const sdkVersion = JSON.parse(read("packages/plugin-sdk/package.json")).version;
problems.push(
  ...validateChangelog(
    read("packages/plugin-sdk/CHANGELOG.md"),
    sdkVersion,
  ).map((problem) => `packages/plugin-sdk/CHANGELOG.md: ${problem}`),
);

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
