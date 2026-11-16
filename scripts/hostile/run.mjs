#!/usr/bin/env node
// Hostile plugin suite: installs plugins built to attack the sandbox on a
// real server, runs every attack and fails when any of them works.
//
//   node scripts/hostile/run.mjs --local
//       starts the built backend (npm run build:backend:core) on a temp dir
//   node scripts/hostile/run.mjs --url http://localhost:8080 --container termix
//       a server already running with the fixtures staged (Docker in CI)
//
//   node scripts/hostile/run.mjs --stage dist/plugins --local-plugins <dir>
//       only builds the fixtures and stages them with every built plugin
//
// Options: --local-plugins <dir> stages every built plugin repo in <dir> too,
// --only <text,...> attacks whose id holds the text, --no-browser skips the
// frame checks, --report <file> writes every row as JSON, --keep keeps the
// temp data dir, --hold seeds a server and leaves it up for a look.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { call, must } from "../authz/lib/client.mjs";
import { createWorkspace, startServer } from "../authz/lib/server.mjs";
import {
  ALL,
  BACKEND,
  FRAME,
  LEAKS,
  PAGE,
  RUNNER,
  SUPPLY,
} from "./lib/expect.mjs";
import { evaluate, summarize } from "./lib/evaluate.mjs";
import {
  buildFixtures,
  coreDir,
  FIXTURES,
  stagePlugins,
} from "./lib/stage.mjs";
import { startExfil, startTarget } from "./lib/targets.mjs";
import { runBackend } from "./lib/backend.mjs";
import {
  finishExpiryProbe,
  runTokens,
  startExpiryProbe,
} from "./lib/tokens.mjs";
import { runSupply } from "./lib/supply.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const log = (message) => console.log(`[hostile] ${message}`);

const PASSWORD = `Hostile-${crypto.randomBytes(9).toString("base64url")}!`;
const ADMIN = "hostile-admin";
const OTHER = "hostile-other";

async function login(base, username) {
  const res = await call(base, {
    method: "POST",
    path: "/users/login",
    body: { username, password: PASSWORD },
  });
  const cookie = res.setCookie.find((v) => /^(__Host-)?jwt=/.test(v));
  if (res.status !== 200 || !cookie) {
    throw new Error(`login ${username} gave ${res.status}: ${res.text}`);
  }
  const token = decodeURIComponent(cookie.split(";")[0].split("=")[1]);
  return { token, userId: res.json?.userId };
}

async function seed(base) {
  await must(base, {
    method: "POST",
    path: "/users/create",
    body: { username: ADMIN, password: PASSWORD },
  });
  const adminLogin = await login(base, ADMIN);
  const admin = { id: "admin", token: adminLogin.token };
  await must(base, {
    method: "POST",
    path: "/users/admin-create",
    identity: admin,
    body: { username: OTHER, password: PASSWORD },
  });
  const otherLogin = await login(base, OTHER);
  return {
    admin,
    adminId: adminLogin.userId,
    other: { id: "other", token: otherLogin.token },
    otherUserId: otherLogin.userId,
  };
}

async function enableFixtures(base, admin) {
  const plugins = await must(base, { path: "/plugins", identity: admin });
  const states = {};
  for (const id of FIXTURES) {
    const plugin = plugins.find((p) => p.id === id);
    if (!plugin) throw new Error(`${id} is not staged on this server`);
    if (!plugin.enabled) {
      const res = await call(base, {
        method: "PATCH",
        path: `/plugins/${id}/state`,
        identity: admin,
        body: { enabled: true },
      });
      if (res.status !== 200)
        log(`could not turn on ${id}: ${res.status} ${res.text}`);
    }
  }
  // Settles the fresh install's plugin picker with everything on, so the
  // browser does not have to.
  const all = await must(base, { path: "/plugins", identity: admin });
  // Starting every plugin in one go takes minutes when they share core's
  // user (fork mode), longer than the client's usual wait.
  const applied = await fetch(`${base}/plugins/onboarding/apply`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      choices: Object.fromEntries(all.map((p) => [p.id, "enabled"])),
    }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!applied.ok) {
    throw new Error(`onboarding apply gave ${applied.status}`);
  }
  for (const plugin of await must(base, {
    path: "/plugins",
    identity: admin,
  })) {
    if (FIXTURES.includes(plugin.id)) states[plugin.id] = plugin.state;
  }
  return states;
}

