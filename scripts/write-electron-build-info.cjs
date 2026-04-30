const fs = require("fs");
const path = require("path");

const outputPath = path.join(__dirname, "..", "electron", "build-info.cjs");
const rawBuildTimestamp =
  process.env.TERMIX_BUILD_TIMESTAMP || process.env.BUILD_TIMESTAMP;
const parsedBuildTimestamp = rawBuildTimestamp
  ? Number(rawBuildTimestamp)
  : NaN;
const buildTimestamp = Number.isInteger(parsedBuildTimestamp)
  ? parsedBuildTimestamp
  : Math.floor(Date.now() / 1000);
const buildInfo = {
  buildTimestamp,
  generatedAt: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  `module.exports = ${JSON.stringify(buildInfo, null, 2)};\n`,
);

console.log(`Wrote Electron build info: ${buildTimestamp}`);
