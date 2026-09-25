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
      build.onResolve({ filter: /\?url$/ }, async (args) => {
        const target = args.path.slice(0, -"?url".length);
        const resolved = await build.resolve(target, {
          kind: args.kind,
          resolveDir: args.resolveDir,
          importer: args.importer,
        });
        if (resolved.errors.length > 0) return { errors: resolved.errors };
        return { path: resolved.path, namespace: "static-url" };
      });

      build.onLoad({ filter: /.*/, namespace: "static-url" }, (args) => {
        if (!/\.(m?js|cjs)$/.test(args.path)) {
          return {
            errors: [
              {
                text: `${args.path}: only script files can be imported with ?url`,
              },
            ],
          };
        }
        const bytes = fs.readFileSync(args.path);
        const hash = crypto
          .createHash("sha256")
          .update(bytes)
          .digest("hex")
          .slice(0, 8);
        const base = path.basename(args.path).replace(/\.(m?js|cjs)$/, "");
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
