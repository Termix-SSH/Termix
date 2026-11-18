import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * `import url from "some/file.js?url"` in a plugin frontend, as core's Vite
 * build allows: the file is copied next to the bundle under assets/ and the
 * import becomes its URL, resolved against the bundle's own URL so it works
 * under /plugin-assets/<id>/. Only scripts, since that is all the asset
 * route serves (a pdfjs or Monaco worker, say).
 */
export function staticUrlImports({ outDir }) {
  return {
    name: "static-url-imports",
    setup(build) {
      // esbuild writes this path into the bundle, so keep it relative to the
      // plugin or the file changes with the folder it was built in.
      const root = build.initialOptions.absWorkingDir || process.cwd();
      build.onResolve({ filter: /\?url$/ }, async (args) => {
        const target = args.path.slice(0, -"?url".length);
        const resolved = await build.resolve(target, {
          kind: args.kind,
          resolveDir: args.resolveDir,
          importer: args.importer,
        });
        if (resolved.errors.length > 0) return { errors: resolved.errors };
        return {
          path: path.relative(root, resolved.path).split(path.sep).join("/"),
          namespace: "static-url",
        };
      });

      build.onLoad({ filter: /.*/, namespace: "static-url" }, (args) => {
        const file = path.resolve(root, args.path);
        if (!/\.(m?js|cjs)$/.test(file)) {
          return {
            errors: [
              {
                text: `${args.path}: only script files can be imported with ?url`,
              },
            ],
          };
        }
        const bytes = fs.readFileSync(file);
        const hash = crypto
          .createHash("sha256")
          .update(bytes)
          .digest("hex")
          .slice(0, 8);
        const base = path.basename(file).replace(/\.(m?js|cjs)$/, "");
        const name = `${base}-${hash}.js`;
        fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });
        fs.writeFileSync(path.join(outDir, "assets", name), bytes);
        return {
          contents: `export default new URL("./assets/${name}", import.meta.url).href;`,
          loader: "js",
        };
      });
    },
  };
}
