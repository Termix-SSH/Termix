import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { TestSqliteDatabase } from "../database/repositories/test-support.js";
import type { DatabaseContext } from "../../database/repositories/database-context.js";

const h = vi.hoisted(() => ({
  context: null as DatabaseContext | null,
  alerts: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../database/repositories/factory.js", async () => {
  const { AdminHoldRepository } =
    await import("../../database/repositories/admin-hold-repository.js");
  const { SettingsRepository } =
    await import("../../database/repositories/settings-repository.js");
  const { UserRepository } =
    await import("../../database/repositories/user-repository.js");
  return {
    createCurrentAdminHoldRepository: () => new AdminHoldRepository(h.context!),
    createCurrentSettingsRepository: () => new SettingsRepository(h.context!),
    createCurrentUserRepository: () => new UserRepository(h.context!),
  };
});
vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    h.audits.push(entry);
  },
  getAuditUsername: async (id: string) => id,
  getRequestMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));
vi.mock("../../notify/core-notify.js", () => ({
  sendCoreAlert: async (alert: Record<string, unknown>) => {
    h.alerts.push(alert);
  },
}));

const holds = await import("../../auth/admin-holds.js");

const applied: Array<{ payload: unknown; requester: string }> = [];
holds.registerHoldKind("make_admin", {
  apply: async (payload, requester) => {
    applied.push({ payload, requester });
  },
});

function fakeResponse() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

const request = {} as Request;
const later = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000 + 1000);

let adapter: TestSqliteDatabase;

async function setAdmins(ids: string[]) {
  await adapter.exec(
    `UPDATE users SET is_admin = CASE WHEN id IN (${ids.map((id) => `'${id}'`).join(",") || "''"}) THEN 1 ELSE 0 END;`,
  );
}

async function turnOn(minutes = 60) {
  await adapter.exec(
    `INSERT INTO settings (key, value) VALUES ('admin_hold_minutes', '${minutes}');`,
  );
}

async function hold() {
  const res = fakeResponse();
  const stopped = await holds.holdIfNeeded(
    request,
    res as unknown as Response,
    {
      kind: "make_admin",
      payload: { userId: "carol" },
      summary: "make carol an admin",
      requesterId: "alice",
    },
  );
  return { stopped, res };
}

beforeEach(async () => {
  adapter = new TestSqliteDatabase();
  h.context = await adapter.connect();
  await adapter.exec(`
    INSERT INTO users (id, username, password_hash, is_admin)
    VALUES ('alice', 'alice', 'h', 1), ('bob', 'bob', 'h', 1), ('carol', 'carol', 'h', 0);
  `);
  h.alerts = [];
  h.audits = [];
  applied.length = 0;
  delete process.env.TERMIX_ADMIN_HOLD_MINUTES;
  delete process.env.ELECTRON_EMBEDDED;
});

afterEach(async () => {
  await adapter.close();
  delete process.env.TERMIX_ADMIN_HOLD_MINUTES;
  delete process.env.ELECTRON_EMBEDDED;
});

describe("admin wait", () => {
  it("is off by default, so nothing waits", async () => {
    const { stopped } = await hold();
    expect(stopped).toBe(false);
    expect(await holds.getHoldSettings()).toMatchObject({
      minutes: 0,
      active: false,
      adminCount: 2,
    });
  });

  it("skips servers with one admin even when on", async () => {
    await turnOn();
    await setAdmins(["alice"]);
    expect((await hold()).stopped).toBe(false);
  });

  it("never waits on the desktop app", async () => {
    await turnOn();
    process.env.ELECTRON_EMBEDDED = "true";
    expect((await hold()).stopped).toBe(false);
  });

  it("holds the change and tells only the other admins", async () => {
    await turnOn(30);
    const { stopped, res } = await hold();
    expect(stopped).toBe(true);
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({ held: true, minutes: 30 });
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0]).toMatchObject({ audience: { userId: "bob" } });
    expect(h.audits.map((a) => a.action)).toContain("admin_hold_created");
    expect(applied).toHaveLength(0);
  });

  it("applies once the wait is over, and only once", async () => {
    await turnOn(30);
    await hold();
    expect(await holds.runDueHolds(new Date())).toBe(0);
    expect(await holds.runDueHolds(later(30))).toBe(1);
    expect(await holds.runDueHolds(later(30))).toBe(0);
    expect(applied).toEqual([
      { payload: { userId: "carol" }, requester: "alice" },
    ]);
    const [row] = await holds.listHolds();
    expect(row.status).toBe("applied");
  });

  it("does not apply a cancelled change", async () => {
    await turnOn(30);
    await hold();
    const [row] = await holds.listHolds();
    expect(await holds.cancelHold(row.id, "bob")).toBe("cancelled");
    expect(await holds.cancelHold(row.id, "bob")).toBe("not_pending");
    expect(await holds.runDueHolds(later(30))).toBe(0);
    expect(applied).toHaveLength(0);
    expect(h.audits.map((a) => a.action)).toContain("admin_hold_cancelled");
    expect(h.alerts.at(-1)).toMatchObject({ audience: { userId: "alice" } });
  });

  it("drops the change when the admin who asked lost admin", async () => {
    await turnOn(30);
    await hold();
    await setAdmins(["bob"]);
    await holds.runDueHolds(later(30));
    expect(applied).toHaveLength(0);
    const [row] = await holds.listHolds();
    expect(row.status).toBe("failed");
  });

  it("turns on at once but holds turning off", async () => {
    expect(await holds.updateHoldMinutes(60, "alice")).toEqual({
      held: false,
      minutes: 60,
    });
    const off = await holds.updateHoldMinutes(0, "alice");
    expect(off).toMatchObject({ held: true });
    expect((await holds.getHoldSettings()).minutes).toBe(60);
    await holds.runDueHolds(later(60));
    expect((await holds.getHoldSettings()).minutes).toBe(0);
  });

  it("holds a shorter wait too, but not a longer one", async () => {
    await turnOn(60);
    expect(await holds.updateHoldMinutes(10, "alice")).toMatchObject({
      held: true,
    });
    expect(await holds.updateHoldMinutes(120, "alice")).toMatchObject({
      held: false,
    });
  });

  it("follows the server's env var and refuses changes from the UI", async () => {
    process.env.TERMIX_ADMIN_HOLD_MINUTES = "15";
    expect(await holds.getHoldSettings()).toMatchObject({
      minutes: 15,
      forcedByEnv: true,
      active: true,
    });
    await expect(holds.updateHoldMinutes(0, "alice")).rejects.toBeInstanceOf(
      holds.HoldSettingLocked,
    );
  });

  it("knows which plugin capabilities make changes wait", () => {
    expect(
      holds.needsHold(["db:own", "credentials:read", "process:spawn"]),
    ).toEqual(["credentials:read", "process:spawn"]);
    expect(holds.needsHold(["hosts:read"])).toEqual([]);
  });
});
