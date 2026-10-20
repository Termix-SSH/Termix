import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const state = vi.hoisted(() => ({ drizzle: null as unknown }));

vi.mock("../../../database/db/index.js", () => ({
  getDb: () => state.drizzle,
  getSqlite: () => null,
}));
vi.mock("../../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    triggerSave: vi.fn(),
    forceSave: vi.fn(async () => {}),
  },
}));
vi.mock("../../../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: () => ({ getEncryptionKey: async () => Buffer.alloc(32, 5) }),
  },
}));

const { TestSqliteDatabase } =
  await import("../../database/repositories/test-support.js");
const { createLink, getLink, updateLink } =
  await import("../../../sync/client/link-store.js");
const { RemoteError, remoteJson } =
  await import("../../../sync/client/http.js");

function hasOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const openssl = hasOpenssl();
const PASSPHRASE = "pfx-pass";
let dir = "";
let pfx = "";
let serverKey = "";
let serverCert = "";
let clientCert = "";

function run(args: string[]) {
  execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
}

function selfSigned(name: string) {
  run([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "2",
    "-keyout",
    `${name}.key`,
    "-out",
    `${name}.crt`,
    "-subj",
    `/CN=${name}`,
  ]);
}

beforeAll(() => {
  if (!openssl) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-mtls-"));
  selfSigned("server");
  selfSigned("client");
  run([
    "pkcs12",
    "-export",
    "-inkey",
    "client.key",
    "-in",
    "client.crt",
    "-out",
    "client.p12",
    "-passout",
    `pass:${PASSPHRASE}`,
  ]);
  pfx = fs.readFileSync(path.join(dir, "client.p12")).toString("base64");
  serverKey = fs.readFileSync(path.join(dir, "server.key"), "utf8");
  serverCert = fs.readFileSync(path.join(dir, "server.crt"), "utf8");
  clientCert = fs.readFileSync(path.join(dir, "client.crt"), "utf8");
});

afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!openssl)("client certificates", () => {
  let server: https.Server;
  let base: string;

  beforeAll(async () => {
    server = https.createServer(
      {
        key: serverKey,
        cert: serverCert,
        ca: [clientCert],
        requestCert: true,
        rejectUnauthorized: true,
      },
      (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      },
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    base = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("presents the PFX to a server that requires one", async () => {
    const result = await remoteJson<{ ok: boolean }>(
      {
        serverUrl: base,
        allowInvalidCertificate: true,
        clientCert: { pfx, passphrase: PASSPHRASE, name: "client.p12" },
      },
      "/x",
    );
    expect(result.ok).toBe(true);
  });

  it("reports a missing client certificate as its own error", async () => {
    const error = await remoteJson(
      { serverUrl: base, allowInvalidCertificate: true },
      "/x",
    ).catch((e) => e);
    expect(error).toBeInstanceOf(RemoteError);
    expect((error as InstanceType<typeof RemoteError>).kind).toBe(
      "client_cert",
    );
  });

  describe("on the link", () => {
    let db: InstanceType<typeof TestSqliteDatabase>;

    beforeEach(async () => {
      db = new TestSqliteDatabase("sqlite");
      state.drizzle = (await db.connect()).drizzle;
      await db.run(
        sql`INSERT INTO users (id, username, password_hash) VALUES ('local', 'local', '')`,
      );
    });

    afterEach(async () => {
      await db.close();
    });

    it("stores the PFX encrypted and keeps it through other updates", async () => {
      await createLink({
        userId: "local",
        serverUrl: "https://termix.example",
        sessionToken: "t",
        clientCert: { pfx, passphrase: PASSPHRASE, name: "client.p12" },
      });
      const raw = await db.query(sql`SELECT scope FROM sync_link`);
      expect(JSON.stringify(raw)).not.toContain(pfx.slice(0, 40));

      await updateLink({ disabledTypes: ["hosts"] }, "local");
      const link = await getLink("local");
      expect(link?.clientCert?.pfx).toBe(pfx);
      expect(link?.disabledTypes).toEqual(["hosts"]);

      await updateLink({ clientCert: null }, "local");
      expect((await getLink("local"))?.clientCert).toBeNull();
    });

    it("rejects a PFX with the wrong passphrase", async () => {
      await expect(
        createLink({
          userId: "local",
          serverUrl: "https://termix.example",
          sessionToken: "t",
          clientCert: { pfx, passphrase: "nope", name: null },
        }),
      ).rejects.toThrow(/not valid/);
    });
  });
});
