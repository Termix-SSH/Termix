import { afterEach, describe, expect, it } from "vitest";
import speakeasy from "speakeasy";
import { startServer, type TestServer } from "./helpers";
import { generateBackupCode, normalizeCode } from "../../src/backend/totp.js";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const codeFor = (secret: string) =>
  speakeasy.totp({ secret, encoding: "base32" });

async function enrol(target: TestServer, user = "user-1") {
  const setup = await target.request("POST", "/setup", { user, body: {} });
  expect(setup.status).toBe(200);
  const secret: string = setup.body.secret;
  const enable = await target.request("POST", "/enable", {
    user,
    body: { totp_code: codeFor(secret) },
  });
  expect(enable.status).toBe(200);
  return { secret, backupCodes: enable.body.backup_codes as string[] };
}

function factor(target: TestServer) {
  const registered = target.mock.auth.secondFactors.find(
    (entry) => entry.id === "totp",
  );
  if (!registered) throw new Error("totp factor not registered");
  return registered;
}

describe("enrolment", () => {
  it("sets up, enables, records the enrolment and reports status", async () => {
    server = await startServer();
    expect((await server.request("GET", "/status")).body).toEqual({
      enabled: false,
    });

    const setup = await server.request("POST", "/setup", { body: {} });
    expect(setup.body.qr_code).toMatch(/^data:image\/png;base64,/);
    expect(setup.body.secret).toMatch(/^[A-Z2-7]+$/);

    const wrong = await server.request("POST", "/enable", {
      body: { totp_code: "000000" },
    });
    expect(wrong.status).toBe(401);
    expect(await factor(server).isEnrolled("user-1")).toBe(false);

    const enable = await server.request("POST", "/enable", {
      body: { totp_code: codeFor(setup.body.secret) },
    });
    expect(enable.status).toBe(200);
    expect(enable.body.backup_codes).toHaveLength(8);
    expect(server.mock.auth.enrollments.has("user-1:totp")).toBe(true);
    expect((await server.request("GET", "/status")).body).toEqual({
      enabled: true,
    });
  });

  it("stores the secret sealed, never in the clear", async () => {
    server = await startServer();
    const { secret } = await enrol(server);
    const row = server.db.sqlite
      .prepare("SELECT * FROM p_totp_enrollments WHERE user_id = 'user-1'")
      .get() as Record<string, string | null>;
    expect(row.secret).not.toContain(secret);
    expect(row.secret).toMatch(/^sealed:/);
    expect(row.pending_secret).toBeNull();
  });

  it("refuses enable before setup and when already on", async () => {
    server = await startServer();
    expect(
      (
        await server.request("POST", "/enable", {
          body: { totp_code: "123456" },
        })
      ).status,
    ).toBe(400);
    const { secret } = await enrol(server);
    expect(
      (
        await server.request("POST", "/enable", {
          body: { totp_code: codeFor(secret) },
        })
      ).status,
    ).toBe(400);
  });

  it("leaves nothing enabled when core refuses the enrolment", async () => {
    server = await startServer({
      refuseEnrollment: "Cannot enable 2FA while password login is disabled.",
    });
    const setup = await server.request("POST", "/setup", { body: {} });
    const enable = await server.request("POST", "/enable", {
      body: { totp_code: codeFor(setup.body.secret) },
    });
    expect(enable.status).toBe(409);
    expect(enable.body.error).toMatch(/password login/);
    expect(await factor(server).isEnrolled("user-1")).toBe(false);
  });

  it("adds another authenticator only with a valid code", async () => {
    server = await startServer();
    const { secret } = await enrol(server);
    expect((await server.request("POST", "/setup", { body: {} })).status).toBe(
      400,
    );
    expect(
      (
        await server.request("POST", "/setup", {
          body: { credential: "000000" },
        })
      ).status,
    ).toBe(401);
    const again = await server.request("POST", "/setup", {
      body: { credential: codeFor(secret) },
    });
    expect(again.body).toMatchObject({ secret, additional: true });
  });

  it("disables with a code and removes the enrolment", async () => {
    server = await startServer();
    const { secret } = await enrol(server);
    expect(
      (
        await server.request("POST", "/disable", {
          body: { totp_code: "000000" },
        })
      ).status,
    ).toBe(401);
    const off = await server.request("POST", "/disable", {
      body: { totp_code: codeFor(secret) },
    });
    expect(off.status).toBe(200);
    expect(server.mock.auth.enrollments.has("user-1:totp")).toBe(false);
    expect(await factor(server).isEnrolled("user-1")).toBe(false);
  });

  it("replaces backup codes", async () => {
    server = await startServer();
    const { secret, backupCodes } = await enrol(server);
    const fresh = await server.request("POST", "/backup-codes", {
      body: { totp_code: codeFor(secret) },
    });
    expect(fresh.body.backup_codes).toHaveLength(8);
    expect(
      await factor(server).verify("user-1", { totp_code: backupCodes[0] }),
    ).toBe(false);
    expect(
      await factor(server).verify("user-1", {
        totp_code: fresh.body.backup_codes[0],
      }),
    ).toBe(true);
  });

  it("keeps users apart", async () => {
    server = await startServer();
    await enrol(server, "user-1");
    expect(
      (await server.request("GET", "/status", { user: "user-2" })).body,
    ).toEqual({ enabled: false });
  });
});

