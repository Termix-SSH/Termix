// Loads tables, checks coverage and runs every cell.
import fs from "node:fs";
import { call, must, openSocket } from "./client.mjs";
import { OWNER_MARK } from "./seed.mjs";
import {
  IDENTITIES,
  callsAllowed,
  expectFor,
  fillPath,
  judgeHttp,
  judgeSocket,
  methodOrder,
  splitKey,
} from "./rules.mjs";

/** Whether a reply carries anything that belongs to the owner. */
export function leaksOwner(text, world) {
  if (!text) return false;
  if (text.includes(OWNER_MARK)) return true;
  return !!world.users?.owner && text.includes(world.users.owner);
}

const SCHEMA = JSON.parse(
  fs.readFileSync(new URL("../authz.schema.json", import.meta.url), "utf8"),
);

/** The checks from authz.schema.json that catch typos: unknown fields and bad values. */
export function checkTable(table) {
  const problems = [];
  const entryProps = SCHEMA.$defs.entry.properties;
  const identities = new Set(SCHEMA.$defs.identity.enum);
  for (const key of Object.keys(table)) {
    if (!(key in SCHEMA.properties)) problems.push(`unknown field "${key}"`);
  }
  for (const [key, entry] of Object.entries(table.routes ?? {})) {
    if (!/^(GET|POST|PUT|PATCH|DELETE|ALL|WS) \//.test(key))
      problems.push(`bad route key "${key}"`);
    for (const field of Object.keys(entry)) {
      if (!(field in entryProps))
        problems.push(`${key}: unknown field "${field}"`);
    }
    if (!entryProps.access.enum.includes(entry.access))
      problems.push(`${key}: access must be public, user or admin`);
    for (const who of Object.keys(entry.expect ?? {})) {
      if (!identities.has(who))
        problems.push(`${key}: unknown identity "${who}" in expect`);
    }
    for (const who of entry.allow ?? []) {
      if (!["pending", "setup", "guest"].includes(who))
        problems.push(`${key}: allow takes pending, setup or guest`);
    }
  }
  for (const step of table.seed ?? []) {
    if (step.as && !identities.has(step.as))
      problems.push(`seed ${step.path}: unknown identity "${step.as}"`);
  }
  return problems;
}

export function loadTable(file) {
  const table = JSON.parse(fs.readFileSync(file, "utf8"));
  table.problems = checkTable(table);
  table.file = file;
  table.routes ??= {};
  table.seed ??= [];
  return table;
}

const normalize = (path) => path.replace(/\/+$/, "") || "/";

/** Compares a table with the routes actually served. */
export function coverage(table, served, { pluginId } = {}) {
  const problems = [];
  const keys = Object.keys(table.routes);
  const listed = new Set(
    keys.map((key) => {
      const { method, path } = splitKey(key);
      return `${method} ${normalize(path)}`;
    }),
  );
  const seen = new Set();
  for (const route of served) {
    const key = `${route.method} ${normalize(route.path)}`;
    if (route.partial) {
      // Mounted under a prefix Express does not keep: any entry ending in it.
      const prefix = pluginId ? `/plugin-api/${pluginId}` : "";
      const tail = normalize(route.path).slice(prefix.length);
      const match = keys.find((candidate) => {
        const { method, path } = splitKey(candidate);
        return method === route.method && normalize(path).endsWith(tail);
      });
      if (match) seen.add(match);
      else
        problems.push(
          `no entry for ${route.method} ${route.path} (nested router)`,
        );
      continue;
    }
    if (listed.has(key)) {
      seen.add(
        keys.find((candidate) => {
          const { method, path } = splitKey(candidate);
          return `${method} ${normalize(path)}` === key;
        }),
      );
    } else {
      problems.push(`no entry for ${key}`);
    }
  }
  for (const key of keys) {
    if (seen.has(key)) continue;
    if (table.routes[key].unlisted) continue;
    problems.push(
      `entry ${key} matches no served route (remove it, or say why in "unlisted")`,
    );
  }
  return problems;
}

function substitute(value, fixtures) {
  if (typeof value === "string") {
    const whole = /^\{\{(\w[\w.-]*)\}\}$/.exec(value);
    if (whole) return fixtures[whole[1]];
    return value.replace(/\{\{(\w[\w.-]*)\}\}/g, (_m, name) =>
      String(fixtures[name] ?? ""),
    );
  }
  if (Array.isArray(value))
    return value.map((item) => substitute(item, fixtures));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, substitute(v, fixtures)]),
    );
  }
  return value;
}

/** Reads a dotted path; "-1" on an array is its last item. */
function pick(json, path) {
  return path.split(".").reduce((value, part) => {
    if (value == null) return undefined;
    if (Array.isArray(value) && part === "-1") return value[value.length - 1];
    return value[part];
  }, json);
}

/** Runs a table's seed steps; each can capture values from the reply. Returns the problems. */
export async function runSeed(base, table, world, log) {
  const problems = [];
  for (const step of table.seed) {
    const label = `seed ${step.method ?? "POST"} ${step.path}`;
    if (step.todo) {
      problems.push(`${label}: ${step.todo}`);
      continue;
    }
    const res = await call(base, {
      method: step.method ?? "POST",
      path: substitute(step.path, world.fixtures),
      identity: world.ids[step.as ?? "owner"],
      body: substitute(step.body, world.fixtures),
      query: substitute(step.query, world.fixtures),
    });
    if (res.status < 200 || res.status >= 300) {
      problems.push(
        `${label}: ${res.status} ${res.text?.slice(0, 200) ?? res.error}`,
      );
      continue;
    }
    for (const [name, from] of Object.entries(step.capture ?? {})) {
      const value = pick(res.json, from);
      if (value === undefined)
        problems.push(`${label}: no ${from} in ${res.text?.slice(0, 200)}`);
      else world.fixtures[name] = value;
    }
  }
  log?.(`seeded ${table.seed.length} step(s) from ${table.file}`);
  return problems;
}