async function waitFor(check, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function docker(container, command) {
  const result = spawnSync("docker", ["exec", container, "sh", "-c", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`docker exec failed: ${result.stderr}`);
  }
  return result.stdout;
}

function listEscapes(root) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith("hostile-escaped")) found.push(full);
      if (entry.isDirectory() && entry.name !== "node_modules")
        walk(full, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

/** Removes a link without touching what it points at. */
function removeLink(link) {
  let stat;
  try {
    stat = fs.lstatSync(link);
  } catch {
    return;
  }
  if (!stat.isSymbolicLink()) return;
  try {
    fs.unlinkSync(link);
  } catch {
    // A Windows junction goes with rmdir.
    fs.rmdirSync(link);
  }
}

function printRows(rows) {
  const width = Math.max(...rows.map((row) => row.id.length));
  for (const row of rows) {
    const mark = { pass: "ok  ", fail: "FAIL", skip: "skip", limit: "lim " }[
      row.status
    ];
    const detail =
      row.status === "pass"
        ? ""
        : ` | ${row.why}${row.detail ? ` | ${row.detail}` : ""}`;
    console.log(`${mark} ${row.id.padEnd(width)}${detail}`);
  }
}

async function main() {
  const only = value("--only")?.split(",");
  const local = flag("--local");
  const url = value("--url");
  // Only build and stage, for a server started apart (the Docker image).
  if (value("--stage")) {
    buildFixtures(log);
    const staged = stagePlugins(path.resolve(value("--stage")), {
      localParents: value("--local-plugins") ? [value("--local-plugins")] : [],
    });
    log(`staged ${staged.ids.length} plugins in ${staged.target}`);
    return;
  }
  if (!local && !url)
    throw new Error("Pass --local, --url <server> or --stage <dir>");

  // Its own UI build, so a run never empties dist under npm run dev. Not under
  // a dot folder: Express refuses to send files from one.
  const uiDir = path.resolve(
    value("--ui") ?? path.join(coreDir, "node_modules/hostile-ui"),
  );
  const envCanary =
    process.env.HOSTILE_ENV_CANARY || crypto.randomBytes(12).toString("hex");
  const target = await startTarget(local ? "127.0.0.1" : "0.0.0.0");
  const exfil = await startExfil();
  let server = null;
  let workspace = null;
  const world = {
    password: PASSWORD,
    adminName: ADMIN,
    otherName: OTHER,
    envCanary,
    exfil,
  };

  try {
    if (local) {
      buildFixtures(log);
      workspace = createWorkspace();
      const staged = stagePlugins(
        path.join(
          coreDir,
          "node_modules/.cache/hostile",
          path.basename(workspace.workDir),
        ),
        {
          localParents: value("--local-plugins")
            ? [value("--local-plugins")]
            : [],
          // The shell needs a layout and a theme to draw anything.
          localRepos: ["Plugin-Classic-Layout", "Plugin-Classic-Themes"]
            .map((name) => path.join(coreDir, "../Plugins", name))
            .filter((repo) => fs.existsSync(path.join(repo, "dist"))),
        },
      );
      log(`staged ${staged.ids.length} plugins`);
      const dataDir = path.join(workspace.workDir, "data");
      // The backend serves the web UI from ./dist when it has one.
      if (!flag("--no-browser")) {
        if (!fs.existsSync(path.join(uiDir, "index.html"))) {
          throw new Error(
            `No web build in ${uiDir}. Run npm run hostile:ui first, or pass --no-browser.`,
          );
        }
        fs.symlinkSync(uiDir, path.join(workspace.workDir, "dist"), "junction");
      }
      fs.writeFileSync(
        path.join(dataDir, "hostile-canary.txt"),
        `canary-${envCanary}`,
      );
      server = await startServer({
        coreDir,
        pluginsDir: staged.target,
        workDir: workspace.workDir,
        log,
        env: {
          TERMIX_HOSTILE_CANARY: envCanary,
          TERMIX_PLUGIN_ALWAYS_ON: FIXTURES.join(","),
          TERMIX_FRAME_DIR: path.join(uiDir, "frame"),
        },
      });
      Object.assign(world, {
        base: server.base,
        dataDir,
        coreRoot: coreDir,
        coreUrlFromPlugin: server.base,
        listenPort: target.port,
        redirect: true,
        findEscapes: async () => [
          ...listEscapes(workspace.workDir),
          ...listEscapes(path.dirname(staged.target)),
        ],
      });
    } else {
      const container = value("--container");
      const dataDir = value("--data-dir") ?? "/app/data";
      const corePort = Number(value("--core-port") ?? 30001);
      if (container) {
        docker(
          container,
          `printf 'canary-%s' '${envCanary}' > '${dataDir}/hostile-canary.txt'`,
        );
      }
      Object.assign(world, {
        base: url.replace(/\/+$/, ""),
        dataDir,
        coreRoot: value("--core-root") ?? "/app",
        coreUrlFromPlugin: `http://127.0.0.1:${corePort}`,
        listenPort: corePort,
        redirect: false,
        findEscapes: async () =>
          container
            ? docker(
                container,
                "find / -xdev -name 'hostile-escaped*' 2>/dev/null || true",
              )
                .split("\n")
                .filter(Boolean)
            : [],
      });
    }
    world.canaryFile = `${world.dataDir}/hostile-canary.txt`;
    world.screenshotDir = value("--screenshots") ?? workspace?.workDir;

    const ids = await seed(world.base);
    Object.assign(world, ids);
    const states = await enableFixtures(world.base, world.admin);
    log(`fixture states: ${JSON.stringify(states)}`);
    await must(world.base, {
      method: "PUT",
      path: "/plugins/hostile-backend/settings/admin",
      identity: world.admin,
      body: { allowedHost: "127.0.0.1" },
    });
    await waitFor(
      async () =>
        (
          await call(world.base, {
            path: "/plugin-api/hostile-backend/info",
            identity: world.admin,
          })
        ).status === 200,
      60_000,
      "hostile-backend to answer",
    );
    if (flag("--hold")) {
      await must(world.base, {
        method: "PUT",
        path: "/plugins/hostile-frame/settings/admin",
        identity: world.admin,
        body: { exfilOrigin: exfil.origin },
      });
      log(`holding ${world.base} (${ADMIN} / ${PASSWORD}); stop with Ctrl+C`);
      fs.writeFileSync(
        path.join(workspace?.workDir ?? ".", "hold.json"),
        JSON.stringify({ base: world.base, user: ADMIN, password: PASSWORD }),
      );
      await new Promise(() => {});
    }

    if (local) {
      world.dataFiles = fs
        .readdirSync(world.dataDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(world.dataDir, entry.name));
    } else if (value("--container")) {
      world.dataFiles = docker(
        value("--container"),
        `find '${world.dataDir}' -maxdepth 1 -type f`,
      )
        .split("\n")
        .filter(Boolean);
    } else {
      world.dataFiles = [];
    }

    const wantsExpiry =
      !only || only.some((text) => "token.expired".includes(text));
    const probe = wantsExpiry ? await startExpiryProbe(world) : null;
    const results = {};
    const backend = await runBackend(world, log);
    Object.assign(results, backend.results);
    Object.assign(results, await runTokens(world, log));
    Object.assign(results, await runSupply(world, log));
    let groups = { ...BACKEND, ...RUNNER, ...SUPPLY };
    if (!flag("--no-browser")) {
      const { runFrame } = await import("./lib/frame.mjs");
      Object.assign(results, await runFrame(world, log));
      groups = { ...groups, ...FRAME, ...LEAKS, ...PAGE };
    }
    if (probe)
      Object.assign(results, await finishExpiryProbe(world, probe, log));

    const picked = only
      ? Object.fromEntries(
          Object.entries(results).filter(([id]) =>
            only.some((text) => id.includes(text)),
          ),
        )
      : results;
    const required = only ? Object.keys(picked) : Object.keys(groups);
    const rows = evaluate(picked, ALL, {
      channel: backend.channel,
      flags: world.redirect ? [] : ["no-redirect"],
      required,
    });
    printRows(rows);
    const summary = summarize(rows);
    log(
      `${summary.pass} passed, ${summary.fail} failed, ${summary.skip} skipped, ${summary.limit} known limits (channel ${backend.channel})`,
    );
    const report = value("--report");
    if (report) {
      fs.writeFileSync(
        report,
        `${JSON.stringify({ channel: backend.channel, rows }, null, 2)}\n`,
      );
    }
    process.exitCode = summary.fail ? 1 : 0;
  } finally {
    await server?.stop();
    await target.close();
    await exfil.close();
    if (workspace) removeLink(path.join(workspace.workDir, "dist"));
    if (workspace && !flag("--keep")) workspace.cleanup();
    else if (workspace) log(`kept ${workspace.workDir}`);
  }
}

main().catch((error) => {
  console.error(`[hostile] ${error.stack ?? error}`);
  process.exitCode = 1;
});
