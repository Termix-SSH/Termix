import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { UserDataExportRepository } from "../../../database/repositories/user-data-export-repository.js";

describe("UserDataExportRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(): Promise<UserDataExportRepository> {
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

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');

      INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type)
      VALUES
        (1, 'user-1', 'web', '10.0.0.1', 22, 'root', 'password'),
        (2, 'user-2', 'db', '10.0.0.2', 22, 'root', 'password');

      INSERT INTO ssh_credentials (id, user_id, name, auth_type, username, password)
      VALUES
        (1, 'user-1', 'prod', 'password', 'root', 'secret'),
        (2, 'user-2', 'other', 'password', 'root', 'secret');
    `);

    return new UserDataExportRepository(context);
  }

  it("lists only the current user's exportable hosts and credentials", async () => {
    const repository = await createRepository();

    expect(await repository.listHostsByUserId("user-1")).toMatchObject([
      {
        id: 1,
        userId: "user-1",
        name: "web",
        ip: "10.0.0.1",
      },
    ]);

    expect(await repository.listCredentialsByUserId("user-1")).toMatchObject([
      {
        id: 1,
        userId: "user-1",
        name: "prod",
        username: "root",
      },
    ]);
  });
});
