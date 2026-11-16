#!/usr/bin/env node
// The desktop runs plugin processes on the Node pinned in
// electron/plugin-node.json. It must be the same major as the server image,
// so plugins see the same permission model everywhere.

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function check(pin, dockerfile) {
  const problems = [];
  const major = Number(String(pin.version).split(".")[0]);
  const images = [...dockerfile.matchAll(/^FROM\s+(?:--\S+\s+)*node:(\d+)/gm)];
  if (images.length === 0) problems.push("Dockerfile has no node image");
  for (const image of images) {
    if (Number(image[1]) !== major) {
      problems.push(
        `plugin-node.json pins Node ${pin.version} but the Dockerfile uses node:${image[1]}`,
      );
    }
  }
  for (const [key, build] of Object.entries(pin.builds ?? {})) {
    if (!String(build.file).startsWith(`node-v${pin.version}-`)) {
      problems.push(`${key}: ${build.file} is not Node ${pin.version}`);
    }
    if (!/^[0-9a-f]{64}$/.test(String(build.sha256))) {
      problems.push(`${key}: sha256 is not a hash`);
    }
  }
  return problems;
}

if (require.main === module) {
  const pin = require("../electron/plugin-node.json");
  const dockerfile = fs.readFileSync(
    path.join(root, "docker", "Dockerfile"),
    "utf8",
  );
  const problems = check(pin, dockerfile);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
}

module.exports = { check };