async function pool(items, size, work) {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(size, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        await work(items[index]);
      }
    },
  );
  await Promise.all(runners);
}

export async function runMatrix(base, tables, world, { only, log } = {}) {
  const cells = [];
  for (const table of tables) {
    for (const [key, entry] of Object.entries(table.routes)) {
      if (entry.skip) continue;
      const { method, path } = splitKey(key);
      if (only && !only.some((part) => key.includes(part))) continue;
      cells.push({ table, key, method, path, entry });
    }
  }
  cells.sort((a, b) => methodOrder(a.method) - methodOrder(b.method));

  const failures = [];
  let calls = 0;
  const runCell = async ({ table, key, method, path, entry }) => {
    const filled = fillPath(path, entry, world.fixtures);
    if (filled.missing.length) {
      failures.push({
        key,
        identity: "*",
        why: `no value for ${filled.missing.join(", ")}`,
        file: table.file,
      });
      return;
    }
    let body = substitute(
      entry.body ?? (method === "GET" ? undefined : {}),
      world.fixtures,
    );
    let query = substitute(entry.query, world.fixtures);
    // A resource named by a field rather than the path goes in both places.
    const field = entry.resource?.key;
    if (field) {
      const value =
        world.fixtures[entry.resource.fixture ?? entry.resource.kind];
      query = { ...(query ?? {}), [field]: value };
      if (body && typeof body === "object" && !Array.isArray(body))
        body = { [field]: value, ...body };
    }
    const results = {};
    for (const identity of IDENTITIES) {
      const expected = expectFor(
        entry,
        identity,
        method,
        path,
        world.memberPermissions,
      );
      if (expected === "any") continue;
      if (
        (expected === "allow" || expected === "public") &&
        !callsAllowed(entry, method)
      )
        continue;
      const who = world.ids[identity];
      if (!who) continue;
      calls++;
      if (method === "WS") {
        const result = await openSocket(base, {
          path: filled.path,
          identity: who,
          query,
          send: substitute(entry.send ?? [], world.fixtures),
          waitMs: entry.waitMs ?? 1200,
        });
        results[identity] = result;
        const verdict = judgeSocket(
          expected,
          result,
          entry.refusalCloseCodes,
          entry.refuseReply,
        );
        if (!verdict.ok)
          failures.push({ key, identity, why: verdict.why, file: table.file });
        continue;
      }
      const started = Date.now();
      const res = await call(base, {
        method,
        path: filled.path,
        identity: who,
        body,
        query,
        headers: entry.headers,
      });
      const took = Date.now() - started;
      if (took > 10_000) {
        log?.(
          `slow: ${key} as ${identity} took ${Math.round(took / 1000)}s (${res.status})`,
        );
      }
      results[identity] = res.status;
      // A scoped route answers a stranger with a no-op success; the owner's
      // copy is checked after the entry instead.
      const success = res.status >= 200 && res.status < 300;
      let verdict;
      if (entry.scoped && expected === "refuse" && success)
        verdict = { ok: true };
      else if (entry.filtered && expected === "refuse" && success) {
        // A list filtered to the caller: fine as long as nothing of the owner's is in it.
        verdict = leaksOwner(res.text, world)
          ? { ok: false, why: "filtered reply holds the owner's data" }
          : { ok: true };
      } else if (
        (entry.allowed === "any" || entry.refuse400) &&
        expected === "refuse" &&
        (res.status === 400 || res.status === 422)
      ) {
        // No such resource exists, or the body names something of the owner's
        // and is refused for that (the entry says why).
        verdict = { ok: true };
      } else verdict = judgeHttp(expected, res.status);
      if (!verdict.ok) {
        failures.push({
          key,
          identity,
          why: verdict.why,
          file: table.file,
          body: res.text?.slice(0, 160),
        });
      }
    }
    if (entry.scoped) {
      const check = await call(base, {
        path: substitute(entry.scoped.path, world.fixtures),
        identity: world.ids[entry.scoped.as ?? "owner"],
      });
      const wanted = String(substitute(entry.scoped.contains, world.fixtures));
      if (check.status !== 200 || !check.text.includes(wanted)) {
        failures.push({
          key,
          identity: "*",
          why: `owner's ${wanted} is gone after other users called it`,
          file: table.file,
        });
      }
    }
  };

  // Reads can run side by side; writes go one at a time.
  const reads = cells.filter((cell) => methodOrder(cell.method) <= 1);
  const writes = cells.filter((cell) => methodOrder(cell.method) > 1);
  let done = 0;
  const step = async (cell) => {
    await runCell(cell);
    done++;
    if (done % 100 === 0) log?.(`${done}/${cells.length} entries`);
  };
  await pool(reads, 6, step);
  for (const cell of writes) await step(cell);
  log?.(`ran ${cells.length} entries, ${calls} calls`);
  return failures;
}
