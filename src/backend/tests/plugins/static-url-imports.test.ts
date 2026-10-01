/**
 * The CLI's ?url import: the file lands under dist/assets/ and the import
 * becomes a URL relative to the bundle, which /plugin-assets/<id>/ serves.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as esbuild from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error the CLI is plain ESM without types
import { staticUrlImports } from "../../../../packages/plugin-sdk/cli/lib/static-url-imports.mjs";

const dirs: string[] = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-url-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function bundle(entrySource: string, files: Record<string, string>) {
  const dir = tempDir();
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), contents);
  }
  fs.writeFileSync(path.join(dir, "entry.js"), entrySource);
  const outDir = path.join(dir, "dist");
  const result = await esbuild.build({
    entryPoints: [path.join(dir, "entry.js")],
    outfile: path.join(outDir, "frontend.js"),
    bundle: true,
    format: "esm",
    write: true,
    logLevel: "silent",
    plugins: [staticUrlImports({ outDir })],
  });
  return { outDir, result };
}

describe("staticUrlImports", () => {
  it("copies a worker next to the bundle and imports its URL", async () => {
    const { outDir } = await bundle(
      `import url from "./worker.mjs?url"; export default url;`,
      { "worker.mjs": "self.onmessage = () => {};" },
    );

    const assets = fs.readdirSync(path.join(outDir, "assets"));
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatch(/^worker-[0-9a-f]{8}\.js$/);
    const code = fs.readFileSync(path.join(outDir, "frontend.js"), "utf8");
    expect(code).toContain(`new URL("./assets/${assets[0]}", import.meta.url)`);
  });

  it("refuses a file the asset route would not serve", async () => {
    await expect(
      bundle(`import url from "./image.png?url"; export default url;`, {
        "image.png": "not really",
      }),
    ).rejects.toThrow(/only script files/);
  });
});
