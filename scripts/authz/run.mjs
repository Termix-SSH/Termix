#!/usr/bin/env node
// Authorization matrix: boots core with its plugins, seeds every identity and
// calls every route and socket as each one, then compares with authz.json.
//
//   node scripts/authz/run.mjs                      core table only
//   node scripts/authz/run.mjs --plugin-tables ../Plugins
//   node scripts/authz/run.mjs --plugin ../Plugins/Plugin-Snippets --no-core
//
// Options: --plugins <dir> staged plugins (default dist/plugins),
// --local-plugins <dir> stages every built plugin repo in <dir> for this run,
// --local-plugin <repo> stages one built plugin repo (both repeat),
// --only <text,...> entries whose key contains the text, --keep keeps the
// temp data dir, --report <file> writes the failures as JSON, --seed-only
// stops after seeding.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createWorkspace, startServer } from "./lib/server.mjs";
import { startFakeSsh } from "./lib/fake-ssh.mjs";
import { PASSWORD, seedFirstBoot, seedGuest, seedWorld } from "./lib/seed.mjs";
import { openSocket } from "./lib/client.mjs";
import { coverage, loadTable, runMatrix, runSeed } from "./lib/matrix.mjs";
import { scanCore } from "./lib/inventory.mjs";

const coreDir = path.resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const values = (name) =>
  args.flatMap((arg, index) =>
    arg === name && args[index + 1] ? [args[index + 1]] : [],
  );

const log = (message) => console.log(`[authz] ${message}`);

function pluginTables() {
  const found = [];
  for (const dir of values("--plugin")) found.push(path.resolve(dir));
  const root = value("--plugin-tables");
  if (root) {
    for (const name of fs.readdirSync(root)) {
      if (name.startsWith("Plugin-")) found.push(path.resolve(root, name));
    }
  }
  const tables = [];
  for (const dir of found) {
    const file = path.join(dir, "authz.json");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
    );
    if (!fs.existsSync(file)) {
      tables.push({ missing: true, file, pluginId: manifest.id });
      continue;
    }
    const table = loadTable(file);
    table.pluginId = manifest.id;
    tables.push(table);
  }
  return tables;
}

/**
 * Copies built plugin repos (each with dist/) into the run's own folder, so a
 * run never fights a dev build over dist/plugins.
 */
function stageLocal(parents, repos, workDir) {
  const lib = createRequire(import.meta.url)("../lib/bundled-plugins.cjs");
  // Inside the core checkout: plugins import the SDK from core's node_modules.
  const target = path.join(
    coreDir,
    "node_modules/.cache/authz",
    path.basename(workDir),
  );
  const builds = new Map();
  for (const parent of parents) {
    for (const [id, repo] of lib.findLocalPluginBuilds(path.resolve(parent)))
      builds.set(id, repo);
  }
  for (const repo of repos) {
    const { id } = JSON.parse(
      fs.readFileSync(path.join(repo, "manifest.json"), "utf8"),
    );
    builds.set(id, path.resolve(repo));
  }
  for (const [id, repo] of builds)
    lib.copyLocalBuild(repo, path.join(target, id));
  const pinned = lib.loadBundledPlugins(coreDir);
  const index = lib.buildBundledIndex(pinned, [...builds.keys()], "full");
  fs.writeFileSync(
    path.join(target, "bundled-index.json"),
    `${JSON.stringify(index, null, 2)}
`,
  );
  log(`staged ${builds.size} local plugin build(s)`);
  return target;
}

