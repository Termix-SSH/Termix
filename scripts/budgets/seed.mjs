#!/usr/bin/env node
// Prepares a fresh server for the budget run: makes the first user (an
// admin), turns every installed plugin on through the setup picker and waits
// until they run. Telemetry stays off so CI never reports anything.
//
//   node scripts/budgets/seed.mjs --url http://localhost:8080
//     [--user budget] [--pass ...] [--timeout 600000]

import { parseArgs } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const base = String(args.url ?? "http://localhost:8080").replace(/\/+$/, "");
const user = String(args.user ?? "budget");
const pass = String(args.pass ?? "budget-pass-123");
const timeoutMs = Number(args.timeout ?? 600_000);
const KEEP_OFF = new Set(["telemetry"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await sleep(2000);
  }
  throw new Error("server did not answer /health");
}

async function call(method, path, { cookie, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: base,
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { response, data };
}

async function main() {
  await waitForServer();
  const created = await call("POST", "/users/create", {
    body: { username: user, password: pass },
  });
  if (!created.response.ok && created.response.status !== 409) {
    throw new Error(`could not create the user: ${created.response.status}`);
  }
  const login = await call("POST", "/users/login", {
    body: { username: user, password: pass },
  });
  if (!login.response.ok) {
    throw new Error(`could not log in: ${login.response.status}`);
  }
  // A browser session: the cookie, sent with this server as the origin.
  const cookie = (login.response.headers.getSetCookie?.() ?? [])
    .map((line) => line.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("no session cookie after login");

  const { data: picker } = await call("GET", "/plugins/onboarding", { cookie });
  const ids = (picker?.plugins ?? []).map((plugin) => plugin.id);
  const choices = Object.fromEntries(
    ids.map((id) => [id, KEEP_OFF.has(id) ? "disabled" : "enabled"]),
  );
  const applied = await call("POST", "/plugins/onboarding/apply", {
    cookie,
    body: { choices },
  });
  if (!applied.response.ok) {
    throw new Error(`could not turn plugins on: ${applied.response.status}`);
  }

  const end = Date.now() + timeoutMs;
  for (;;) {
    const { data } = await call("GET", "/plugins", { cookie });
    const list = Array.isArray(data) ? data : (data?.plugins ?? []);
    const wanted = list.filter((p) => !KEEP_OFF.has(p.id) && p.enabled);
    const active = wanted.filter((p) => p.state === "active").length;
    const failed = wanted.filter((p) => p.state === "failed").map((p) => p.id);
    console.log(`${active} of ${wanted.length} plugins active`);
    if (active + failed.length >= wanted.length && wanted.length > 0) {
      if (failed.length > 0) console.log(`failed: ${failed.join(", ")}`);
      break;
    }
    if (Date.now() > end) throw new Error("plugins did not all start");
    await sleep(5000);
  }
  // A server built without bundled plugins has no default look marked.
  const look = await call("PUT", "/user-preferences/look/defaults", {
    cookie,
    body: { layout: "classic", theme: "dark" },
  });
  if (!look.response.ok) {
    throw new Error(`could not set the default look: ${look.response.status}`);
  }
  console.log(JSON.stringify({ user, plugins: ids.length }));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
