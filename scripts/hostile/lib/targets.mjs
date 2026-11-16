// Two small HTTP servers the runner owns: a private target on loopback that
// the backend fixture must not reach, and an outside origin that counts every
// request the frame fixture manages to send it.
import http from "node:http";

function listen(server, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve(server.address().port));
  });
}

export async function startTarget(host = "127.0.0.1") {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/redirect") {
      res.writeHead(302, { location: url.searchParams.get("to") ?? "/" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("private target");
  });
  const port = await listen(server, host);
  return {
    port,
    hits,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Counts requests per first path part (/img, /css, ...). */
export async function startExfil(host = "127.0.0.1") {
  const hits = new Map();
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, "http://x").pathname.split("/")[1] || "/";
    hits.set(name, (hits.get(name) ?? 0) + 1);
    res.writeHead(200, {
      "content-type": "text/plain",
      "access-control-allow-origin": "*",
    });
    res.end("x");
  });
  // Socket upgrades count too, then close.
  server.on("upgrade", (req, socket) => {
    const name = new URL(req.url, "http://x").pathname.split("/")[1] || "/";
    hits.set(name, (hits.get(name) ?? 0) + 1);
    socket.destroy();
  });
  const port = await listen(server, host);
  return {
    port,
    origin: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`,
    hits,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
