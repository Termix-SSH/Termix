// Request latency through a plugin route. Usage:
//   node bench-http.mjs <url> <apiKey | login:user:password> [requests=500] [concurrency=1]
// API key checks cost about 45 ms each in core, so login: is the fair one.
const [url, key, countArg, concArg] = process.argv.slice(2);
const count = Number(countArg ?? 500);
const concurrency = Number(concArg ?? 1);
let headers = { Authorization: `Bearer ${key}` };
if (key.startsWith("login:")) {
  const [, username, password] = key.split(":");
  const res = await fetch(new URL("/users/login", url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  headers = { Cookie: cookie };
}

for (let i = 0; i < 20; i++)
  await (await fetch(url, { headers })).arrayBuffer();

const times = [];
let next = 0;
let failures = 0;
const started = performance.now();
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < count) {
      next++;
      const t = performance.now();
      const res = await fetch(url, { headers });
      await res.arrayBuffer();
      if (!res.ok) failures++;
      times.push(performance.now() - t);
    }
  }),
);
const total = performance.now() - started;
times.sort((a, b) => a - b);
const pick = (p) =>
  +times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(2);
console.log(
  JSON.stringify({
    requests: count,
    concurrency,
    failures,
    p50: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
    rps: Math.round(count / (total / 1000)),
  }),
);
