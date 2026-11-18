// Runs the backend fixture's attacks and the checks the runner makes around
// the plugin process (locks, floods, crash loop).
import { call, must } from "../../authz/lib/client.mjs";

const API = "/plugin-api/hostile-backend";
// Run by the runner itself, not in the plain loop.
const SPECIAL = new Set([
  "lock.set",
  "flood.calls",
  "flood.big",
  "flood.big-raw",
]);

function attack(world, id, body) {
  return call(world.base, {
    method: "POST",
    path: `${API}/attack/${id}`,
    identity: world.admin,
    body,
  });
}

/** Turns a route answer into a result; a broken route is an error, not a pass. */
function readResult(res, marker) {
  if (res.status !== 200 || !res.json || typeof res.json.worked !== "boolean") {
    return {
      worked: false,
      error: true,
      detail: `route answered ${res.status} ${res.error ?? res.text?.slice(0, 200) ?? ""}`,
    };
  }
  const result = { ...res.json };
  // Anything that came back holding the victim's marker leaked it.
  if (marker && String(result.detail ?? "").includes(marker)) {
    result.worked = true;
    result.detail = `leaked the victim's marker: ${result.detail}`;
  }
  return result;
}

/** Polls /health while fn runs. Returns fn's result and the worst wait. */
async function underWatch(world, fn) {
  let worst = 0;
  let failures = 0;
  let running = true;
  const poller = (async () => {
    while (running) {
      const started = Date.now();
      const res = await call(world.base, { path: "/health" });
      const took = Date.now() - started;
      worst = Math.max(worst, took);
      if (res.status !== 200) failures++;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();
  let value;
  try {
    value = await fn();
  } finally {
    running = false;
    await poller;
  }
  return { value, worst, failures };
}

async function hostLockCheck(world) {
  const make = (identity, name) =>
    must(world.base, {
      method: "POST",
      path: "/host/db/host",
      identity,
      body: {
        name,
        ip: "127.0.0.1",
        port: 22,
        username: "hostile",
        authType: "password",
        password: "hostile-pass",
      },
    });
  const first = await make(world.admin, `hostile-probe-${Date.now()}`);
  const next = [1, 2, 3].map((step) => Number(first.id) + step);
  await attack(world, "lock.set", { lockIds: next });
  // Core rereads a plugin's lock report every second.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const later = await make(world.other, `hostile-later-${Date.now()}`);
  const edit = await call(world.base, {
    method: "PUT",
    path: `/host/db/host/${later.id}`,
    identity: world.other,
    body: {
      name: `hostile-later-renamed-${Date.now()}`,
      ip: "127.0.0.1",
      port: 22,
      username: "hostile",
      authType: "password",
      password: "hostile-pass",
    },
  });
  await attack(world, "lock.set", { lockIds: [] });
  const detail = `new host ${later.id}, locked ids ${next.join(",")}, edit gave ${edit.status} ${edit.text?.slice(0, 200) ?? ""}`;
  if (!next.includes(Number(later.id))) {
    return {
      worked: false,
      error: true,
      detail: `host ids moved on: ${detail}`,
    };
  }
  return { worked: edit.status !== 200, detail };
}

async function floodChecks(world, channel) {
  const results = {};
  const health = (watch) =>
    `worst /health wait ${watch.worst} ms, ${watch.failures} failed`;
  const slow = (watch) => watch.worst > 5000 || watch.failures > 0;

  const calls = await underWatch(world, () =>
    attack(world, "flood.calls", { count: 50_000 }),
  );
  results["flood.calls"] = {
    worked: slow(calls) || calls.value.status === 0,
    detail: `${health(calls)}; plugin said ${calls.value.text?.slice(0, 200)}`,
  };

  const big = await underWatch(world, () =>
    attack(world, "flood.big", { mb: 200 }),
  );
  const stored = big.value.json?.worked === true;
  results["flood.big"] = {
    worked: stored || slow(big),
    detail: `${health(big)}; plugin said ${big.value.text?.slice(0, 200)}`,
  };

  if (channel === "fork") {
    const raw = await underWatch(world, async () => {
      const res = await attack(world, "flood.big-raw", { mb: 200 });
      // Give core time to take the message in.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return res;
    });
    // A 200 MB message core accepted and parsed stalls its event loop.
    results["flood.big-raw"] = {
      worked: slow(raw) || raw.worst > 1500,
      detail: `${health(raw)}; plugin said ${raw.value.text?.slice(0, 200)}`,
    };
  } else {
    results["flood.big-raw"] = {
      worked: false,
      detail: "n/a: no fork channel",
    };
  }

  const alive = await call(world.base, { path: "/health" });
  if (alive.status !== 200) {
    for (const id of Object.keys(results)) {
      results[id] = {
        worked: true,
        detail: `core stopped answering: ${alive.status}`,
      };
    }
  }
  return results;
}

/** hostile-crash dies at every start; core must mark it failed. */
async function crashLoopCheck(world, log) {
  const started = Date.now();
  let state = "unknown";
  while (Date.now() - started < 180_000) {
    const res = await call(world.base, {
      path: "/plugins",
      identity: world.admin,
    });
    const plugin = (res.json ?? []).find((p) => p.id === "hostile-crash");
    state = plugin?.state ?? "missing";
    if (state === "failed") {
      return {
        worked: false,
        detail: `marked failed after ${Math.round((Date.now() - started) / 1000)}s`,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  log?.(`hostile-crash still ${state} after 3 minutes`);
  const health = await call(world.base, { path: "/health" });
  return {
    worked: true,
    detail: `still ${state} after 3 minutes, core health ${health.status}`,
  };
}

export async function runBackend(world, log) {
  const info = await must(world.base, {
    path: `${API}/info`,
    identity: world.admin,
  });
  const victim = await must(world.base, {
    path: "/plugin-api/hostile-victim/marker",
    identity: world.admin,
  });
  // A request whose token the replay attack keeps. Core gives a finished
  // request's token 30 s to wrap up, so the replay runs after that.
  await must(world.base, { path: `${API}/touch`, identity: world.admin });
  const touchedAt = Date.now();

  const input = {
    dataDir: world.dataDir,
    canaryFile: world.canaryFile,
    dataFiles: world.dataFiles,
    victimDir: victim.dataDir,
    victimSealed: victim.sealed,
    coreRoot: world.coreRoot,
    coreUrl: world.coreUrlFromPlugin,
    listenPort: world.listenPort,
    envCanary: world.envCanary,
    otherUserId: world.otherUserId,
  };

  const results = {};
  for (const id of info.attacks) {
    if (SPECIAL.has(id) || id === "user.replay-token") continue;
    if (id === "fetch.redirect-private" && !world.redirect) {
      results[id] = { worked: false, detail: "n/a: no redirect target here" };
      continue;
    }
    results[id] = readResult(await attack(world, id, input), victim.marker);
  }
  const wait = touchedAt + 35_000 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  results["user.replay-token"] = readResult(
    await attack(world, "user.replay-token", input),
    victim.marker,
  );
  log?.(`ran ${Object.keys(results).length} backend attacks`);

  results["lock.future-host"] = await hostLockCheck(world);
  Object.assign(results, await floodChecks(world, info.channel));
  results["crash.loop"] = await crashLoopCheck(world, log);
  return { results, channel: info.channel, info, victim };
}
