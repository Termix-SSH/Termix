#!/usr/bin/env node
// Writes openapi.json for core from the @openapi blocks in src/backend.
// The docs site runs the same builder on each release.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApi } from "@termix-ssh/plugin-sdk/openapi";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const tags = JSON.parse(
  fs.readFileSync(
    path.join(root, "src/backend/utils/openapi-tags.json"),
    "utf8",
  ),
);
const out = process.argv[2] ?? path.join(root, "openapi.json");

const spec = await buildOpenApi({
  title: "Termix API",
  version: pkg.version,
  description: "The core Termix API. Each plugin documents its own routes.",
  files: [path.join(root, "src/backend/**/!(*.test).ts")],
  tags,
});

fs.writeFileSync(out, `${JSON.stringify(spec, null, 2)}\n`);
console.log(
  `wrote ${path.relative(root, out)} (${Object.keys(spec.paths ?? {}).length} paths)`,
);
