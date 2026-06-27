import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { CredentialRepository } from "./credential-repository.js";
import { HostRepository } from "./host-repository.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { SystemCrypto } from "../../utils/system-crypto.js";

describe("HostRepository and CredentialRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepositories(
    onCredentialWrite?: () => void,
    onHostWrite?: () => void,
  ): Promise<{
    credentials: CredentialRepository;
    hosts: HostRepository;
    sqlite: NonNullable<
      Awaited<ReturnType<SqliteDatabaseAdapter["connect"]>>["sqlite"]
    >;
  }> {
    adapter = new SqliteDatabaseAdapter({
      dialect: "sqlite",
      url: ":memory:",
      sqlitePath: ":memory:",
    });
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_oidc INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE ssh_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        folder TEXT,
        tags TEXT,
        auth_type TEXT NOT NULL,
        username TEXT,
        password TEXT,
        key TEXT,
        private_key TEXT,
        public_key TEXT,
        key_password TEXT,
        key_type TEXT,
        detected_key_type TEXT,
        cert_public_key TEXT,
        system_password TEXT,
        system_key TEXT,
        system_key_password TEXT,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE ssh_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        connection_type TEXT NOT NULL DEFAULT 'ssh',
        name TEXT,
        ip TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT NOT NULL,
        folder TEXT,
        tags TEXT,
        pin INTEGER NOT NULL DEFAULT 0,
        auth_type TEXT NOT NULL,
        use_warpgate INTEGER NOT NULL DEFAULT 0,
        force_keyboard_interactive TEXT,
        password TEXT,
        key TEXT,
        key_password TEXT,
        key_type TEXT,
        sudo_password TEXT,
        autostart_password TEXT,
        autostart_key TEXT,
        autostart_key_password TEXT,
        credential_id INTEGER,
        override_credential_username INTEGER,
        vault_profile_id INTEGER,
        enable_terminal INTEGER NOT NULL DEFAULT 1,
        enable_session_logging INTEGER NOT NULL DEFAULT 1,
        enable_command_history INTEGER NOT NULL DEFAULT 1,
        enable_tunnel INTEGER NOT NULL DEFAULT 1,
        tunnel_connections TEXT,
        jump_hosts TEXT,
        enable_file_manager INTEGER NOT NULL DEFAULT 1,
        scp_legacy INTEGER NOT NULL DEFAULT 0,
        enable_docker INTEGER NOT NULL DEFAULT 0,
        enable_tmux_monitor INTEGER NOT NULL DEFAULT 0,
        show_terminal_in_sidebar INTEGER NOT NULL DEFAULT 1,
        show_file_manager_in_sidebar INTEGER NOT NULL DEFAULT 0,
        show_tunnel_in_sidebar INTEGER NOT NULL DEFAULT 0,
        show_docker_in_sidebar INTEGER NOT NULL DEFAULT 0,
        show_server_stats_in_sidebar INTEGER NOT NULL DEFAULT 0,
        default_path TEXT,
        stats_config TEXT,
        docker_config TEXT,
        enable_proxmox INTEGER NOT NULL DEFAULT 0,
        proxmox_config TEXT,
        terminal_config TEXT,
        quick_actions TEXT,
        notes TEXT,
        enable_ssh INTEGER NOT NULL DEFAULT 1,
        enable_rdp INTEGER NOT NULL DEFAULT 0,
        enable_vnc INTEGER NOT NULL DEFAULT 0,
        enable_telnet INTEGER NOT NULL DEFAULT 0,
        ssh_port INTEGER DEFAULT 22,
        rdp_port INTEGER DEFAULT 3389,
        vnc_port INTEGER DEFAULT 5900,
        telnet_port INTEGER DEFAULT 23,
        rdp_credential_id INTEGER,
        rdp_user TEXT,
        rdp_password TEXT,
        rdp_domain TEXT,
        rdp_security TEXT,
        rdp_ignore_cert INTEGER DEFAULT 0,
        vnc_credential_id INTEGER,
        vnc_password TEXT,
        vnc_user TEXT,
        telnet_user TEXT,
        telnet_password TEXT,
        telnet_credential_id INTEGER,
        rdp_auth_type TEXT,
        vnc_auth_type TEXT,
        telnet_auth_type TEXT,
        domain TEXT,
        security TEXT,
        ignore_cert INTEGER DEFAULT 0,
        guacamole_config TEXT,
        use_socks5 INTEGER,
        socks5_host TEXT,
        socks5_port INTEGER,
        socks5_username TEXT,
        socks5_password TEXT,
        socks5_proxy_chain TEXT,
        mac_address TEXT,
        wol_broadcast_address TEXT,
        port_knock_sequence TEXT,
        host_key_fingerprint TEXT,
        host_key_type TEXT,
        host_key_algorithm TEXT DEFAULT 'sha256',
        host_key_first_seen TEXT,
        host_key_last_verified TEXT,
        host_key_changed_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (credential_id) REFERENCES ssh_credentials(id) ON DELETE SET NULL
      );

      CREATE TABLE host_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL,
        user_id TEXT,
        role_id INTEGER,
        granted_by TEXT NOT NULL,
        permission_level TEXT NOT NULL DEFAULT 'view',
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_accessed_at TEXT,
        access_count INTEGER NOT NULL DEFAULT 0,
        override_credential_id INTEGER,
        FOREIGN KEY (host_id) REFERENCES ssh_data(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (override_credential_id) REFERENCES ssh_credentials(id) ON DELETE SET NULL
      );

      CREATE TABLE ssh_credential_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credential_id INTEGER NOT NULL,
        host_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (credential_id) REFERENCES ssh_credentials(id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO users (id, username, password_hash) VALUES
        ('user-1', 'user', 'hash'),
        ('user-2', 'other', 'hash');
    `);

    return {
      credentials: new CredentialRepository(context, onCredentialWrite),
      hosts: new HostRepository(context, onHostWrite),
      sqlite: context.sqlite!,
    };
  }

  it("creates, finds, updates, lists, and deletes credentials", async () => {
    const repo = await createRepositories();

    const created = await repo.credentials.create({
      userId: "user-1",
      name: "primary",
      authType: "password",
      username: "root",
      password: "secret",
      folder: "prod",
    });

    expect(created.id).toBeGreaterThan(0);
    expect(await repo.credentials.listFolders("user-1")).toEqual(["prod"]);
    expect(
      (await repo.credentials.findByIdForUser("user-1", created.id))?.name,
    ).toBe("primary");
    expect((await repo.credentials.findById(created.id))?.name).toBe("primary");

    const updated = await repo.credentials.updateForUser("user-1", created.id, {
      folder: "ops",
      tags: "linux,admin",
    });
    expect(updated?.folder).toBe("ops");

    expect(
      await repo.credentials.findByIdForUser("user-2", created.id),
    ).toBeNull();
    expect(await repo.credentials.deleteForUser("user-1", created.id)).toBe(
      true,
    );
    expect(
      await repo.credentials.findByIdForUser("user-1", created.id),
    ).toBeNull();
  });

  it("deletes user credentials through the cleanup boundary", async () => {
    const onWrite = vi.fn();
    const repo = await createRepositories(onWrite);

    await repo.credentials.create({
      userId: "user-1",
      name: "primary",
      authType: "password",
    });
    await repo.credentials.create({
      userId: "user-1",
      name: "secondary",
      authType: "key",
    });
    await repo.credentials.create({
      userId: "user-2",
      name: "other",
      authType: "password",
    });
    onWrite.mockClear();

    await expect(repo.credentials.deleteByUserId("user-1")).resolves.toBe(2);

    expect(await repo.credentials.listByUserId("user-1")).toEqual([]);
    expect((await repo.credentials.listByUserId("user-2")).length).toBe(1);
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("loads credentials through the decryption boundary", async () => {
    const repo = await createRepositories();
    vi.spyOn(DataCrypto, "getUserDataKey").mockReturnValue(
      Buffer.from("user-key"),
    );
    vi.spyOn(DataCrypto, "decryptRecords").mockImplementation(
      (_tableName, records) => records,
    );
    vi.spyOn(DataCrypto, "decryptRecord").mockImplementation(
      (_tableName, record) => record,
    );

    const created = await repo.credentials.create({
      userId: "user-1",
      name: "primary",
      authType: "password",
      username: "root",
      password: "secret",
      folder: "prod",
    });

    await expect(
      repo.credentials.listDecryptedByUserId("user-1"),
    ).resolves.toMatchObject([{ id: created.id, password: "secret" }]);
    await expect(
      repo.credentials.findDecryptedByIdForUser("user-1", created.id),
    ).resolves.toMatchObject({ id: created.id, password: "secret" });
    expect(DataCrypto.decryptRecords).toHaveBeenCalledWith(
      "ssh_credentials",
      expect.arrayContaining([expect.objectContaining({ id: created.id })]),
      "user-1",
      Buffer.from("user-key"),
    );
    expect(DataCrypto.decryptRecord).toHaveBeenCalledWith(
      "ssh_credentials",
      expect.objectContaining({ id: created.id }),
      "user-1",
      Buffer.from("user-key"),
    );
  });

  it("encrypts credential writes with user and system keys", async () => {
    const repo = await createRepositories();
    vi.spyOn(DataCrypto, "validateUserAccess").mockReturnValue(
      Buffer.from("user-key"),
    );
    vi.spyOn(DataCrypto, "getUserDataKey").mockReturnValue(
      Buffer.from("user-key"),
    );
    vi.spyOn(DataCrypto, "encryptRecord").mockImplementation(
      (_tableName, record) =>
        ({
          ...record,
          password: "user-encrypted-password",
        }) as typeof record,
    );
    vi.spyOn(DataCrypto, "encryptRecordWithSystemKey").mockResolvedValue({
      systemPassword: "system-encrypted-password",
    });
    vi.spyOn(DataCrypto, "decryptRecord").mockImplementation(
      (_tableName, record) => record,
    );
    vi.spyOn(
      SystemCrypto.getInstance(),
      "getCredentialSharingKey",
    ).mockResolvedValue(Buffer.from("system-key"));

    const created = await repo.credentials.createEncryptedForUser("user-1", {
      userId: "user-1",
      name: "primary",
      authType: "password",
      username: "root",
      password: "secret",
    });

    const raw = repo.sqlite
      .prepare(
        "SELECT password, system_password FROM ssh_credentials WHERE id = ?",
      )
      .get(created.id) as { password: string; system_password: string };

    expect(raw.password).toBe("user-encrypted-password");
    expect(raw.system_password).toBe("system-encrypted-password");

    await repo.credentials.updateEncryptedForUser("user-1", created.id, {
      password: "updated-secret",
    });

    const updatedRaw = repo.sqlite
      .prepare(
        "SELECT password, system_password FROM ssh_credentials WHERE id = ?",
      )
      .get(created.id) as { password: string; system_password: string };

    expect(updatedRaw.password).toBe("user-encrypted-password");
    expect(updatedRaw.system_password).toBe("system-encrypted-password");
    expect(DataCrypto.encryptRecordWithSystemKey).toHaveBeenCalledWith(
      "ssh_credentials",
      expect.objectContaining({ password: "updated-secret" }),
      Buffer.from("system-key"),
    );
  });

  it("renames credential folders through the write boundary", async () => {
    const onWrite = vi.fn();
    const repo = await createRepositories(onWrite);

    await repo.credentials.create({
      userId: "user-1",
      name: "primary",
      authType: "password",
      folder: "prod",
    });
    await repo.credentials.create({
      userId: "user-1",
      name: "secondary",
      authType: "key",
      folder: "prod",
    });
    await repo.credentials.create({
      userId: "user-2",
      name: "other",
      authType: "password",
      folder: "prod",
    });
    onWrite.mockClear();

    await expect(
      repo.credentials.renameFolder("user-1", "prod", "ops"),
    ).resolves.toBe(2);

    expect(await repo.credentials.listFolders("user-1")).toEqual(["ops"]);
    expect(await repo.credentials.listFolders("user-2")).toEqual(["prod"]);
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("returns empty credential reads when user data is locked", async () => {
    const repo = await createRepositories();
    vi.spyOn(DataCrypto, "getUserDataKey").mockReturnValue(null);

    const created = await repo.credentials.create({
      userId: "user-1",
      name: "primary",
      authType: "password",
      username: "root",
      password: "secret",
    });

    await expect(
      repo.credentials.listDecryptedByUserId("user-1"),
    ).resolves.toEqual([]);
    await expect(
      repo.credentials.findDecryptedByIdForUser("user-1", created.id),
    ).resolves.toBeNull();
  });

  it("creates, finds, updates, lists, and deletes hosts", async () => {
    const repo = await createRepositories();

    const host = await repo.hosts.create({
      userId: "user-1",
      name: "web-1",
      ip: "10.0.0.10",
      port: 22,
      username: "root",
      authType: "password",
    });

    expect(host.id).toBeGreaterThan(0);
    expect((await repo.hosts.findById(host.id))?.name).toBe("web-1");
    expect(
      (await repo.hosts.listByUserId("user-1")).map((item) => item.id),
    ).toEqual([host.id]);

    const updated = await repo.hosts.updateForUser("user-1", host.id, {
      name: "web-1-renamed",
      folder: "prod",
    });
    expect(updated?.name).toBe("web-1-renamed");
    expect(await repo.hosts.findByIdForUser("user-2", host.id)).toBeNull();

    expect(await repo.hosts.deleteForUser("user-1", host.id)).toBe(true);
    expect(await repo.hosts.findById(host.id)).toBeNull();
  });

  it("encrypts host writes through the repository boundary", async () => {
    const repo = await createRepositories();
    vi.spyOn(DataCrypto, "validateUserAccess").mockReturnValue(
      Buffer.from("user-key"),
    );
    vi.spyOn(DataCrypto, "encryptRecord").mockImplementation(
      (_tableName, record) =>
        ({
          ...record,
          password: "encrypted-host-password",
        }) as typeof record,
    );
    vi.spyOn(DataCrypto, "decryptRecord").mockImplementation(
      (_tableName, record) => record,
    );

    const created = await repo.hosts.createEncryptedForUser("user-1", {
      userId: "user-1",
      name: "web-1",
      ip: "10.0.0.10",
      port: 22,
      username: "root",
      authType: "password",
      password: "secret",
    });

    const raw = repo.sqlite
      .prepare("SELECT password FROM ssh_data WHERE id = ?")
      .get(created.id) as { password: string };

    expect(raw.password).toBe("encrypted-host-password");

    await repo.hosts.updateEncryptedForUser("user-1", created.id, {
      password: "updated-secret",
    });

    const updatedRaw = repo.sqlite
      .prepare("SELECT password FROM ssh_data WHERE id = ?")
      .get(created.id) as { password: string };

    expect(updatedRaw.password).toBe("encrypted-host-password");
    expect(DataCrypto.encryptRecord).toHaveBeenCalledWith(
      "ssh_data",
      expect.objectContaining({ password: "updated-secret" }),
      "user-1",
      Buffer.from("user-key"),
    );
  });

  it("deletes user hosts through the cleanup boundary", async () => {
    const onWrite = vi.fn();
    const repo = await createRepositories(undefined, onWrite);

    await repo.hosts.create({
      userId: "user-1",
      name: "web-1",
      ip: "10.0.0.10",
      port: 22,
      username: "root",
      authType: "password",
    });
    await repo.hosts.create({
      userId: "user-1",
      name: "web-2",
      ip: "10.0.0.11",
      port: 22,
      username: "root",
      authType: "password",
    });
    await repo.hosts.create({
      userId: "user-2",
      name: "other",
      ip: "10.0.0.12",
      port: 22,
      username: "root",
      authType: "password",
    });
    onWrite.mockClear();

    await expect(repo.hosts.deleteByUserId("user-1")).resolves.toBe(2);

    expect(await repo.hosts.listByUserId("user-1")).toEqual([]);
    expect((await repo.hosts.listByUserId("user-2")).length).toBe(1);
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("lists bulk update state and updates multiple owned hosts", async () => {
    const onWrite = vi.fn();
    const repo = await createRepositories(undefined, onWrite);

    const first = await repo.hosts.create({
      userId: "user-1",
      name: "web-1",
      ip: "10.0.0.10",
      port: 22,
      username: "root",
      authType: "password",
      statsConfig: JSON.stringify({ cpu: true }),
    });
    const second = await repo.hosts.create({
      userId: "user-1",
      name: "web-2",
      ip: "10.0.0.11",
      port: 22,
      username: "root",
      authType: "password",
    });
    const other = await repo.hosts.create({
      userId: "user-2",
      name: "other",
      ip: "10.0.0.12",
      port: 22,
      username: "root",
      authType: "password",
    });
    onWrite.mockClear();

    const states = await repo.hosts.listBulkUpdateState("user-1", [
      first.id,
      second.id,
      other.id,
    ]);
    expect(states.map((state) => state.id)).toEqual([first.id, second.id]);

    await expect(
      repo.hosts.updateManyForUser("user-1", [first.id, second.id, other.id], {
        folder: "ops",
      }),
    ).resolves.toBe(2);
    expect((await repo.hosts.findById(first.id))?.folder).toBe("ops");
    expect((await repo.hosts.findById(other.id))?.folder).toBeNull();
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("records credential usage and increments usage counters", async () => {
    const repo = await createRepositories();
    const credential = await repo.credentials.create({
      userId: "user-1",
      name: "primary",
      authType: "password",
    });
    const host = await repo.hosts.create({
      userId: "user-1",
      name: "web-1",
      ip: "10.0.0.10",
      port: 22,
      username: "root",
      authType: "credential",
      credentialId: credential.id,
    });

    await repo.credentials.recordUsage(
      "user-1",
      credential.id,
      host.id,
      "2026-06-26T00:00:00.000Z",
    );

    const updated = await repo.credentials.findByIdForUser(
      "user-1",
      credential.id,
    );
    expect(updated?.usageCount).toBe(1);
    expect(updated?.lastUsed).toBe("2026-06-26T00:00:00.000Z");
  });

  it("cleans host access before deleting a host", async () => {
    const repo = await createRepositories();
    const host = await repo.hosts.create({
      userId: "user-1",
      name: "shared-host",
      ip: "10.0.0.20",
      port: 22,
      username: "root",
      authType: "password",
    });

    repo.sqlite
      .prepare(
        "INSERT INTO host_access (host_id, user_id, granted_by) VALUES (?, ?, ?)",
      )
      .run(host.id, "user-2", "user-1");

    expect(await repo.hosts.deleteAccessForHost(host.id)).toBe(1);
    expect(await repo.hosts.deleteForUser("user-1", host.id)).toBe(true);
  });
});
