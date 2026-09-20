import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  createRemoteSyncFetch,
} = require("../../../../electron/remote-sync-fetch.cjs");
let server: https.Server;
let origin: string;
let directory: string;
let redirectedRequests = 0;
const config = { serverUrl: "", allowInvalidCertificate: false };
const request = createRemoteSyncFetch(() => config);

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "termix-sync-tls-"));
  const key = join(directory, "key.pem");
  const cert = join(directory, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
    ],
    { stdio: "ignore" },
  );
  server = https.createServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: `${origin}/redirect-target` });
      } else {
        if (req.url === "/redirect-target") redirectedRequests++;
        res.setHeader("Content-Type", "application/json");
        res.write(
          JSON.stringify({
            authorization: req.headers.authorization,
            method: req.method,
          }),
        );
      }
      res.end();
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  config.serverUrl = `${origin}/termix`;
});

afterAll(async () => {
  server?.closeAllConnections();
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) rmSync(directory, { recursive: true, force: true });
});

it("rejects self-signed certificates until enabled, then preserves authenticated requests", async () => {
  await expect(request(`${origin}/users/me`)).rejects.toThrow();
  config.allowInvalidCertificate = true;
  const response = await request(`${origin}/users/me`, {
    headers: { Authorization: "Bearer dummy-token" },
    method: "POST",
    body: "{}",
  });
  expect(await response.json()).toEqual({
    authorization: "Bearer dummy-token",
    method: "POST",
  });
  config.allowInvalidCertificate = false;
  await expect(request(`${origin}/users/me`)).rejects.toThrow();
});

it("does not apply an exception to another configured origin", async () => {
  config.allowInvalidCertificate = true;
  config.serverUrl = "https://another.example";
  await expect(request(`${origin}/sync/hosts`)).rejects.toThrow();
  config.serverUrl = origin;
});

it("refuses redirects rather than carrying the TLS exception to another request", async () => {
  config.allowInvalidCertificate = true;
  await expect(request(`${origin}/redirect`)).rejects.toThrow();
  expect(redirectedRequests).toBe(0);
});
