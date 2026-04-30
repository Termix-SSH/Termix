const fs = require("node:fs");
const path = require("node:path");

const collectorPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "app-builder-lib",
  "out",
  "node-module-collector",
  "nodeModulesCollector.js",
);

const appFileCopierPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "app-builder-lib",
  "out",
  "util",
  "appFileCopier.js",
);

const moduleManagerPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "app-builder-lib",
  "out",
  "node-module-collector",
  "moduleManager.js",
);

function patchFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  let source = fs.readFileSync(filePath, "utf8");
  let changed = false;

  for (const { original, patched, name, alreadyPatched = [] } of replacements) {
    if (
      source.includes(patched) ||
      alreadyPatched.some((marker) => source.includes(marker))
    ) {
      continue;
    }

    if (!source.includes(original)) {
      console.warn(
        `app-builder-lib patch "${name}" was not applied; expected source was not found.`,
      );
      continue;
    }

    source = source.replace(original, patched);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, source);
  }
}

patchFile(collectorPath, [
  {
    name: "node module collector spawn shell",
    original: `                shell: true, // \`true\`\` is now required: https://github.com/electron-userland/electron-builder/issues/9488`,
    patched: `                shell: false, // Avoid Node DEP0190; .cmd files are wrapped through cmd.exe above.`,
  },
  {
    name: "node module collector output flush",
    alreadyPatched: [
      `                    outStream.end();
                }`,
    ],
    original: `                outStream.close();
                // https://github.com/npm/npm/issues/17624
                const shouldIgnore = code === 1 && "npm" === execName.toLowerCase() && args.includes("list");
                if (shouldIgnore) {
                    builder_util_1.log.debug(null, "\`npm list\` returned non-zero exit code, but it MIGHT be expected (https://github.com/npm/npm/issues/17624). Check stderr for details.");
                }
                if (stderr.length > 0) {
                    builder_util_1.log.debug({ stderr }, "note: there was node module collector output on stderr");
                    this.cache.logSummary[moduleManager_1.LogMessageByKey.PKG_COLLECTOR_OUTPUT].push(stderr);
                }
                const shouldResolve = code === 0 || shouldIgnore;
                return shouldResolve ? resolve() : reject(new Error(\`Node module collector process exited with code \${code}:\\n\${stderr}\`));`,
    patched: `                const finish = () => {
                    // https://github.com/npm/npm/issues/17624
                    const shouldIgnore = code === 1 && "npm" === execName.toLowerCase() && args.includes("list");
                    if (shouldIgnore) {
                        builder_util_1.log.debug(null, "\`npm list\` returned non-zero exit code, but it MIGHT be expected (https://github.com/npm/npm/issues/17624). Check stderr for details.");
                    }
                    if (stderr.length > 0) {
                        builder_util_1.log.debug({ stderr }, "note: there was node module collector output on stderr");
                        this.cache.logSummary[moduleManager_1.LogMessageByKey.PKG_COLLECTOR_OUTPUT].push(stderr);
                    }
                    const shouldResolve = code === 0 || shouldIgnore;
                    return shouldResolve ? resolve() : reject(new Error(\`Node module collector process exited with code \${code}:\\n\${stderr}\`));
                };
                if (outStream.writableFinished) {
                    finish();
                }
                else {
                    outStream.once("finish", finish);
                    outStream.end();
                }`,
  },
  {
    name: "node module collector finish guard",
    original: `                if (outStream.writableFinished || outStream.closed) {`,
    patched: `                if (outStream.writableFinished) {`,
  },
]);

patchFile(moduleManagerPath, [
  {
    name: "node module collector npm alias resolution",
    original: `    semverSatisfies(found, range) {
        if ((0, builder_util_1.isEmptyOrSpaces)(range) || range === "*") {`,
    patched: `    semverSatisfies(found, range, packageNameMatches = true) {
        if (!packageNameMatches) {
            return true;
        }
        if ((0, builder_util_1.isEmptyOrSpaces)(range) || range === "*") {`,
  },
  {
    name: "node module collector direct alias match",
    original: `            if (json && this.semverSatisfies(json.version, requiredRange)) {
                return { packageDir: path.dirname(direct), packageJson: json };
            }`,
    patched: `            if (json && this.semverSatisfies(json.version, requiredRange, json.name === pkgName)) {
                return { packageDir: path.dirname(direct), packageJson: json };
            }`,
  },
  {
    name: "node module collector alias match",
    original: `                if (json && this.semverSatisfies(json.version, requiredRange)) {
                    return { packageDir: path.dirname(candidate), packageJson: json };
                }`,
    patched: `                if (json && this.semverSatisfies(json.version, requiredRange, json.name === pkgName)) {
                    return { packageDir: path.dirname(candidate), packageJson: json };
                }`,
  },
  {
    name: "node module collector scoped alias match",
    original: `                                if (json && this.semverSatisfies(json.version, requiredRange)) {
                                    return { packageDir: path.dirname(candidatePkgJson), packageJson: json };
                                }`,
    patched: `                                if (json && this.semverSatisfies(json.version, requiredRange, json.name === pkgName)) {
                                    return { packageDir: path.dirname(candidatePkgJson), packageJson: json };
                                }`,
  },
  {
    name: "node module collector nested alias match",
    original: `                    if (json && this.semverSatisfies(json.version, requiredRange)) {
                        return { packageDir: path.dirname(candidatePkgJson), packageJson: json };
                    }`,
    patched: `                    if (json && this.semverSatisfies(json.version, requiredRange, json.name === pkgName)) {
                        return { packageDir: path.dirname(candidatePkgJson), packageJson: json };
                    }`,
  },
  {
    name: "node module collector nested direct alias match",
    original: `                    if (json && this.semverSatisfies(json.version, requiredRange)) {
                        return { packageDir: path.dirname(candidateDirect), packageJson: json };
                    }`,
    patched: `                    if (json && this.semverSatisfies(json.version, requiredRange, json.name === pkgName)) {
                        return { packageDir: path.dirname(candidateDirect), packageJson: json };
                    }`,
  },
]);

patchFile(appFileCopierPath, [
  {
    name: "node module collector fallback",
    original: `            const collector = (0, node_module_collector_1.getCollectorByPackageManager)(pm, dir, tempDirManager);
            deps = await collector.getNodeModules({ packageName: packager.metadata.name });
            if (deps.nodeModules.length > 0) {`,
    patched: `            const collector = (0, node_module_collector_1.getCollectorByPackageManager)(pm, dir, tempDirManager);
            try {
                deps = await collector.getNodeModules({ packageName: packager.metadata.name });
            }
            catch (error) {
                const isLastSearchDirectory = searchDirectories.indexOf(dir) >= searchDirectories.length - 1;
                const isLastPackageManager = pmApproaches.indexOf(pm) >= pmApproaches.length - 1;
                if (isLastSearchDirectory && isLastPackageManager) {
                    throw error;
                }
                builder_util_1.log.warn({ pm, searchDir: dir, error: error instanceof Error ? error.message : String(error) }, "node modules collection failed, trying fallback");
                continue;
            }
            if (deps.nodeModules.length > 0) {`,
  },
]);