async function main() {
  const only = value("--only")?.split(",");
  const tables = [];
  const problems = [];

  if (!flag("--no-core")) {
    const table = loadTable(path.join(coreDir, "authz.json"));
    problems.push(...table.problems.map((p) => `core: ${p}`));
    const { rows, unresolved } = scanCore(coreDir);
    for (const route of unresolved)
      problems.push(`core: route with no known mount: ${route}`);
    problems.push(...coverage(table, rows).map((p) => `core: ${p}`));
    tables.push(table);
  }
  const plugins = pluginTables();
  for (const table of plugins) {
    if (table.missing)
      problems.push(`${table.pluginId}: no authz.json at ${table.file}`);
    else {
      problems.push(...table.problems.map((p) => `${table.pluginId}: ${p}`));
      tables.push(table);
    }
  }

  const workspace = createWorkspace();
  const staged =
    values("--local-plugins").length + values("--local-plugin").length > 0;
  const pluginsDir = staged
    ? stageLocal(
        values("--local-plugins"),
        values("--local-plugin"),
        workspace.workDir,
      )
    : path.resolve(value("--plugins") ?? path.join(coreDir, "dist/plugins"));
  const ssh = await startFakeSsh({ username: "authz", password: PASSWORD });
  let server;
  let failures = [];
  let closeGuest = () => {};
  try {
    server = await startServer({
      coreDir,
      pluginsDir,
      workDir: workspace.workDir,
      log,
    });
    await seedFirstBoot(server.base, log);
    await server.stop();
    // Plugins turned on after boot need a restart to be in the inventory.
    // Plugins that start on first use are started now, so their sockets
    // are listed too.
    server = await startServer({
      coreDir,
      pluginsDir,
      workDir: workspace.workDir,
      log,
      env: {
        TERMIX_PLUGIN_ALWAYS_ON: tables
          .map((table) => table.pluginId)
          .filter(Boolean)
          .join(","),
      },
    });

    const inventory = server.inventory();
    for (const table of tables.filter((t) => t.pluginId)) {
      const served = [...inventory.http, ...inventory.ws].filter(
        (route) =>
          route.path.startsWith(`/plugin-api/${table.pluginId}/`) ||
          route.path === `/plugin-api/${table.pluginId}` ||
          route.path.startsWith(`/plugin-ws/${table.pluginId}/`),
      );
      if (served.length === 0 && Object.keys(table.routes).length > 0) {
        problems.push(
          `${table.pluginId}: plugin serves nothing, is it staged and on?`,
        );
      }
      problems.push(
        ...coverage(table, served, { pluginId: table.pluginId }).map(
          (p) => `${table.pluginId}: ${p}`,
        ),
      );
    }

    const world = await seedWorld(server.base, {
      ssh: { port: ssh.port, username: "authz", password: PASSWORD },
      log,
    });
    world.sshPort = ssh.port;
    // The guest needs a live terminal and the share plugin.
    const sharing =
      inventory.ws.some(
        (route) => route.path === "/plugin-ws/ssh-terminal/terminal",
      ) &&
      inventory.http.some((route) =>
        route.path.startsWith("/plugin-api/session-sharing/"),
      );
    if (sharing) closeGuest = await seedGuest(server.base, world, log);
    for (const table of tables) {
      const where = table.pluginId ?? "core";
      problems.push(
        ...(await runSeed(server.base, table, world, log)).map(
          (p) => `${where}: ${p}`,
        ),
      );
    }

    const wait = flag("--seed-only")
      ? 0
      : (world.ids.expired.readyAt ?? 0) - Date.now();
    if (wait > 0) {
      log(`waiting ${Math.ceil(wait / 1000)}s for the idle session to expire`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }

    if (!flag("--seed-only"))
      failures = await runMatrix(server.base, tables, world, { only, log });
    if (sharing && !flag("--seed-only")) {
      // A read only guest can watch but never type into the owner's shell.
      const marker = "authz-guest-typed";
      await openSocket(server.base, {
        path: "/plugin-ws/ssh-terminal/terminal",
        identity: world.ids.guest,
        send: [{ type: "input", data: `${marker}\r` }],
        waitMs: 2000,
      });
      if (ssh.received.some((chunk) => chunk.includes(marker))) {
        failures.push({
          key: "WS /plugin-ws/ssh-terminal/terminal",
          identity: "guest",
          why: "a read only guest typed into the shell",
          file: "guest check",
        });
      }
    }
  } finally {
    closeGuest();
    await server?.stop().catch(() => {});
    await ssh.stop().catch(() => {});
    if (flag("--keep")) log(`kept ${workspace.workDir}`);
    else {
      workspace.cleanup();
      if (staged) fs.rmSync(pluginsDir, { recursive: true, force: true });
    }
  }

  const report = value("--report");
  if (report)
    fs.writeFileSync(report, JSON.stringify({ problems, failures }, null, 2));

  for (const problem of problems) console.log(`MISSING  ${problem}`);
  const byKey = new Map();
  for (const failure of failures) {
    const list = byKey.get(failure.key) ?? [];
    list.push(failure);
    byKey.set(failure.key, list);
  }
  for (const [key, list] of byKey) {
    console.log(`FAIL     ${key}`);
    for (const failure of list)
      console.log(`           ${failure.identity}: ${failure.why}`);
  }
  const total = problems.length + failures.length;
  log(
    total === 0
      ? "matrix green"
      : `${problems.length} coverage problem(s), ${failures.length} failing cell(s) in ${byKey.size} entr(ies)`,
  );
  process.exitCode = total === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
