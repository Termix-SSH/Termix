import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * Runs vitest through its own entry rather than the npx shim, so no shell is
 * involved and paths with spaces work the same on every platform.
 */
export async function test({ cwd, args }) {
  const require = createRequire(import.meta.url);

  let vitestBin;
  try {
    // vitest.mjs is the package bin, not an exported subpath, so resolve the
    // manifest and walk to it.
    const manifest = require.resolve("vitest/package.json", { paths: [cwd] });
    vitestBin = path.join(path.dirname(manifest), "vitest.mjs");
  } catch {
    throw new Error(
      "vitest is not installed. Run npm install at the repo root.",
    );
  }

  const result = spawnSync(
    process.execPath,
    [vitestBin, "run", "--config", "vitest.config.ts", ...args],
    { cwd, stdio: "inherit" },
  );

  if (result.status !== 0) {
    throw new Error(`vitest exited with ${result.status}`);
  }
}
