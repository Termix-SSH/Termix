#!/usr/bin/env node
/**
 * Works out beta numbers from a list of tags on stdin.
 *
 * node scripts/beta-version.cjs 26.11.0 < tags.txt          -> 26.11.0-beta.3
 * node scripts/beta-version.cjs 26.11.0 --latest < tags.txt -> v26.11.0-beta.2
 */

const fs = require("fs");

function betaNumbers(base, tags) {
  const prefix = `v${base}-beta.`;
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => Number(tag.slice(prefix.length)))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
}

function nextBeta(base, tags) {
  const numbers = betaNumbers(base, tags);
  return `${base}-beta.${(numbers.at(-1) ?? 0) + 1}`;
}

function latestBetaTag(base, tags) {
  const numbers = betaNumbers(base, tags);
  return numbers.length ? `v${base}-beta.${numbers.at(-1)}` : "";
}

if (require.main === module) {
  const base = process.argv[2];
  if (!base || !/^\d+\.\d+\.\d+$/.test(base)) {
    console.error("beta-version: pass a version like 26.11.0");
    process.exit(1);
  }
  const tags = fs.readFileSync(0, "utf8").split("\n");
  console.log(
    process.argv.includes("--latest")
      ? latestBetaTag(base, tags)
      : nextBeta(base, tags),
  );
}

module.exports = { latestBetaTag, nextBeta };
