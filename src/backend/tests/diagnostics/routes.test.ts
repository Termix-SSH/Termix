import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

const state = vi.hoisted(() => ({
  admin: true,
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAdminMiddleware:
        () =>
        (req: express.Request, res: express.Response, next: () => void) => {
          if (!state.admin) {
            res.status(403).json({ error: "Admin access required" });
            return;
          }
          (req as unknown as { userId: string }).userId = "admin-1";
          next();
        },
    }),
  },
}));

vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    state.audits.push(entry);
  },
  getAuditUsername: async () => "admin",
}));

vi.mock("../../diagnostics/server-info.js", () => ({
  describeServer: async () => ({ version: "26.11.3" }),
}));

vi.mock("../../diagnostics/plugins-info.js", () => ({
  describePlugins: async () => ({ plugins: [], skipped: [] }),
}));

const { default: routes } = await import("../../diagnostics/routes.js");
const { provideDiagnosticsSection, resetDiagnosticsSections } =
  await import("../../diagnostics/sections.js");
const { recordLogLine, resetLogBuffer } =
  await import("../../utils/log-buffer.js");

let server: http.Server;
let baseUrl: string;

beforeEach(async () => {
  state.admin = true;
  state.audits = [];
  resetLogBuffer();
  resetDiagnosticsSections();
  const app = express();
  app.use("/diagnostics", routes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /diagnostics/request", () => {
  it("answers signed out with names only", async () => {
    const res = await fetch(`${baseUrl}/diagnostics/request`, {
      headers: { cookie: "jwt=abc.def.ghi", "remote-user": "alice" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request.authCookie).toBe(true);
    expect(JSON.stringify(body)).not.toContain("abc.def.ghi");
    expect(JSON.stringify(body)).not.toContain("alice");
  });
});

describe("GET /diagnostics/server", () => {
  it("needs an admin", async () => {
    state.admin = false;
    const res = await fetch(`${baseUrl}/diagnostics/server`);
    expect(res.status).toBe(403);
    expect(state.audits).toHaveLength(0);
  });

  it("returns every part and audits the export", async () => {
    recordLogLine({ level: "info", service: "T", text: "hello" });
    provideDiagnosticsSection("ai", { collect: () => ({ model: "x" }) });
    const res = await fetch(`${baseUrl}/diagnostics/server?pluginId=ai`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.server.version).toBe("26.11.3");
    expect(body.sections).toEqual([
      { pluginId: "ai", title: "ai", data: { model: "x" } },
    ]);
    expect(body.logs.boot).toEqual([]);
    expect(state.audits).toEqual([
      expect.objectContaining({
        action: "diagnostics_export",
        userId: "admin-1",
        success: true,
      }),
    ]);
  });

  it("leaves out logs and sections when asked", async () => {
    provideDiagnosticsSection("ai", { collect: () => 1 });
    const res = await fetch(`${baseUrl}/diagnostics/server?logs=0&sections=0`);
    const body = await res.json();
    expect(body.logs).toBeNull();
    expect(body.sections).toEqual([]);
  });
});

describe("GET /diagnostics/logs", () => {
  it("needs an admin", async () => {
    state.admin = false;
    expect((await fetch(`${baseUrl}/diagnostics/logs`)).status).toBe(403);
  });

  it("returns lines after a seq", async () => {
    recordLogLine({ level: "info", service: "T", text: "a" });
    recordLogLine({ level: "error", service: "T", text: "b" });
    const res = await fetch(
      `${baseUrl}/diagnostics/logs?after=1&levels=error,bogus`,
    );
    const body = await res.json();
    expect(body.boot.map((l: { text: string }) => l.text)).toEqual(["b"]);
    expect(body.latest).toBe(2);
  });
});
