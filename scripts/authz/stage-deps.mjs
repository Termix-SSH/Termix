#!/usr/bin/env node
// Clones and builds the plugins a plugin needs (manifest "dependencies"), so
// its authorization matrix can run in plugin CI.
//
//   node scripts/authz/stage-deps.mjs <pluginDir> <outDir>
//
// The seed also needs totp and login-security (pending, setup and expired
// sessions), so those are built too unless they are the plugin itself.
//
// Repos come from the official registry index. Only source is cloned: CI must
// never download a .tmxplug, which would count as a download.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const INDEX =
  "https://raw.githubusercontent.com/Termix-SSH/Termix-Registry/main/official/index.json";

const [pluginDir, outDir] = process.argv.slice(2);
if (!pluginDir || !outDir) {
  console.error("usage: stage-deps.mjs <pluginDir> <outDir>");
  process.exit(2);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const HARNESS = ["totp", "login-security"];
// npm.cmd needs a shell on Windows; git must not get one (paths with spaces).
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: cmd === "npm.cmd" });

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const index = await (await fetch(INDEX)).json();
  const byId = new Map(index.plugins.map((plugin) => [plugin.id, plugin]));
  const own = JSON.parse(
    fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf8"),
  );
  const done = new Set([own.id]);
  const queue = [path.resolve(pluginDir)];
  let first = true;
  while (queue.length) {
    const dir = queue.shift();
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
    );
    const wanted = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...(first ? HARNESS : []),
    ];
    first = false;
    for (const id of wanted) {
      if (done.has(id)) continue;
      done.add(id);
      const repository = byId.get(id)?.repository;
      if (
        !repository ||
        !/^https:\/\/github\.com\/Termix-SSH\//.test(repository)
      ) {
        throw new Error(`No official repository for dependency ${id}`);
      }
      const target = path.resolve(outDir, id);
      console.log(`building dependency ${id} from ${repository}`);
      run("git", ["clone", "--depth", "1", `${repository}.git`, target]);
      run(npm, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], target);
      const pkg = JSON.parse(
        fs.readFileSync(path.join(target, "package.json"), "utf8"),
      );
      if (pkg.scripts?.build) run(npm, ["run", "build"], target);
      else run(npm, ["exec", "--", "termix-plugin", "build"], target);
      queue.push(target);
    }
  }
  done.delete(own.id);
  console.log(done.size ? `staged ${[...done].join(", ")}` : "no dependencies");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
