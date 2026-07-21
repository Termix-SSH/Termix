import { afterEach, describe, expect, it, vi } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { DataCrypto } from "../../../utils/data-crypto.js";
import { HostResolutionRepository } from "../../../database/repositories/host-resolution-repository.js";

vi.mock("../../../utils/data-crypto.js", () => ({
  DataCrypto: {
    getUserDataKey: vi.fn(),
    decryptRecord: vi.fn((_tableName, record) => record),
  },
}));

describe("HostResolutionRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    vi.mocked(DataCrypto.getUserDataKey).mockReset();
    vi.mocked(DataCrypto.decryptRecord).mockClear();
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<HostResolutionRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
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
        allow_session_sharing INTEGER NOT NULL DEFAULT 1,
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
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
        override_credential_id INTEGER
      );

      CREATE TABLE ssh_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT,
        icon TEXT,
        credential_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ssh_data (
        id, user_id, name, ip, port, username, auth_type, credential_id,
        tunnel_connections
      )
      VALUES
        (1, 'user-1', 'web', '10.0.0.1', 22, 'root', 'password', 7, '[{"autoStart":true}]'),
        (2, 'user-1', 'db', '10.0.0.2', 22, 'admin', 'none', NULL, NULL),
        (3, 'user-2', 'other', '10.0.0.3', 22, 'root', 'none', NULL, '[{"autoStart":false}]');
      INSERT INTO ssh_credentials (
        id, user_id, name, auth_type, username, password, private_key, key_password
      )
      VALUES
        (7, 'user-1', 'owner', 'password', 'root', 'secret', NULL, NULL),
        (8, 'user-2', 'override', 'key', 'alice', NULL, 'private', 'pass');
      INSERT INTO host_access (
        host_id, user_id, granted_by, permission_level, override_credential_id
      )
      VALUES (1, 'user-2', 'user-1', 'execute', 8);
      INSERT INTO ssh_folders (user_id, name, credential_id)
      VALUES
        ('user-1', 'switches', 7),
        ('user-1', 'switches / floor1', NULL),
        ('user-1', 'no-cred', NULL);
    `);

    return new HostResolutionRepository(context, onWrite);
  }

  it("loads host and credential rows through the decryption boundary", async () => {
    vi.mocked(DataCrypto.getUserDataKey).mockReturnValue(
      Buffer.from("user-key"),
    );
    const repository = await createRepository();

    await expect(repository.findHostById(1, "user-1")).resolves.toMatchObject({
      id: 1,
      userId: "user-1",
      name: "web",
      credentialId: 7,
    });
    await expect(
      repository.findHostByIdForUser(1, "user-1"),
    ).resolves.toMatchObject({
      id: 1,
      userId: "user-1",
      name: "web",
      credentialId: 7,
    });
    await expect(
      repository.findHostByIdForUser(3, "user-1"),
    ).resolves.toBeNull();
    await expect(
      repository.findCredentialByIdForUser(7, "user-1"),
    ).resolves.toMatchObject({
      id: 7,
      userId: "user-1",
      username: "root",
      password: "secret",
    });
    await expect(
      repository.findCredentialByIdForOwnerDecryptedAs(7, "user-1", "user-2"),
    ).resolves.toMatchObject({
      id: 7,
      userId: "user-1",
      username: "root",
      password: "secret",
    });
    expect(DataCrypto.decryptRecord).toHaveBeenCalledWith(
      "ssh_data",
      expect.objectContaining({ id: 1 }),
      "user-1",
      Buffer.from("user-key"),
    );
    expect(DataCrypto.decryptRecord).toHaveBeenCalledWith(
      "ssh_credentials",
      expect.objectContaining({ id: 7 }),
      "user-1",
      Buffer.from("user-key"),
    );
    expect(DataCrypto.decryptRecord).toHaveBeenCalledWith(
      "ssh_credentials",
      expect.objectContaining({ id: 7 }),
      "user-2",
      Buffer.from("user-key"),
    );
  });

  it("lists user-owned hosts through the decryption boundary", async () => {
    vi.mocked(DataCrypto.getUserDataKey).mockReturnValue(
      Buffer.from("user-key"),
    );
    const repository = await createRepository();

    const rows = await repository.findHostsByUserId("user-1");

    expect(rows.map((row) => row.id)).toEqual([1, 2]);
    expect(DataCrypto.decryptRecord).toHaveBeenCalledWith(
      "ssh_data",
      expect.objectContaining({ id: 1 }),
      "user-1",
      Buffer.from("user-key"),
    );
    expect(DataCrypto.decryptRecord).toHaveBeenCalledWith(
      "ssh_data",
      expect.objectContaining({ id: 2 }),
      "user-1",
      Buffer.from("user-key"),
    );
  });

  it("lists raw own and shared host rows for access list assembly", async () => {
    const repository = await createRepository();

    const rows = await repository.listHostRowsForAccessList("user-2", [
      { hostId: 1, permissionLevel: "execute", expiresAt: null },
      { hostId: 3, permissionLevel: "view", expiresAt: null },
      { hostId: 999, permissionLevel: "view", expiresAt: null },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 3,
      userId: "user-2",
      ownerId: "user-2",
      isShared: false,
      permissionLevel: undefined,
      expiresAt: undefined,
    });
    expect(rows[1]).toMatchObject({
      id: 1,
      userId: "user-1",
      ownerId: "user-1",
      isShared: true,
      permissionLevel: "execute",
      expiresAt: null,
    });
    expect(DataCrypto.decryptRecord).not.toHaveBeenCalled();
  });

  it("loads host owner metadata without decrypting host data", async () => {
    const repository = await createRepository();

    await expect(repository.findHostOwnerId(1)).resolves.toBe("user-1");
    await expect(repository.findHostOwnerId(999)).resolves.toBeNull();
    await expect(repository.isHostOwnedByUser(1, "user-1")).resolves.toBe(true);
    await expect(repository.isHostOwnedByUser(1, "user-2")).resolves.toBe(
      false,
    );
    expect(DataCrypto.decryptRecord).not.toHaveBeenCalled();
  });

  it("loads host update state without decrypting host data", async () => {
    const repository = await createRepository();

    await expect(repository.findHostUpdateState(1)).resolves.toEqual({
      userId: "user-1",
      credentialId: 7,
      rdpCredentialId: null,
      vncCredentialId: null,
      telnetCredentialId: null,
      vaultProfileId: null,
      authType: "password",
    });
    await expect(repository.findHostUpdateState(999)).resolves.toBeNull();
    expect(DataCrypto.decryptRecord).not.toHaveBeenCalled();
  });

  it("lists hosts using a credential through the decryption boundary", async () => {
    vi.mocked(DataCrypto.getUserDataKey).mockReturnValue(
      Buffer.from("user-key"),
    );
    const repository = await createRepository();

    const rows = await repository.listHostsUsingCredentialForUser("user-1", 7);

    expect(rows.map((row) => row.id)).toEqual([1]);
    expect(DataCrypto.decryptRecord).toHaveBeenCalledWith(
      "ssh_data",
      expect.objectContaining({ id: 1 }),
      "user-1",
      Buffer.from("user-key"),
    );
  });

  it("lists all hosts through each owner decryption boundary", async () => {
    vi.mocked(DataCrypto.getUserDataKey).mockImplementation((userId) =>
      Buffer.from(`${userId}-key`),
    );
    const repository = await createRepository();

    const rows = await repository.listAllHosts();

    expect(rows.map((row) => row.id)).toEqual([1, 2, 3]);
    expect(DataCrypto.decryptRecord).toHaveBeenCalledWith(
      "ssh_data",
      expect.objectContaining({ id: 1 }),
      "user-1",
      Buffer.from("user-1-key"),
    );
    expect(DataCrypto.decryptRecord).toHaveBeenCalledWith(
      "ssh_data",
      expect.objectContaining({ id: 3 }),
      "user-2",
      Buffer.from("user-2-key"),
    );
  });

  it("lists tunnel-enabled hosts with tunnel data through each owner decryption boundary", async () => {
    vi.mocked(DataCrypto.getUserDataKey).mockImplementation((userId) =>
      Buffer.from(`${userId}-key`),
    );
    const repository = await createRepository();

    const rows = await repository.listHostsWithTunnelConnections();

    expect(rows.map((row) => row.id)).toEqual([1, 3]);
    expect(DataCrypto.decryptRecord).toHaveBeenCalledWith(
      "ssh_data",
      expect.objectContaining({ id: 1 }),
      "user-1",
      Buffer.from("user-1-key"),
    );
    expect(DataCrypto.decryptRecord).toHaveBeenCalledWith(
      "ssh_data",
      expect.objectContaining({ id: 3 }),
      "user-2",
      Buffer.from("user-2-key"),
    );
  });

  it("skips owner-scoped host list rows when that user's data is locked", async () => {
    vi.mocked(DataCrypto.getUserDataKey).mockImplementation((userId) =>
      userId === "user-1" ? Buffer.from("user-1-key") : null,
    );
    const repository = await createRepository();

    const rows = await repository.listAllHosts();

    expect(rows.map((row) => row.id)).toEqual([1, 2]);
    expect(DataCrypto.decryptRecord).not.toHaveBeenCalledWith(
      "ssh_data",
      expect.objectContaining({ id: 3 }),
      expect.any(String),
      expect.any(Buffer),
    );
  });

  it("loads host key verification metadata without decrypting credentials", async () => {
    const repository = await createRepository();

    const row = await repository.findHostKeyVerificationData(1);

    expect(row).toMatchObject({
      hostKeyFingerprint: null,
      hostKeyType: null,
      hostKeyAlgorithm: "sha256",
      hostKeyChangedCount: 0,
      name: "web",
    });
    expect(DataCrypto.decryptRecord).not.toHaveBeenCalled();
  });

  it("stores and updates host key verification metadata through the write boundary", async () => {
    const onWrite = vi.fn();
    const repository = await createRepository(onWrite);

    await repository.storeHostKey(
      1,
      "fingerprint-1",
      "ssh-rsa",
      "sha256",
      "t1",
    );
    await expect(
      repository.findHostKeyVerificationData(1),
    ).resolves.toMatchObject({
      hostKeyFingerprint: "fingerprint-1",
      hostKeyType: "ssh-rsa",
      hostKeyAlgorithm: "sha256",
      hostKeyChangedCount: 0,
    });

    await repository.touchHostKeyLastVerified(1, "t2");
    await repository.updateHostKey(
      1,
      "fingerprint-2",
      "ssh-ed25519",
      "sha256",
      0,
      "t3",
    );

    await expect(
      repository.findHostKeyVerificationData(1),
    ).resolves.toMatchObject({
      hostKeyFingerprint: "fingerprint-2",
      hostKeyType: "ssh-ed25519",
      hostKeyAlgorithm: "sha256",
      hostKeyChangedCount: 1,
    });
    expect(onWrite).toHaveBeenCalledTimes(3);
  });

  it("returns null when user data is locked", async () => {
    vi.mocked(DataCrypto.getUserDataKey).mockReturnValue(null);
    const repository = await createRepository();

    await expect(repository.findHostById(1, "user-1")).resolves.toBeNull();
    await expect(
      repository.findHostByIdForUser(1, "user-1"),
    ).resolves.toBeNull();
    await expect(repository.findHostsByUserId("user-1")).resolves.toEqual([]);
    await expect(
      repository.listHostsUsingCredentialForUser("user-1", 7),
    ).resolves.toEqual([]);
    await expect(
      repository.findCredentialByIdForUser(7, "user-1"),
    ).resolves.toBeNull();
  });

  it("loads override credential ids for shared host resolution", async () => {
    const repository = await createRepository();

    await expect(
      repository.findOverrideCredentialId(1, "user-2"),
    ).resolves.toBe(8);
    await expect(
      repository.findOverrideCredentialId(1, "user-1"),
    ).resolves.toBeNull();
  });

  it("resolves a folder's assigned credential, walking up to parent folders", async () => {
    const repository = await createRepository();

    await expect(
      repository.findFolderCredentialId("user-1", "switches"),
    ).resolves.toBe(7);
    await expect(
      repository.findFolderCredentialId("user-1", "switches / floor1"),
    ).resolves.toBe(7);
    await expect(
      repository.findFolderCredentialId("user-1", "no-cred"),
    ).resolves.toBeNull();
    await expect(
      repository.findFolderCredentialId("user-1", "unknown"),
    ).resolves.toBeNull();
    await expect(
      repository.findFolderCredentialId("user-1", ""),
    ).resolves.toBeNull();
  });
});
