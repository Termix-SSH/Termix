import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { HostFolderRepository } from "./host-folder-repository.js";

describe("HostFolderRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<{
    repository: HostFolderRepository;
    sqlite: NonNullable<
      Awaited<ReturnType<TestSqliteDatabase["connect"]>>["sqlite"]
    >;
  }> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );

      CREATE TABLE ssh_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        folder TEXT,
        auth_type TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE ssh_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT,
        icon TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, folder, auth_type)
      VALUES
        (1, 'user-1', 'one', '10.0.0.1', 22, 'root', 'prod', 'password'),
        (2, 'user-1', 'two', '10.0.0.2', 22, 'root', 'prod / api', 'password'),
        (3, 'user-2', 'other', '10.0.0.3', 22, 'root', 'prod', 'password');
      INSERT INTO ssh_credentials (id, user_id, name, folder, auth_type)
      VALUES
        (1, 'user-1', 'cred-one', 'prod', 'password'),
        (2, 'user-1', 'cred-two', 'prod / api', 'password'),
        (3, 'user-2', 'cred-other', 'prod', 'password');
      INSERT INTO ssh_folders (id, user_id, name, color, icon)
      VALUES
        (1, 'user-1', 'prod', '#111111', 'server'),
        (2, 'user-1', 'prod / api', '#222222', 'box'),
        (3, 'user-2', 'prod', '#333333', 'user');
    `);

    return {
      repository: new HostFolderRepository(context, onWrite),
      sqlite: context.sqlite!,
    };
  }

  it("renames folders across hosts, credentials, and folder records", async () => {
    let writes = 0;
    const { repository, sqlite } = await createRepository(() => {
      writes += 1;
    });

    await expect(
      repository.renameFolder(
        "user-1",
        "prod",
        "ops",
        "2026-01-01T00:00:00.000Z",
      ),
    ).resolves.toEqual({ updatedHosts: 2, updatedCredentials: 2 });

    expect(
      sqlite
        .prepare("SELECT folder FROM ssh_data WHERE user_id = ? ORDER BY id")
        .all("user-1"),
    ).toEqual([{ folder: "ops" }, { folder: "ops / api" }]);
    expect(
      sqlite
        .prepare(
          "SELECT folder FROM ssh_credentials WHERE user_id = ? ORDER BY id",
        )
        .all("user-1"),
    ).toEqual([{ folder: "ops" }, { folder: "ops / api" }]);
    expect(
      sqlite
        .prepare("SELECT name FROM ssh_folders WHERE user_id = ? ORDER BY id")
        .all("user-1"),
    ).toEqual([{ name: "ops" }, { name: "ops / api" }]);
    expect(writes).toBe(1);
  });

  it("lists folders and upserts metadata", async () => {
    let writes = 0;
    const { repository } = await createRepository(() => {
      writes += 1;
    });

    await expect(repository.listFolders("user-1")).resolves.toHaveLength(2);
    await expect(
      repository.upsertMetadata(
        "user-1",
        "prod",
        "#abcdef",
        "folder",
        "2026-02-01T00:00:00.000Z",
      ),
    ).resolves.toMatchObject({
      created: false,
      folder: { color: "#abcdef", icon: "folder" },
    });
    await expect(
      repository.upsertMetadata(
        "user-1",
        "new",
        null,
        null,
        "2026-03-01T00:00:00.000Z",
      ),
    ).resolves.toMatchObject({
      created: true,
      folder: { name: "new" },
    });
    expect(writes).toBe(2);
  });

  it("lists and deletes hosts and folder records in a folder tree", async () => {
    let writes = 0;
    const { repository, sqlite } = await createRepository(() => {
      writes += 1;
    });

    const hostsToDelete = await repository.listHostsInFolder("user-1", "prod");
    expect(hostsToDelete.map((host) => host.id)).toEqual([1, 2]);

    await repository.deleteHostsAndFolderRecords("user-1", "prod");

    expect(sqlite.prepare("SELECT id FROM ssh_data ORDER BY id").all()).toEqual(
      [{ id: 3 }],
    );
    expect(
      sqlite.prepare("SELECT id FROM ssh_folders ORDER BY id").all(),
    ).toEqual([{ id: 3 }]);
    expect(writes).toBe(1);
  });

  it("deletes folder records for a user", async () => {
    let writes = 0;
    const { repository, sqlite } = await createRepository(() => {
      writes += 1;
    });

    await expect(repository.deleteByUserId("user-1")).resolves.toBe(2);

    expect(sqlite.prepare("SELECT id FROM ssh_data ORDER BY id").all()).toEqual(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
    );
    expect(
      sqlite.prepare("SELECT id FROM ssh_folders ORDER BY id").all(),
    ).toEqual([{ id: 3 }]);
    expect(writes).toBe(1);
  });
});
