#!/usr/bin/env node
/**
 * Fixes electron-builder's update files (latest.yml and friends) after the
 * build, so the desktop updater gets the right download:
 *
 *   --drop <text>       remove entries whose file name contains text
 *                       (the ia32 installer, the combined Windows
 *                       installer, the universal mac zip)
 *   --rename <old=new>  follow an artifact the workflow renamed
 *
 * Usage: node scripts/fix-update-info.cjs [--drop x] [--rename a=b] files...
 */

const fs = require("node:fs");
const yaml = require("js-yaml");

function fixUpdateInfo(info, { drop = [], rename = {} } = {}) {
  const rewrite = (name) => rename[name] ?? name;
  const seen = new Set();
  // electron-builder can list the same file more than once.
  const files = (info.files ?? [])
    .filter((file) => !drop.some((text) => file.url.includes(text)))
    .map((file) => ({ ...file, url: rewrite(file.url) }))
    .filter((file) => !seen.has(file.url) && seen.add(file.url));
  if (files.length === 0) {
    throw new Error("no files left in update info");
  }
  return { ...info, files, path: files[0].url, sha512: files[0].sha512 };
}

function parseArgs(argv) {
  const options = { drop: [], rename: {}, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--drop") options.drop.push(argv[++i]);
    else if (arg === "--rename") {
      const [from, to] = String(argv[++i]).split("=");
      if (!from || !to) throw new Error(`bad --rename ${argv[i]}`);
      options.rename[from] = to;
    } else options.files.push(arg);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  for (const file of options.files) {
    if (!fs.existsSync(file)) continue;
    const info = yaml.load(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, yaml.dump(fixUpdateInfo(info, options)));
    console.log(`Fixed ${file}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { fixUpdateInfo, parseArgs };
