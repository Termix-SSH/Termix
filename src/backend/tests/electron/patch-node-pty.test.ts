import { createRequire } from "node:module";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  chmodSpawnHelpers,
  patchUnixTerminalHelperRewrite,
} = require("../../../../scripts/patch-node-pty.cjs");

const upstreamRewrite = [
  "helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');",
  "helperPath = helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked');",
].join("\n");

const previouslyPatchedRewrite = [
  "if (!helperPath.includes('app.asar.unpacked')) {",
  "    helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');",
  "}",
  "if (!helperPath.includes('node_modules.asar.unpacked')) {",
  "    helperPath = helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked');",
  "}",
].join("\n");

const resources = "/Applications/Termix.app/Contents/Resources";
const helperPaths = [
  ["app.asar", "app.asar.unpacked"],
  ["app-arm64.asar", "app-arm64.asar.unpacked"],
  ["app-x64.asar", "app-x64.asar.unpacked"],
  ["app.asar.unpacked", "app.asar.unpacked"],
  ["app-arm64.asar.unpacked", "app-arm64.asar.unpacked"],
].map(([from, to]) => [
  `${resources}/${from}/node_modules/node-pty/build/Release/spawn-helper`,
  `${resources}/${to}/node_modules/node-pty/build/Release/spawn-helper`,
]);

function writeUnixTerminal(rewrite: string) {
  const file = join(
    tmpdir(),
    `termix-unix-terminal-${Date.now()}-${Math.random()}.cjs`,
  );
  writeFileSync(
    file,
    `module.exports = function (helperPath) {\n${rewrite}\nreturn helperPath;\n};\n`,
  );
  return file;
}

// chmod's execute bit is a POSIX concept; Windows/NTFS has no equivalent mode bit.
const itPosix = process.platform === "win32" ? it.skip : it;

describe("patch-node-pty", () => {
  itPosix("restores execute permissions on spawn-helper binaries", () => {
    const root = join(tmpdir(), `termix-node-pty-${Date.now()}`);
    const helper = join(root, "prebuilds", "darwin-arm64", "spawn-helper");
    mkdirSync(join(root, "prebuilds", "darwin-arm64"), { recursive: true });
    writeFileSync(helper, "helper");
    chmodSync(helper, 0o644);

    expect(chmodSpawnHelpers(root)).toBe(1);
    expect(statSync(helper).mode & 0o111).not.toBe(0);

    expect(chmodSpawnHelpers(root)).toBe(0);
    expect(existsSync(helper)).toBe(true);
  });

  it.each([
    ["upstream", upstreamRewrite],
    ["previously patched", previouslyPatchedRewrite],
  ])(
    "points the %s helper path at the unpacked copy of any app asar",
    (_, rewrite) => {
      const file = writeUnixTerminal(rewrite);

      expect(patchUnixTerminalHelperRewrite(file)).toBe(true);
      expect(patchUnixTerminalHelperRewrite(file)).toBe(false);

      const rewriteHelperPath = require(file);
      for (const [from, to] of helperPaths) {
        expect(rewriteHelperPath(from)).toBe(to);
      }
    },
  );
});
