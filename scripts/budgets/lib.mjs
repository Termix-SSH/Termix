// Shared bits of the budget scripts: argument parsing, request counting and
// the limit check. Kept free of Playwright so tests can load it.

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const name = item.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[name] = true;
    else {
      out[name] = next;
      i++;
    }
  }
  return out;
}

/** Path of a request URL with ids folded, so /hosts/12 and /hosts/13 count once. */
export function requestKey(method, url) {
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    path = String(url);
  }
  path = path.replace(/\/\d+(?=\/|$)/g, "/:id");
  return `${method.toUpperCase()} ${path}`;
}

export function countRequests(entries) {
  const counts = new Map();
  for (const { method, url } of entries) {
    const key = requestKey(method, url);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, count }));
}

/** Sum of resident memory over the backend's processes, from /plugins/processes. */
export function backendRssMb(processes) {
  if (!processes || typeof processes !== "object") return null;
  const core = Number(processes.core?.rssMb);
  if (!Number.isFinite(core)) return null;
  let total = core;
  for (const entry of processes.plugins ?? []) {
    const rss = Number(entry?.rssMb);
    if (Number.isFinite(rss)) total += rss;
  }
  return Math.round(total);
}

export const BUDGET_FIELDS = [
  "framesAfterLogin",
  "jsHeapMb",
  "backendRssMb",
  "timeToDashboardMs",
];

/** Every measured value over its limit, or a missing value that has one. */
export function overBudget(result, budgets) {
  const failures = [];
  for (const field of BUDGET_FIELDS) {
    const limit = budgets?.[field];
    if (typeof limit !== "number") continue;
    const value = result?.[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      failures.push({ field, value: null, limit });
    } else if (value > limit) {
      failures.push({ field, value, limit });
    }
  }
  return failures;
}

/** The newest dev-X.Y.Z branch name, or null. */
export function newestDevBranch(heads) {
  const versions = heads
    .map((ref) => /refs\/heads\/dev-(\d+)\.(\d+)\.(\d+)$/.exec(ref))
    .filter(Boolean)
    .map((m) => ({
      name: `dev-${m[1]}.${m[2]}.${m[3]}`,
      parts: m.slice(1, 4).map(Number),
    }))
    .sort((a, b) => {
      for (let i = 0; i < 3; i++) {
        if (a.parts[i] !== b.parts[i]) return b.parts[i] - a.parts[i];
      }
      return 0;
    });
  return versions[0]?.name ?? null;
}
