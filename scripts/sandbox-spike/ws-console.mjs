// Drives the Docker console socket of a running backend: login, connect to a
// container shell, echo round trips, then a bulk output run.
// Usage: node ws-console.mjs <baseUrl> <user> <password> <hostId> <hostIp> <container> [mb]
import WebSocket from "ws";

const [base, user, password, hostId, hostIp, container, mbArg] =
  process.argv.slice(2);
const mb = Number(mbArg ?? 5);

const login = await fetch(`${base}/users/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: user, password }),
});
const cookie = (login.headers.getSetCookie?.() ?? [])
  .map((c) => c.split(";")[0])
  .join("; ");
if (!login.ok || !cookie) {
  console.log("login failed", login.status);
  process.exit(1);
}

const wsUrl = `${base.replace(/^http/, "ws")}/plugin-ws/docker/console`;
const ws = new WebSocket(wsUrl, { headers: { Cookie: cookie } });
let output = "";
const waiters = [];
ws.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === "output") output += message.data;
  if (process.env.DEBUG_WS)
    console.log("<", JSON.stringify(message).slice(0, 200));
  for (const w of [...waiters]) w(message);
});
const waitFor = (test, ms = 30000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    const w = (m) => {
      if (test(m)) {
        clearTimeout(timer);
        waiters.splice(waiters.indexOf(w), 1);
        resolve(m);
      }
    };
    waiters.push(w);
  });
const send = (type, data) => ws.send(JSON.stringify({ type, data }));

await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});
const t0 = performance.now();
send("connect", {
  hostConfig: { id: Number(hostId), ip: hostIp },
  containerId: container,
  shell: "sh",
  cols: 200,
  rows: 50,
});
const connected = await waitFor(
  (m) => m.type === "connected" || m.type === "error",
  60000,
);
if (connected.type === "error") {
  console.log("connect error:", connected.message);
  process.exit(1);
}
const connectMs = performance.now() - t0;

// Round trips: write a marker, wait for it to echo back.
const rtts = [];
for (let i = 0; i < 20; i++) {
  const marker = `rt${i}x${Date.now()}`;
  const start = performance.now();
  send("input", `echo ${marker}\n`);
  await waitFor(() => output.split(marker).length >= 3);
  rtts.push(performance.now() - start);
}
rtts.sort((a, b) => a - b);

// Bulk: the container prints mb MiB, the socket carries it back.
output = "";
const bytes = mb * 1024 * 1024;
const bulkStart = performance.now();
// The shell works the marker out, so the typed command's echo never matches.
send(
  "input",
  `head -c ${bytes} /dev/zero | tr '\\0' 'a'; echo; echo BULK-$((40+2))-DONE\n`,
);
await waitFor(() => output.includes("BULK-42-DONE"), 120000);
const bulkMs = performance.now() - bulkStart;
const received = output.length;

console.log(
  JSON.stringify({
    connectMs: Math.round(connectMs),
    rttP50: +rtts[10].toFixed(1),
    rttP95: +rtts[18].toFixed(1),
    bulkMiB: mb,
    bulkMs: Math.round(bulkMs),
    bulkMiBps: +(mb / (bulkMs / 1000)).toFixed(2),
    receivedMiB: +(received / 1024 / 1024).toFixed(2),
  }),
);
send("disconnect");
ws.close();
setTimeout(() => process.exit(0), 200);
