/**
 * Compiles plugin backend TypeScript, then copies plugins/ into dist/plugins
 * so bundled first-party plugins ship with a built server.
 *
 * Most plugin backend entries are hand-written .mjs plus a manifest.json --
 * tsc only emits .ts, so without a copy step the plugins directory simply
 * would not exist in dist and the loader would find nothing.
 *
 * docker, host-metrics and remote-desktop are the exception: their backends
 * are real TypeScript, physically relocated from src/backend/hosts/docker/,
 * src/backend/hosts/metrics/ and src/backend/hosts/guacamole/ rather than
 * kept as hand-written JS, because each is thousands of lines of typed
 * SSH/session (or, for remote-desktop, guacd protocol) logic that is not
 * worth hand-transpiling. tsconfig.plugins.json compiles each plugin backend's
 * TypeScript to a sibling .js next to its source. Their imports into core
 * (e.g. "../../../src/backend/utils/logger.js") are written relative to the
 * TypeScript SOURCE tree so tsc can type-check them, since plugins/ is not
 * under tsconfig.node.json's rootDir and cannot be added to it without
 * changing every existing dist/backend/backend/... path in the codebase.
 * That means the emitted .js still points at src/backend/, which does not
 * exist in a built server -- only its compiled counterpart at
 * dist/backend/backend/ does. rewriteCoreImports() below corrects that one
 * prefix after compilation, for every plugins/*\/backend directory tsc
 * compiled, before the directory is copied into dist/.
 *
 * getBundledPluginsDir() in src/backend/plugins/paths.ts resolves
 * dist/backend/backend/plugins -> dist/plugins, which is where this writes.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "plugins");
const destination = path.join(root, "dist", "plugins");

if (!fs.existsSync(source)) {
  console.log("No plugins/ directory, nothing to bundle.");
  process.exit(0);
}

const SRC_BACKEND_PREFIX = "../../../src/backend/";
const COMPILED_BACKEND_PREFIX = "../../../backend/backend/";

function compilePluginBackends() {
  execSync("npx tsc -p tsconfig.plugins.json", {
    cwd: root,
    stdio: "inherit",
  });
}

/**
 * Rewrites the compiled plugin JS's imports into core from the source-tree
 * path tsc needed to resolve them, to the compiled-output path they need to
 * resolve at runtime. See the module comment above for why this exists.
 */
function rewriteCoreImports(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteCoreImports(entryPath);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;

    const original = fs.readFileSync(entryPath, "utf8");
    if (!original.includes(SRC_BACKEND_PREFIX)) continue;

    const rewritten = original
      .split(SRC_BACKEND_PREFIX)
      .join(COMPILED_BACKEND_PREFIX);
    fs.writeFileSync(entryPath, rewritten);
  }
}

/**
 * tsconfig.plugins.json has rootDir/outDir "." so the docker plugin's .js
 * lands beside its own .ts, but tsc also pulls every file the plugin
 * imports into the same program for type-checking -- core utils, repository
 * factories, src/types -- and stray-emits a sibling .js next to each of
 * those .ts files too, even though none of that code is actually compiled
 * by this pass (only referenced for types/signatures). Those stray files
 * are not part of the normal build and must not leak into dist/ or the
 * working tree, so anything under src/ that is a .js with no git history
 * and a same-named .ts sibling gets removed after every compile.
 */
function isGitTracked(filePath) {
  try {
    execSync(`git ls-files --error-unmatch "${filePath}"`, {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function removeStrayEmits(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeStrayEmits(entryPath);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    const tsSibling = entryPath.slice(0, -".js".length) + ".ts";
    // Never touch a tracked file, even if some future .ts/.js pair
    // legitimately coexists -- only remove what is both untracked and has a
    // .ts sibling, which is what a stray tsc emit always looks like.
    if (fs.existsSync(tsSibling) && !isGitTracked(entryPath)) {
      fs.rmSync(entryPath);
    }
  }
}

/**
 * Every plugin directory with a backend/ that tsc actually compiled (i.e. it
 * has a .ts file in it, not just a hand-written index.mjs). Scanned rather
 * than hardcoded so a future plugin only needs a tsconfig.plugins.json entry,
 * not a second call site here.
 */
function compiledPluginBackendDirs() {
  return fs
    .readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(source, entry.name, "backend"))
    .filter(
      (dir) =>
        fs.existsSync(dir) &&
        fs.readdirSync(dir).some((name) => name.endsWith(".ts")),
    );
}

/**
 * Deletes every .js file tsc just emitted directly under a plugin's own
 * backend/ directory (recursively), leaving its .ts siblings untouched.
 *
 * Without this, the compiled .js sits next to the .ts in plugins/ after every
 * build, shadowing the source when vitest/tsx resolve an import -- and since
 * those .js files were rewritten for the dist/ layout (see rewriteCoreImports),
 * their relative paths are wrong at the plugins/ depth, so anything importing
 * them from a test fails with "Cannot find module". .gitignore already
 * expects plugins/*\/backend/**\/*.js to never be tracked; this is what keeps
 * the working tree matching that after a local build, the same way dist/ is
 * expected to hold the only copy of compiled plugin output.
 */
function removeCompiledPluginEmits(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeCompiledPluginEmits(entryPath);
      continue;
    }
    if (entry.name.endsWith(".js")) fs.rmSync(entryPath);
  }
}

compilePluginBackends();
const compiledDirs = compiledPluginBackendDirs();
for (const dir of compiledDirs) {
  rewriteCoreImports(dir);
}
removeStrayEmits(path.join(root, "src"));

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });

for (const dir of compiledDirs) {
  removeCompiledPluginEmits(dir);
}

const bundled = fs
  .readdirSync(destination, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

console.log(`Bundled ${bundled.length} plugin(s): ${bundled.join(", ")}`);
