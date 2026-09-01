import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { HostRepository } from "../../../database/repositories/host-repository.js";
import { DataCrypto } from "../../../utils/data-crypto.js";

describe("HostRepository.reorderForUser", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<HostRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type)
      VALUES
        (1, 'user-1', 'one', '10.0.0.1', 22, 'root', 'password'),
        (2, 'user-1', 'two', '10.0.0.2', 22, 'root', 'password'),
        (3, 'user-2', 'other', '10.0.0.3', 22, 'root', 'password');
    `);

    return new HostRepository(context, onWrite);
  }

  it("sets a distinct sortOrder per host", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const updated = await repo.reorderForUser("user-1", [
      { id: 1, sortOrder: 2000 },
      { id: 2, sortOrder: 1000 },
    ]);
    expect(updated).toBe(2);
    expect(writeCount).toBe(1);

    expect(
      await adapter!.query(
        sql`SELECT id, sort_order FROM ssh_data WHERE user_id = 'user-1' ORDER BY id`,
      ),
    ).toEqual([
      { id: 1, sort_order: 2000 },
      { id: 2, sort_order: 1000 },
    ]);
  });

  it("ignores ids the user does not own", async () => {
    const repo = await createRepository();

    const updated = await repo.reorderForUser("user-1", [
      { id: 3, sortOrder: 5000 },
    ]);
    expect(updated).toBe(0);

    expect(
      await adapter!.query(sql`SELECT sort_order FROM ssh_data WHERE id = 3`),
    ).toEqual([{ sort_order: null }]);
  });

  it("no-ops on an empty positions array", async () => {
    const repo = await createRepository();
    await expect(repo.reorderForUser("user-1", [])).resolves.toBe(0);
  });
});

describe("HostRepository Proxmox sync inserts", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    await adapter?.close();
    adapter = null;
  });

  it("creates a discovered guest using the scheduled-sync payload", async () => {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash');
      INSERT INTO ssh_credentials (id, user_id, name, auth_type, username)
      VALUES (7, 'user-1', 'guest key', 'key', 'alice');
    `);
    const repository = new HostRepository(context);
    const now = new Date().toISOString();
    vi.spyOn(DataCrypto, "validateUserAccess").mockReturnValue(
      Buffer.alloc(32, 1),
    );

    const created = await repository.createEncryptedForUser("user-1", {
      userId: "user-1",
      name: "guest",
      ip: "10.0.0.8",
      port: 22,
      username: "",
      connectionType: "ssh",
      folder: "Proxmox",
      tags: "proxmox,qemu,node-1,vm-100",
      proxmoxConfig: JSON.stringify({
        source: {
          source: "proxmox",
          sourceHostId: 1,
          node: "node-1",
          vmid: 100,
          type: "qemu",
        },
      }),
      updatedAt: now,
      createdAt: now,
      pin: false,
      authType: "credential",
      credentialId: 7,
      overrideCredentialUsername: 0,
      password: null,
      key: null,
      keyPassword: null,
      keyType: null,
      enableTerminal: true,
      enableFileManager: true,
      enableTunnel: true,
      enableDocker: false,
      enableSsh: true,
      enableRdp: false,
      rdpUser: null,
      rdpPassword: null,
      rdpDomain: null,
      rdpSecurity: null,
      rdpIgnoreCert: 0,
      rdpPort: null,
      vncUser: null,
      vncPassword: null,
      vncPort: null,
      telnetUser: null,
      telnetPassword: null,
      telnetPort: null,
      defaultPath: "/",
      tunnelConnections: "[]",
      jumpHosts: null,
      quickActions: null,
      statsConfig: null,
      dockerConfig: null,
      terminalConfig: null,
      forceKeyboardInteractive: "false",
      useSocks5: 0,
      socks5Host: null,
      socks5Port: null,
      socks5Username: null,
      socks5Password: null,
      socks5ProxyChain: null,
      portKnockSequence: null,
      showTerminalInSidebar: 0,
      showFileManagerInSidebar: 0,
      showTunnelInSidebar: 0,
      showDockerInSidebar: 0,
      showServerStatsInSidebar: 0,
    });

    expect(created.username).toBe("");
    expect(created.credentialId).toBe(7);
  });
});
