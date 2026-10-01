/**
 * Core keeps serving HTTPS on its own: a certificate on disk is served with
 * no plugin renewing it, a validated replacement is swapped in without a
 * restart, and nginx is reloaded instead when it terminates TLS.
 */

import fs from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { caIssuedPair, selfSignedPair } from "./test-certs.js";

const nginx = vi.hoisted(() => ({
  reload: vi.fn(() => ({ applied: true, message: "nginx reloaded" })),
}));

vi.mock("../../utils/logger.js", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  };
  return { systemLogger: logger, authLogger: logger };
});

vi.mock("../../tls/nginx-reload.js", () => ({
  reloadNginxWithSSL: nginx.reload,
  persistSSLEnv: vi.fn(),
}));

const service = await import("../../tls/tls-service.js");
const challenges = await import("../../tls/acme-challenges.js");
const { X509Certificate } = await import("node:crypto");

let dir: string;
let servers: https.Server[] = [];
const savedEnv = { ...process.env };

async function install(pair: { certificate: string; privateKey: string }) {
  await fs.mkdir(path.join(dir, "ssl"), { recursive: true });
  await fs.writeFile(path.join(dir, "ssl", "termix.crt"), pair.certificate);
  await fs.writeFile(path.join(dir, "ssl", "termix.key"), pair.privateKey);
}

function fingerprint(pem: string): string {
  return new X509Certificate(pem).fingerprint256;
}

async function startServer(): Promise<number> {
  let resolvePort: (port: number) => void = () => {};
  const port = new Promise<number>((resolve) => (resolvePort = resolve));
  await service.configureDirectHttps((options) => {
    const server = https.createServer(options, (_req, res) => res.end("ok"));
    servers.push(server);
    server.listen(0, "127.0.0.1", () =>
      resolvePort((server.address() as AddressInfo).port),
    );
    return server;
  });
  return port;
}

function servedFingerprint(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: "127.0.0.1", port, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve(cert.fingerprint256);
      },
    );
    socket.on("error", reject);
  });
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "tls-service-"));
  process.env.DATA_DIR = dir;
  process.env.ENABLE_SSL = "true";
  delete process.env.SSL_CERT_PATH;
  delete process.env.SSL_KEY_PATH;
  delete process.env.TERMIX_SSL_TERMINATED_BY_NGINX;
  service.resetTlsServiceForTests();
  challenges.clearChallengesForTests();
  nginx.reload.mockClear();
});

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  servers = [];
  process.env = { ...savedEnv };
  await fs.rm(dir, { recursive: true, force: true });
});

describe("serving with no renewer", () => {
  it("serves the certificate on disk when no plugin renews it", async () => {
    const pair = await caIssuedPair("termix.example.com");
    await install(pair);

    const port = await startServer();
    expect(await servedFingerprint(port)).toBe(fingerprint(pair.certificate));

    const status = await service.getTlsStatus();
    expect(status.renewal).toBeNull();
    expect(status.certificate?.names).toEqual(["termix.example.com"]);
    expect(status.certificate?.selfSigned).toBe(false);
  });

  it("reports the plugin that renews it until it goes away", async () => {
    const undo = service.registerTlsRenewer({
      pluginId: "acme-ssl",
      pluginName: "ACME Certificates",
    });
    expect((await service.getTlsStatus()).renewal?.pluginId).toBe("acme-ssl");
    undo();
    undo();
    expect((await service.getTlsStatus()).renewal).toBeNull();
  });
});

describe("writeTlsCertificate and reloadTls", () => {
  it("swaps a new certificate in without a restart", async () => {
    await install(await selfSignedPair("localhost"));
    const port = await startServer();

    const next = await caIssuedPair("termix.example.com");
    await service.writeTlsCertificate(next.certificate, next.privateKey);
    const result = await service.reloadTls();

    expect(result.applied).toBe(true);
    expect(await servedFingerprint(port)).toBe(fingerprint(next.certificate));
    expect(nginx.reload).not.toHaveBeenCalled();
  });

  it("refuses a mismatched key and leaves the files alone", async () => {
    const current = await caIssuedPair("keep.example");
    await install(current);
    const one = await caIssuedPair("new.example");
    const other = await caIssuedPair("new.example");

    await expect(
      service.writeTlsCertificate(one.certificate, other.privateKey),
    ).rejects.toThrow(/do not match/);
    expect(await fs.readFile(path.join(dir, "ssl", "termix.crt"), "utf8")).toBe(
      current.certificate,
    );
  });

  it("reloads nginx when nginx terminates TLS", async () => {
    process.env.TERMIX_SSL_TERMINATED_BY_NGINX = "true";
    const pair = await caIssuedPair();
    await service.writeTlsCertificate(pair.certificate, pair.privateKey);
    const result = await service.reloadTls();
    expect(nginx.reload).toHaveBeenCalledOnce();
    expect(result.message).toBe("nginx reloaded");
  });
});

describe("ACME http-01 challenges", () => {
  it("answers a published token until it is withdrawn", () => {
    const undo = challenges.publishChallenge("abc_DEF-1", "abc_DEF-1.thumb");
    expect(challenges.lookupChallenge("abc_DEF-1")).toBe("abc_DEF-1.thumb");

    const res = {
      statusCode: 0,
      body: "",
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      type() {
        return this;
      },
      send(body: string) {
        this.body = body;
        return this;
      },
    };
    challenges.acmeChallengeHandler(
      { params: { token: "abc_DEF-1" } } as never,
      res as never,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("abc_DEF-1.thumb");

    undo();
    expect(challenges.lookupChallenge("abc_DEF-1")).toBeNull();
    expect(() => challenges.publishChallenge("../etc", "x")).toThrow();
  });
});
