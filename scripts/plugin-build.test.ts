import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "../packages/plugin-sdk/cli/commands/build.mjs";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  vi.restoreAllMocks();
});

function fixturePlugin(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-build-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({ id: "build-fixture" }),
  );
  fs.mkdirSync(path.join(dir, "src", "backend"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "src", "backend", "index.ts"),
    "export function activate() {}\n",
  );
  return dir;
}

describe("termix-plugin build", () => {
  it("marks dist as ESM so Node loads backend.js without reparsing", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = fixturePlugin();

    await build({ cwd: dir });

    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, "dist", "package.json"), "utf8"),
    );
    expect(pkg).toEqual({ type: "module" });
    expect(fs.existsSync(path.join(dir, "dist", "backend.js"))).toBe(true);
  });

  it("loads a bundled CommonJS package that requires a host-provided one, with Vite's build constants", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = fixturePlugin();
    const dep = path.join(dir, "node_modules", "cjs-dep");
    fs.mkdirSync(dep, { recursive: true });
    fs.writeFileSync(
      path.join(dep, "package.json"),
      JSON.stringify({ name: "cjs-dep", main: "index.js" }),
    );
    // What react-xtermjs does: a CommonJS require of React's JSX runtime.
    fs.writeFileSync(
      path.join(dep, "index.js"),
      'const runtime = require("react/jsx-runtime");\nexports.render = () => runtime.jsx("div", {});\n',
    );
    fs.mkdirSync(path.join(dir, "src", "frontend"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "src", "frontend", "index.ts"),
      'import { render } from "cjs-dep";\nexport const rendered = render();\nexport const dev = import.meta.env.DEV;\nexport const mode = process.env.NODE_ENV;\n',
    );

    await build({ cwd: dir });

    // Stand in for the import map: point the external at a stub module.
    const stub = path.join(dir, "jsx-runtime.mjs");
    fs.writeFileSync(
      stub,
      "export const jsx = (type) => ({ type });\nexport const jsxs = jsx;\n",
    );
    const bundle = fs
      .readFileSync(path.join(dir, "dist", "frontend.js"), "utf8")
      .replaceAll(
        '"react/jsx-runtime"',
        JSON.stringify(pathToFileURL(stub).href),
      );
    const runnable = path.join(dir, "dist", "runnable.mjs");
    fs.writeFileSync(runnable, bundle);

    const mod = await import(pathToFileURL(runnable).href);
    expect(mod.rendered).toEqual({ type: "div" });
    expect(mod.dev).toBe(false);
    expect(mod.mode).toBe("production");
  });
});
