import fs from "node:fs";
import path from "node:path";
import { readManifest } from "../lib/plugin-dir.mjs";
import { loadSdkModule } from "./validate.mjs";

/**
 * Writes dist/openapi.json from the @openapi blocks in src/backend. A plugin
 * with no documented routes gets no file.
 */
export async function openapi({ cwd, quiet = false }) {
  const manifest = readManifest(cwd);
  const pluginId = manifest.id ?? path.basename(cwd);
  const backendDir = path.join(cwd, "src", "backend");
  if (!fs.existsSync(backendDir)) return null;

  const { buildOpenApi, hasOpenApiPaths } = await loadSdkModule("openapi");
  const spec = await buildOpenApi({
    title: `${manifest.name ?? pluginId} API`,
    version: manifest.version ?? "0.0.0",
    description: manifest.description,
    files: [path.join(backendDir, "**", "*.{ts,tsx,js,mjs}")],
  });

  const target = path.join(cwd, "dist", "openapi.json");
  if (!hasOpenApiPaths(spec)) {
    fs.rmSync(target, { force: true });
    if (!quiet) console.log(`${pluginId}: no documented routes`);
    return null;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(spec, null, 2)}\n`);
  if (!quiet) {
    console.log(
      `wrote dist/openapi.json (${Object.keys(spec.paths).length} paths)`,
    );
  }
  return target;
}
