import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  build,
  lowerPluginLayers,
} from "../packages/plugin-sdk/cli/commands/build.mjs";
import {
  classNamesInCss,
  splitByCoreClasses,
} from "../packages/plugin-sdk/cli/lib/css-classes.mjs";

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

describe("plugin CSS layers", () => {
  it("renames the Tailwind layers so core's utilities always win", () => {
    expect(
      lowerPluginLayers(
        "@layer properties{a{b:c}}@layer utilities{.flex{display:flex}}",
      ),
    ).toBe(
      "@layer termix-plugin-properties{a{b:c}}@layer termix-plugin-utilities{.flex{display:flex}}",
    );
    expect(lowerPluginLayers("@layer utilities-extra{}")).toBe(
      "@layer utilities-extra{}",
    );
  });

  it("can leave a plugin's own classes in core's utilities layer", () => {
    expect(
      lowerPluginLayers(
        "@layer properties{a{b:c}}@layer utilities{.w-px{width:1px}}",
        { utilities: false },
      ),
    ).toBe(
      "@layer termix-plugin-properties{a{b:c}}@layer utilities{.w-px{width:1px}}",
    );
  });

  it("reads class names from selectors, not declarations", () => {
    const names = classNamesInCss(
      String.raw`.w-28{width:calc(var(--spacing) * 28)}@media (width>=48rem){.md\:w-44{width:0.5rem}}.group-hover\:opacity-100:is(:where(.group):hover *){opacity:1}.top-1\/2{top:50%}.\32 xl\:flex{display:flex}`,
    );
    expect([...names].sort()).toEqual(
      [
        "2xl:flex",
        "group",
        "group-hover:opacity-100",
        "md:w-44",
        "top-1/2",
        "w-28",
      ].sort(),
    );
  });

  it("splits a plugin's classes by whether core ships them", () => {
    expect(
      splitByCoreClasses(
        ["w-28", "md:w-44", "hidden"],
        new Set(["w-28", "hidden"]),
      ),
    ).toEqual({ shared: ["w-28", "hidden"], own: ["md:w-44"] });
  });

  it("keeps variants core ships with the plugin's own classes", () => {
    expect(
      splitByCoreClasses(
        ["max-h-56", "md:max-h-none", "flex-col", "md:flex-row"],
        new Set(["md:max-h-none", "flex-col", "md:flex-row"]),
      ),
    ).toEqual({
      shared: ["flex-col"],
      own: ["max-h-56", "md:max-h-none", "md:flex-row"],
    });
  });

  it("keeps classes core ships below core and the plugin's own beside core's", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    // Core's class list comes from scanning this repo, this file included,
    // so the plugin-only class is put together here instead of written out.
    const width = ["w-", "[321px]"].join("");
    const dir = fixturePlugin();
    fs.mkdirSync(path.join(dir, "src", "frontend"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "src", "frontend", "index.tsx"),
      `export const a = <div className="hidden md:${width}" />;\n`,
    );

    await build({ cwd: dir });

    const css = fs.readFileSync(path.join(dir, "dist", "frontend.css"), "utf8");
    const lowered = css.slice(css.indexOf("@layer termix-plugin-utilities"));
    const own = css.slice(css.lastIndexOf("@layer utilities{"));
    expect(lowered).toMatch(/^@layer termix-plugin-utilities\{[^@]*\.hidden\{/);
    expect(own).toContain(String.raw`.md\:w-\[321px\]`);
    expect(own).not.toContain(".hidden{");
  });

  it("is ordered in core's CSS between base and core's utilities", () => {
    const css = fs.readFileSync(
      path.join(__dirname, "..", "src", "ui", "index.css"),
      "utf8",
    );
    const order = /@layer ([^;{]+);/.exec(css)?.[1].split(/[\s,]+/);
    expect(order).toEqual([
      "properties",
      "termix-plugin-properties",
      "theme",
      "base",
      "components",
      "termix-plugin-utilities",
      "utilities",
    ]);
    expect(css.indexOf("@layer properties,")).toBeLessThan(
      css.indexOf('@import "tailwindcss"'),
    );
  });
});