describe("login", () => {
  it("verifies a current code and refuses a wrong one", async () => {
    server = await startServer();
    const { secret } = await enrol(server);
    expect(await factor(server).verify("user-1", { totp_code: "000000" })).toBe(
      false,
    );
    expect(
      await factor(server).verify("user-1", { totp_code: codeFor(secret) }),
    ).toBe(true);
  });

  it("accepts each backup code once, typed in any case", async () => {
    server = await startServer();
    const { backupCodes } = await enrol(server);
    const [first] = backupCodes;
    expect(
      await factor(server).verify("user-1", {
        totp_code: first.toLowerCase(),
      }),
    ).toBe(true);
    expect(await factor(server).verify("user-1", { totp_code: first })).toBe(
      false,
    );
    expect(
      await factor(server).verify("user-1", { totp_code: backupCodes[1] }),
    ).toBe(true);
  });

  it("refuses with a message when the user has no readable secret", async () => {
    server = await startServer();
    expect(
      await factor(server).verify("user-1", { totp_code: "123456" }),
    ).toMatchObject({ ok: false });
  });

  it("reset removes the enrolment, as the admin reset calls it", async () => {
    server = await startServer();
    const { secret } = await enrol(server);
    await factor(server).reset!("user-1");
    expect(await factor(server).isEnrolled("user-1")).toBe(false);
    expect(
      await factor(server).verify("user-1", { totp_code: codeFor(secret) }),
    ).toMatchObject({ ok: false });
  });

  it("drops the enrolment with the user", async () => {
    server = await startServer();
    await enrol(server);
    server.db.sqlite.exec("DELETE FROM users WHERE id = 'user-1'");
    expect(await factor(server).isEnrolled("user-1")).toBe(false);
  });
});

describe("capabilities", () => {
  it("fails closed without auth:provide", async () => {
    await expect(
      startServer({
        capabilities: ["db:own", "secrets:own", "network:serve", "ui:surface"],
      }),
    ).rejects.toThrow(/auth:provide/);
  });

  it("fails closed without db:own", async () => {
    await expect(
      startServer({
        capabilities: [
          "secrets:own",
          "network:serve",
          "auth:provide",
          "ui:surface",
        ],
      }),
    ).rejects.toThrow(/db:own/);
  });
});

describe("helpers", () => {
  it("makes backup codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateBackupCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
  });

  it("normalises codes", () => {
    expect(normalizeCode(" abcd1234 ")).toBe("ABCD1234");
    expect(normalizeCode(42)).toBe("");
  });
});
