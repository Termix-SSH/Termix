import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({
  users: [
    { id: "u1", username: "root", isAdmin: true },
    { id: "u2", username: "bob", isAdmin: false },
  ],
  reset: [] as string[],
  revoked: [] as string[],
  revokedAll: 0,
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentUserRepository: () => ({
    listAll: async () => h.users,
    findByUsername: async (name: string) =>
      h.users.find((user) => user.username === name) ?? null,
  }),
  createCurrentSessionRepository: () => ({
    revokeAll: async () => {
      h.revokedAll += 1;
      return 4;
    },
  }),
}));
vi.mock("../../auth/second-factor-admin.js", () => ({
  resetUserSecondFactors: async (id: string) => {
    h.reset.push(id);
    return [{ pluginId: "totp", factorId: "totp" }];
  },
}));
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      revokeAllUserSessions: async (id: string) => {
        h.revoked.push(id);
        return 2;
      },
    }),
  },
}));
vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    h.audits.push(entry);
  },
}));

const { processRecoveryRequests, recoveryDir } =
  await import("../../recovery/requests.js");
const { main, parseArgs } = await import("../../recovery/cli.js");

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-recovery-"));
  process.env.DATA_DIR = dataDir;
  h.reset = [];
  h.revoked = [];
  h.revokedAll = 0;
  h.audits = [];
});

afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Runs the CLI while the "server" answers in the background. */
async function runCli(argv: string[]) {
  const logs: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((m) => {
    logs.push(String(m));
  });
  const err = vi.spyOn(console, "error").mockImplementation((m) => {
    logs.push(String(m));
  });
  const server = setInterval(() => void processRecoveryRequests(), 20);
  try {
    const code = await main(argv, { dataDir, waitMs: 3000 });
    return { code, logs };
  } finally {
    clearInterval(server);
    log.mockRestore();
    err.mockRestore();
  }
}

describe("termix-recover", () => {
  it("reads its commands and refuses anything else", () => {
    expect(parseArgs(["list-admins"])).toEqual({ command: "list-admins" });
    expect(parseArgs(["reset-second-factor", "root"])).toEqual({
      command: "reset-second-factor",
      username: "root",
    });
    expect(parseArgs(["revoke-sessions", "--all"])).toEqual({
      command: "revoke-sessions",
      all: true,
    });
    expect(parseArgs([])).toBeNull();
    expect(parseArgs(["reset-second-factor"])).toBeNull();
    expect(parseArgs(["make-admin", "bob"])).toBeNull();
  });

  it("lists admins", async () => {
    const { code, logs } = await runCli(["list-admins"]);
    expect(code).toBe(0);
    expect(logs).toContain("  root");
    expect(logs.join("\n")).not.toContain("bob");
  });

  it("resets an admin's second factor, signs them out and audits it", async () => {
    const { code } = await runCli(["reset-second-factor", "root"]);
    expect(code).toBe(0);
    expect(h.reset).toEqual(["u1"]);
    expect(h.revoked).toEqual(["u1"]);
    expect(h.audits[0]).toMatchObject({
      action: "recovery_reset_second_factor",
      username: "server console",
      userId: null,
      resourceName: "root",
    });
  });

  it("signs everyone out", async () => {
    const { code } = await runCli(["revoke-sessions", "--all"]);
    expect(code).toBe(0);
    expect(h.revokedAll).toBe(1);
  });

  it("reports an unknown user", async () => {
    const { code, logs } = await runCli(["reset-second-factor", "nobody"]);
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("No user named nobody");
  });

  it("says so when the server does not answer, and leaves nothing behind", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await main(["list-admins"], { dataDir, waitMs: 300 })).toBe(1);
    } finally {
      err.mockRestore();
    }
    expect(fs.readdirSync(path.join(dataDir, ".recovery"))).toEqual([]);
  });
});

describe("recovery requests", () => {
  const write = (name: string, body: unknown) => {
    fs.mkdirSync(recoveryDir(), { recursive: true });
    fs.writeFileSync(path.join(recoveryDir(), name), JSON.stringify(body), {
      mode: 0o600,
    });
  };

  it("skips an old request instead of running it late", async () => {
    const id = "a".repeat(32);
    write(`${id}.request.json`, {
      id,
      command: "reset-second-factor",
      username: "root",
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    await processRecoveryRequests();
    expect(h.reset).toEqual([]);
    const result = JSON.parse(
      fs.readFileSync(path.join(recoveryDir(), `${id}.result.json`), "utf8"),
    );
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses unknown commands", async () => {
    const id = "b".repeat(32);
    write(`${id}.request.json`, {
      id,
      command: "make-admin",
      username: "bob",
      createdAt: new Date().toISOString(),
    });
    await processRecoveryRequests();
    expect(h.audits).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "refuses a request others can write to",
    async () => {
      const id = "c".repeat(32);
      write(`${id}.request.json`, {
        id,
        command: "revoke-sessions",
        all: true,
        createdAt: new Date().toISOString(),
      });
      fs.chmodSync(path.join(recoveryDir(), `${id}.request.json`), 0o666);
      await processRecoveryRequests();
      expect(h.revokedAll).toBe(0);
    },
  );
});
