import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { resolveFromApp } from "../../../../plugins/sandbox/child/guards.js";

const anchor = "file:///app/package.json";

function notFound(code: string): Error {
  return Object.assign(new Error("Cannot find module"), { code });
}

describe("resolveFromApp", () => {
  it("retries an import from the app root", () => {
    const calls: unknown[] = [];
    const result = resolveFromApp(
      "ws",
      { parentURL: "file:///data/plugin/backend.js" },
      notFound("ERR_MODULE_NOT_FOUND"),
      (specifier, context) => {
        calls.push([specifier, context.parentURL]);
        return "resolved";
      },
      anchor,
      () => "unused",
    );
    expect(result).toBe("resolved");
    expect(calls).toEqual([["ws", anchor]]);
  });

  it("resolves a require() to a path under the app root", () => {
    const calls: string[] = [];
    resolveFromApp(
      "ws",
      {},
      notFound("MODULE_NOT_FOUND"),
      (specifier) => calls.push(specifier),
      anchor,
      (id) => `/app/node_modules/${id}/index.js`,
    );
    expect(calls).toEqual(["/app/node_modules/ws/index.js"]);
  });

  it("keeps the original error when the app root lacks it too", () => {
    const original = notFound("MODULE_NOT_FOUND");
    expect(() =>
      resolveFromApp(
        "missing",
        {},
        original,
        () => "x",
        anchor,
        () => {
          throw notFound("MODULE_NOT_FOUND");
        },
      ),
    ).toThrow(original);
  });

  it("rethrows for relative paths and other errors", () => {
    const next = () => "x";
    const resolve = () => "x";
    const relative = notFound("MODULE_NOT_FOUND");
    expect(() =>
      resolveFromApp("./a.js", {}, relative, next, anchor, resolve),
    ).toThrow(relative);
    const other = notFound("ERR_ACCESS_DENIED");
    expect(() =>
      resolveFromApp("ws", {}, other, next, anchor, resolve),
    ).toThrow(other);
  });
});

describe("resolveFromApp in a real process", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-resolve-"));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("lets a plugin outside the app require and import host packages", () => {
    const app = path.join(root, "app");
    const pkg = path.join(app, "node_modules", "hostpkg");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(app, "package.json"), "{}");
    fs.writeFileSync(path.join(pkg, "index.js"), 'module.exports = "host";');
    const plugin = path.join(root, "data", "plugin");
    fs.mkdirSync(plugin, { recursive: true });
    fs.writeFileSync(
      path.join(plugin, "backend.mjs"),
      [
        'import { createRequire } from "node:module";',
        'import viaImport from "hostpkg";',
        "const require = createRequire(import.meta.url);",
        'console.log(viaImport, require("hostpkg"));',
      ].join("\n"),
    );
    const guards = pathToFileURL(
      fileURLToPath(
        new URL("../../../../plugins/sandbox/child/guards.ts", import.meta.url),
      ),
    ).href;
    const anchorUrl = pathToFileURL(path.join(app, "package.json")).href;
    const hook = path.join(root, "hook.mjs");
    fs.writeFileSync(
      hook,
      [
        'import module from "node:module";',
        `const { resolveFromApp } = await import(${JSON.stringify(guards)});`,
        `const anchor = ${JSON.stringify(anchorUrl)};`,
        "const fromApp = module.createRequire(anchor);",
        "module.registerHooks({ resolve(s, c, next) {",
        "  try { return next(s, c); } catch (e) {",
        "    return resolveFromApp(s, c, e, next, anchor, (id) => fromApp.resolve(id));",
        "  } } });",
      ].join("\n"),
    );
    const run = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings",
        `--import=${pathToFileURL(hook).href}`,
        path.join(plugin, "backend.mjs"),
      ],
      { encoding: "utf8" },
    );
    expect(run.stderr).toBe("");
    expect(run.stdout.trim()).toBe("host host");
  });
});
