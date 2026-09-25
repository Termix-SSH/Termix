import http from "node:http";
import type { AddressInfo } from "node:net";
import express, { type RequestHandler } from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const state = vi.hoisted(() => ({
  admins: new Set<string>(["admin-1"]),
  writes: [] as Array<[unknown, unknown]>,
  reloads: 0,
  audits: [] as Array<{ action: string; success: boolean }>,
}));

vi.mock("../../../utils/logger.js", () => ({
  authLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: async (entry: { action: string; success: boolean }) => {
    state.audits.push({ action: entry.action, success: entry.success });
  },
  getRequestMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentUserRepository: () => ({
    findById: async (id: string) => ({
      id,
      username: id,
      isAdmin: state.admins.has(id),
    }),
  }),
}));

vi.mock("../../../tls/tls-service.js", async () => {
  const { TlsValidationError } = await import("../../../tls/certificate.js");
  return {
    getTlsStatus: async () => ({
      enabled: true,
      certificate: null,
      renewal: null,
    }),
    writeTlsCertificate: async (cert: unknown, key: unknown) => {
      if (key === "mismatch") {
        throw new TlsValidationError(
          "The certificate and private key do not match",
        );
      }
      state.writes.push([cert, key]);
      return { subject: "CN=x", notAfter: "2030-01-01T00:00:00.000Z" };
    },
    reloadTls: async () => {
      state.reloads++;
      return { applied: true, message: "reloaded" };
    },
  };
});

const { registerTlsRoutes } =
  await import("../../../database/routes/tls-routes.js");

const authenticate: RequestHandler = (req, _res, next) => {
  (req as unknown as { userId?: string }).userId =
    req.header("x-user") ?? undefined;
  next();
};

let server: http.Server;
let base: string;

beforeAll(async () => {
  const router = express.Router();
  registerTlsRoutes(router, authenticate);
  const app = express();
  app.use(express.json());
  app.use("/users", router);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.writes = [];
  state.reloads = 0;
  state.audits = [];
});

const upload = (user: string, body: unknown) =>
  fetch(`${base}/users/tls-certificate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": user },
    body: JSON.stringify(body),
  });

describe("TLS certificate routes", () => {
  it("returns the status to an admin only", async () => {
    const ok = await fetch(`${base}/users/tls-certificate`, {
      headers: { "x-user": "admin-1" },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ enabled: true, renewal: null });

    const denied = await fetch(`${base}/users/tls-certificate`, {
      headers: { "x-user": "user-1" },
    });
    expect(denied.status).toBe(403);
  });

  it("installs an uploaded pair and reloads", async () => {
    const response = await upload("admin-1", {
      certificate: "CERT",
      privateKey: "KEY",
    });
    expect(response.status).toBe(200);
    expect((await response.json()).reloadMessage).toBe("reloaded");
    expect(state.writes).toEqual([["CERT", "KEY"]]);
    expect(state.reloads).toBe(1);
    expect(state.audits).toEqual([
      { action: "tls_certificate_upload", success: true },
    ]);
  });

  it("answers 400 for a mismatched pair without reloading", async () => {
    const response = await upload("admin-1", {
      certificate: "CERT",
      privateKey: "mismatch",
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/do not match/);
    expect(state.reloads).toBe(0);
    expect(state.audits).toEqual([
      { action: "tls_certificate_upload", success: false },
    ]);
  });

  it("refuses a non-admin upload", async () => {
    const response = await upload("user-1", {
      certificate: "CERT",
      privateKey: "KEY",
    });
    expect(response.status).toBe(403);
    expect(state.writes).toEqual([]);
  });
});
