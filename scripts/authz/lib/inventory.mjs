// Static list of core's HTTP routes and sockets, from the TypeScript source.
// Express 5 keeps no mount paths at runtime, so core routes are read here;
// plugin routes come from the running server (TERMIX_ROUTE_INVENTORY_FILE).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const METHODS = new Set(["get", "post", "put", "patch", "delete", "all"]);
// Receivers whose .get/.delete are maps, not routers.
const SKIP_RECV = new Set([
  "settings",
  "rows",
  "headers",
  "map",
  "cache",
  "kv",
  "Promise",
  "searchParams",
  "params",
  "query",
  "form",
  "url",
]);

// Shapes the AST pass can't follow.
const MANUAL = [
  { method: "GET", path: "/users/notification-private-endpoints" },
  { method: "PATCH", path: "/users/notification-private-endpoints" },
  { method: "GET", path: "/plugin-assets/:pluginId/*" },
];

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "tests", "dist"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (/\.ts$/.test(entry.name) && !/\.(test|d)\.ts$/.test(entry.name))
      out.push(full);
  }
  return out;
}

const slash = (file) => file.split(path.sep).join("/");

export function scanCore(coreDir) {
  const ts = createRequire(path.join(coreDir, "package.json"))("typescript");
  const root = path.join(coreDir, "src/backend");
  const lit = (node) => {
    if (!node) return null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return node.text;
    return null;
  };

  const prefix = new Map();
  const mounts = [];
  const regFns = new Map();
  const regCalls = [];
  const defaultExport = new Map();
  const importsOf = new Map();
  const calls = [];
  const sockets = [];

  for (const full of walkFiles(root)) {
    const file = slash(full);
    const sf = ts.createSourceFile(
      full,
      fs.readFileSync(full, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = new Map();
    importsOf.set(file, imports);
    const visit = (node) => {
      if (
        ts.isImportDeclaration(node) &&
        node.importClause &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const spec = node.moduleSpecifier.text;
        if (spec.startsWith(".")) {
          const target = slash(
            path.resolve(path.dirname(full), spec.replace(/\.js$/, ".ts")),
          );
          if (node.importClause.name)
            imports.set(node.importClause.name.text, {
              file: target,
              name: "default",
            });
          const bindings = node.importClause.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
              imports.set(element.name.text, {
                file: target,
                name: (element.propertyName || element.name).text,
              });
            }
          }
        }
      }
      if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
        defaultExport.set(file, node.expression.text);
      }
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        node.parameters.length
      ) {
        const first = node.parameters[0];
        const type = first.type ? first.type.getText() : "";
        if (
          /Router|Express|Application/.test(type) &&
          ts.isIdentifier(first.name)
        ) {
          regFns.set(node.name.text, { file, param: first.name.text });
        }
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (
          ts.isIdentifier(callee) &&
          callee.text === "registerCoreWsRoute" &&
          lit(node.arguments[0])
        ) {
          sockets.push({
            method: "WS",
            path: `/plugin-ws/core${lit(node.arguments[0])}`,
            file,
          });
        }
        if (
          ts.isIdentifier(callee) &&
          node.arguments.length &&
          ts.isIdentifier(node.arguments[0])
        ) {
          regCalls.push({ fn: callee.text, file, arg: node.arguments[0].text });
        }
        if (
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression)
        ) {
          const recv = callee.expression.text;
          const method = callee.name.text;
          if (method === "use") {
            const mount = lit(node.arguments[0]);
            if (mount !== null) {
              for (const arg of node.arguments.slice(1)) {
                if (ts.isIdentifier(arg))
                  mounts.push({
                    fromKey: `${file}|${recv}`,
                    prefix: mount,
                    file,
                    name: arg.text,
                  });
              }
            }
          } else if (
            METHODS.has(method) &&
            !SKIP_RECV.has(recv) &&
            node.arguments.length >= 2
          ) {
            const first = node.arguments[0];
            const paths = ts.isArrayLiteralExpression(first)
              ? first.elements.map(lit)
              : [lit(first)];
            for (const p of paths) {
              if (p !== null && p.startsWith("/")) {
                calls.push({
                  file,
                  recv,
                  method: method.toUpperCase(),
                  path: p,
                  line:
                    sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                });
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  prefix.set(`${slash(path.join(root, "database/database.ts"))}|app`, [""]);
  const routerKey = (file, name) => {
    const imported = importsOf.get(file)?.get(name);
    if (!imported) return `${file}|${name}`;
    const local =
      imported.name === "default"
        ? defaultExport.get(imported.file)
        : imported.name;
    return `${imported.file}|${local || name}`;
  };
  for (let round = 0; round < 8; round++) {
    for (const mount of mounts) {
      const from = prefix.get(mount.fromKey);
      if (!from) continue;
      const to = routerKey(mount.file, mount.name);
      const set = new Set(prefix.get(to) || []);
      for (const value of from) set.add(value + mount.prefix);
      prefix.set(to, [...set]);
    }
    for (const reg of regCalls) {
      const target = regFns.get(reg.fn);
      if (!target) continue;
      const from = prefix.get(`${reg.file}|${reg.arg}`);
      if (!from) continue;
      const key = `${target.file}|${target.param}`;
      const set = new Set(prefix.get(key) || []);
      for (const value of from) set.add(value);
      prefix.set(key, [...set]);
    }
  }

  const rows = [];
  const unresolved = [];
  for (const c of calls) {
    const prefixes = prefix.get(`${c.file}|${c.recv}`);
    if (!prefixes) {
      unresolved.push(
        `${c.method} ${c.path} (${path.relative(coreDir, c.file)}:${c.line})`,
      );
      continue;
    }
    for (const p of prefixes) {
      rows.push({
        method: c.method,
        path: (p + c.path).replace(/\/+$/, "") || "/",
        file: slash(path.relative(coreDir, c.file)),
        line: c.line,
      });
    }
  }
  for (const manual of MANUAL) rows.push({ ...manual, file: null, line: null });
  for (const socket of sockets)
    rows.push({ ...socket, file: slash(path.relative(coreDir, socket.file)) });
  return { rows, unresolved };
}
