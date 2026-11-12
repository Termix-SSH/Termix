import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revoked: string[] = [];
const sessions = [{ id: "s1" }, { id: "s2" }];

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSessionRepository: () => ({
    listAll: async () => sessions,
    revoke: async (id: string) => {
      revoked.push(id);
      return true;
    },
  }),
  createCurrentUserRepository: () => ({
    findById: async () => ({ username: "admin" }),
  }),
}));
vi.mock("../../../utils/audit-logger.js", () => ({ logAudit: vi.fn() }));
vi.mock("../../../utils/key-rotation.js", () => ({
  rotateEncryptionKey: vi.fn(async () => ({
    rewrappedKeys: 1,
    resealedValues: 2,
    failedValues: 0,
  })),
}));

const { SystemCrypto } = await import("../../../utils/system-crypto.js");
const { registerEncryptionRoutes } =
  await import("../../../database/routes/encryption-routes.js");

let dataDir: string;
const saved = {
  DATA_DIR: process.env.DATA_DIR,
  JWT_SECRET: process.env.JWT_SECRET,
};

function app() {
  const server = express();
  registerEncryptionRoutes(server, (req, _res, next) => {
    (req as express.Request & { userId: string }).userId = "admin-id";
    next();
  });
  return server;
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-enc-routes-"));
  process.env.DATA_DIR = dataDir;
  delete process.env.JWT_SECRET;
  revoked.length = 0;
  SystemCrypto.getInstance().resetForTests();
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  SystemCrypto.getInstance().resetForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("encryption routes", () => {
  it("really rotates the JWT secret and ends every session", async () => {
    fs.writeFileSync(
      path.join(dataDir, ".env"),
      `JWT_SECRET=${"c".repeat(64)}\n`,
    );
    const before = await SystemCrypto.getInstance().getJWTSecret();

    for (const route of [
      "/encryption/regenerate-jwt",
      "/encryption/regenerate",
    ]) {
      revoked.length = 0;
      const previous = await SystemCrypto.getInstance().getJWTSecret();
      const res = await request(app()).post(route);
      expect(res.status).toBe(200);
      expect(await SystemCrypto.getInstance().getJWTSecret()).not.toBe(
        previous,
      );
      expect(revoked).toEqual(["s1", "s2"]);
    }
    expect(await SystemCrypto.getInstance().getJWTSecret()).not.toBe(before);
  });

  it("refuses with 409 when the secret is set outside .env", async () => {
    process.env.JWT_SECRET = "d".repeat(64);
    const res = await request(app()).post("/encryption/regenerate-jwt");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EXTERNAL_SECRET");
    expect(revoked).toEqual([]);
    expect(await SystemCrypto.getInstance().getJWTSecret()).toBe(
      "d".repeat(64),
    );
  });

  it("reports what the encryption key rotation moved", async () => {
    const res = await request(app()).post("/encryption/rotate-key");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      rewrappedKeys: 1,
      resealedValues: 2,
      failedValues: 0,
    });
  });
});
