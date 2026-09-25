-- The SQLite schema a fresh 2.8.0 install builds: release-2.8.0-tag's
-- initializeDatabase() run once against an empty DATA_DIR, then every
-- sqlite_master statement dumped. The upgrade tests start from this.

CREATE TABLE ai_conversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT,
          provider_id INTEGER,
          model TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE ai_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          tool_calls TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE ai_proposals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          summary TEXT,
          payload TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending',
          applied_at TEXT,
          result_summary TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE ai_providers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider_type TEXT NOT NULL,
          label TEXT NOT NULL,
          base_url TEXT,
          api_key TEXT,
          api_key_prefix TEXT,
          default_model TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, label)
        );

CREATE TABLE alert_firings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          rule_id INTEGER NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
          host_id INTEGER NOT NULL,
          host_name TEXT NOT NULL,
          fired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          resolved_at TEXT,
          value REAL,
          message TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'warning',
          acknowledged INTEGER NOT NULL DEFAULT 0
        );

CREATE TABLE alert_rule_channels (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rule_id INTEGER NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
          channel_id INTEGER NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE
        );

CREATE TABLE alert_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          host_id INTEGER REFERENCES ssh_data(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          trigger_type TEXT NOT NULL,
          threshold_value REAL,
          threshold_duration_seconds INTEGER,
          cooldown_minutes INTEGER NOT NULL DEFAULT 15,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        token_prefix TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT,
        last_used_at TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        resource_name TEXT,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        success INTEGER NOT NULL,
        error_message TEXT,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
    );

CREATE TABLE automation_channels (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
          channel_id INTEGER NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE
        );

CREATE TABLE automation_run_steps (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
          step_index INTEGER NOT NULL,
          step_id TEXT NOT NULL,
          step_type TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          finished_at TEXT,
          output TEXT,
          error TEXT,
          truncated INTEGER NOT NULL DEFAULT 0
        );

CREATE TABLE automation_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          trigger_type TEXT NOT NULL,
          trigger_context TEXT,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          finished_at TEXT,
          duration_ms INTEGER,
          error TEXT,
          dry_run INTEGER NOT NULL DEFAULT 0,
          parent_run_id INTEGER
        );

CREATE TABLE automation_schedules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
          cron TEXT,
          interval_seconds INTEGER,
          timezone TEXT,
          next_due_at TEXT,
          last_tick_at TEXT
        );

CREATE TABLE automation_trigger_state (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
          state_key TEXT NOT NULL,
          breach_started_at TEXT,
          last_fired_at TEXT,
          last_value REAL,
          last_observed_state TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE automations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          definition TEXT NOT NULL,
          definition_version INTEGER NOT NULL DEFAULT 1,
          concurrency_policy TEXT NOT NULL DEFAULT 'skip',
          max_run_seconds INTEGER NOT NULL DEFAULT 300,
          dry_run INTEGER NOT NULL DEFAULT 0,
          last_run_at TEXT,
          last_run_status TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE c2s_tunnel_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        config TEXT NOT NULL,
        platform TEXT,
        computer_name TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE collab_room_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        room_role TEXT NOT NULL DEFAULT 'member',
        added_by TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (room_id, user_id),
        FOREIGN KEY (room_id) REFERENCES collab_rooms (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (added_by) REFERENCES users (id) ON DELETE SET NULL
    );

CREATE TABLE collab_rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        persistent INTEGER NOT NULL DEFAULT 0,
        presenter_user_id TEXT,
        stage_protocol TEXT,
        stage_host_id INTEGER,
        stage_share_id TEXT,
        guest_link_token TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at TEXT,
        FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (presenter_user_id) REFERENCES users (id) ON DELETE SET NULL,
        FOREIGN KEY (stage_host_id) REFERENCES ssh_data (id) ON DELETE SET NULL,
        FOREIGN KEY (stage_share_id) REFERENCES session_shares (id) ON DELETE SET NULL
    );

CREATE TABLE command_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        command TEXT NOT NULL,
        executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
    );

CREATE TABLE credential_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credential_id INTEGER NOT NULL,
        user_id TEXT,
        role_id INTEGER,
        granted_by TEXT NOT NULL,
        permission_level TEXT NOT NULL DEFAULT 'use',
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (credential_id) REFERENCES ssh_credentials (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE credential_sidebar_preferences (
        user_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE dashboard_service_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      "order" INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    , "sync_id" TEXT, "updated_at" TEXT);

CREATE TABLE dismissed_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        alert_id TEXT NOT NULL,
        dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE file_manager_pinned (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        pinned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
    );

CREATE TABLE file_manager_recent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        last_opened TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
    );

CREATE TABLE file_manager_shortcuts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
    );

CREATE TABLE fleet_inventory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          host_id INTEGER NOT NULL REFERENCES ssh_data(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          os_pretty_name TEXT,
          kernel TEXT,
          architecture TEXT,
          hostname TEXT,
          uptime_seconds INTEGER,
          ip TEXT,
          package_manager TEXT,
          collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE fleet_members (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fleet_id INTEGER NOT NULL REFERENCES fleets(id) ON DELETE CASCADE,
          host_id INTEGER NOT NULL REFERENCES ssh_data(id) ON DELETE CASCADE,
          added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE fleets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          color TEXT,
          icon TEXT,
          tag_rules TEXT,
          sync_id TEXT UNIQUE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE folder_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id TEXT NOT NULL,
        folder TEXT NOT NULL,
        user_id TEXT,
        role_id INTEGER,
        granted_by TEXT NOT NULL,
        permission_level TEXT NOT NULL DEFAULT 'connect',
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE homepage_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type_id TEXT NOT NULL,
          title TEXT,
          config TEXT NOT NULL DEFAULT '{}',
          folder_id INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        , "sync_id" TEXT);

CREATE TABLE homepage_layouts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          layout TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE host_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL,
        user_id TEXT,
        role_id INTEGER,
        granted_by TEXT NOT NULL,
        permission_level TEXT NOT NULL DEFAULT 'use',
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_accessed_at TEXT,
        access_count INTEGER NOT NULL DEFAULT 0, override_credential_id INTEGER REFERENCES ssh_credentials(id) ON DELETE SET NULL,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE host_health_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        checks TEXT NOT NULL,
        interval_seconds INTEGER NOT NULL DEFAULT 300,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
    );

CREATE TABLE host_health_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        check_id TEXT NOT NULL,
        ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ok INTEGER NOT NULL,
        latency_ms INTEGER,
        detail TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
    );

CREATE TABLE host_metrics_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          host_id INTEGER NOT NULL REFERENCES ssh_data(id) ON DELETE CASCADE,
          ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          cpu_percent REAL,
          mem_percent REAL,
          disk_percent REAL,
          net_rx_bytes INTEGER,
          net_tx_bytes INTEGER
        );

CREATE TABLE host_metrics_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        layout TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
    );

CREATE TABLE host_sidebar_preferences (
        user_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE network_topology (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          topology TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

CREATE TABLE notification_channels (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          config TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE opkssh_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          host_id INTEGER NOT NULL,
          ssh_cert TEXT NOT NULL,
          private_key TEXT NOT NULL,
          email TEXT,
          sub TEXT,
          issuer TEXT,
          audience TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TEXT NOT NULL,
          last_used TEXT,
          UNIQUE(user_id, host_id),
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
        );

CREATE TABLE plugin_install_counts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plugin_id TEXT NOT NULL,
        registry_id TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'aggregate-telemetry',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (plugin_id, registry_id)
    );

CREATE TABLE plugin_permission_grants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plugin_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        granted_by TEXT NOT NULL,
        UNIQUE (plugin_id, capability),
        FOREIGN KEY (plugin_id) REFERENCES plugins (id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE plugin_registries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'community',
        enabled INTEGER NOT NULL DEFAULT 1,
        signing_key TEXT,
        last_checked_at TEXT,
        last_index_hash TEXT
    );

CREATE TABLE plugins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'available',
        source TEXT NOT NULL DEFAULT 'community',
        registry_id TEXT,
        state TEXT NOT NULL DEFAULT 'disabled',
        installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        auto_update INTEGER NOT NULL DEFAULT 0,
        manifest_json TEXT NOT NULL
    );

CREATE TABLE proxmox_node_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          host_id INTEGER NOT NULL REFERENCES ssh_data(id) ON DELETE CASCADE,
          ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          cpu_percent REAL,
          mem_percent REAL,
          disk_percent REAL,
          net_rx_bytes INTEGER,
          net_tx_bytes INTEGER
        );

CREATE TABLE proxmox_stats_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        layout TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
    );

CREATE TABLE recent_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        host_name TEXT,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
    );

CREATE TABLE roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT,
        is_system INTEGER NOT NULL DEFAULT 0,
        permissions TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE secret_sources (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'onepassword-connect',
        base_url TEXT NOT NULL,
        token TEXT NOT NULL,
        shared INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE session_recordings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL,
        user_id TEXT,
        username TEXT,
        access_id INTEGER,
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at TEXT,
        duration INTEGER,
        commands TEXT,
        dangerous_actions TEXT,
        recording_path TEXT,
        protocol TEXT NOT NULL DEFAULT 'ssh',
        format TEXT NOT NULL DEFAULT 'text',
        terminated_by_owner INTEGER DEFAULT 0,
        termination_reason TEXT,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
        FOREIGN KEY (access_id) REFERENCES host_access (id) ON DELETE SET NULL
    );

CREATE TABLE session_share_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        share_id TEXT NOT NULL,
        user_id TEXT,
        guest_label TEXT,
        joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        left_at TEXT,
        FOREIGN KEY (share_id) REFERENCES session_shares (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE session_shares (
        id TEXT PRIMARY KEY,
        host_id INTEGER NOT NULL,
        owner_user_id TEXT NOT NULL,
        protocol TEXT NOT NULL,
        session_id TEXT NOT NULL,
        tab_instance_id TEXT,
        share_type TEXT NOT NULL,
        target_user_id TEXT,
        link_token TEXT UNIQUE,
        permission_level TEXT NOT NULL DEFAULT 'read-only',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        last_joined_at TEXT,
        join_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE,
        FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        jwt_token TEXT NOT NULL,
        device_type TEXT NOT NULL,
        device_info TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "oidc_sub" TEXT, "oidc_sid" TEXT, "sso_provider_id" INTEGER,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

CREATE TABLE shared_credential_secrets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credential_access_id INTEGER NOT NULL,
        target_user_id TEXT NOT NULL,
        credential_id INTEGER NOT NULL,
        encrypted_username TEXT,
        auth_type TEXT NOT NULL DEFAULT 'password',
        encrypted_password TEXT,
        encrypted_key TEXT,
        encrypted_key_password TEXT,
        key_type TEXT,
        public_key TEXT,
        cert_public_key TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (credential_access_id, target_user_id),
        FOREIGN KEY (credential_access_id) REFERENCES credential_access (id) ON DELETE CASCADE,
        FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (credential_id) REFERENCES ssh_credentials (id) ON DELETE CASCADE
    );

CREATE TABLE shared_host_auth_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'ssh',
    credential_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (credential_id) REFERENCES ssh_credentials (id) ON DELETE CASCADE
  );

CREATE TABLE shared_host_secrets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          host_access_id INTEGER NOT NULL,
          target_user_id TEXT NOT NULL,
          protocol TEXT NOT NULL DEFAULT 'ssh',
          source_type TEXT NOT NULL DEFAULT 'credential',
          original_credential_id INTEGER,
          encrypted_username TEXT,
          encrypted_auth_type TEXT,
          encrypted_password TEXT,
          encrypted_key TEXT,
          encrypted_key_password TEXT,
          encrypted_key_type TEXT,
          encrypted_domain TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(host_access_id, target_user_id, protocol),
          FOREIGN KEY (host_access_id) REFERENCES host_access (id) ON DELETE CASCADE,
          FOREIGN KEY (original_credential_id) REFERENCES ssh_credentials (id) ON DELETE CASCADE,
          FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE CASCADE
        );

CREATE TABLE snippet_access (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          snippet_id INTEGER NOT NULL,
          user_id TEXT,
          role_id INTEGER,
          granted_by TEXT NOT NULL,
          permission_level TEXT NOT NULL DEFAULT 'view',
          expires_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (snippet_id) REFERENCES snippets (id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
          FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE CASCADE
        );

CREATE TABLE snippet_folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          color TEXT,
          icon TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "sync_id" TEXT,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

CREATE TABLE snippets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "folder" TEXT, "order" INTEGER NOT NULL DEFAULT 0, "host_filter" TEXT, "is_note" INTEGER NOT NULL DEFAULT 0, "sync_id" TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE ssh_credential_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credential_id INTEGER NOT NULL,
        host_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (credential_id) REFERENCES ssh_credentials (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
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
        key_password TEXT,
        key_type TEXT,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "private_key" TEXT, "public_key" TEXT, "detected_key_type" TEXT, "cert_public_key" TEXT, "pin" INTEGER NOT NULL DEFAULT 0, "sort_order" INTEGER, "sync_id" TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE ssh_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT,
        ip TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT NOT NULL,
        folder TEXT,
        tags TEXT,
        pin INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER,
        auth_type TEXT NOT NULL,
        password TEXT,
        key TEXT,
        key_password TEXT,
        key_type TEXT,
        enable_terminal INTEGER NOT NULL DEFAULT 1,
        enable_tunnel INTEGER NOT NULL DEFAULT 1,
        tunnel_connections TEXT,
        enable_file_manager INTEGER NOT NULL DEFAULT 1,
        enable_docker INTEGER NOT NULL DEFAULT 0,
        enable_web_ui INTEGER NOT NULL DEFAULT 0,
        default_path TEXT,
        autostart_password TEXT,
        autostart_key TEXT,
        autostart_key_password TEXT,
        force_keyboard_interactive TEXT,
        stats_config TEXT,
        docker_config TEXT,
        web_ui_config TEXT,
        terminal_config TEXT,
        notes TEXT,
        use_socks5 INTEGER,
        socks5_host TEXT,
        socks5_port INTEGER,
        socks5_username TEXT,
        socks5_password TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "enable_session_logging" INTEGER NOT NULL DEFAULT 1, "enable_command_history" INTEGER NOT NULL DEFAULT 1, "jump_hosts" TEXT, "scp_legacy" INTEGER NOT NULL DEFAULT 0, "credential_id" INTEGER REFERENCES ssh_credentials(id) ON DELETE SET NULL, "override_credential_username" INTEGER, "vault_profile_id" INTEGER REFERENCES vault_profiles(id) ON DELETE SET NULL, "quick_actions" TEXT, "enable_proxmox" INTEGER NOT NULL DEFAULT 0, "proxmox_config" TEXT, "enable_proxmox_stats" INTEGER NOT NULL DEFAULT 0, "proxmox_stats_config" TEXT, "enable_tmux_monitor" INTEGER NOT NULL DEFAULT 0, "enable_terminal_toolbar" INTEGER NOT NULL DEFAULT 1, "enable_ai_assistant" INTEGER NOT NULL DEFAULT 0, "connection_type" TEXT NOT NULL DEFAULT "ssh", "domain" TEXT, "security" TEXT, "ignore_cert" INTEGER NOT NULL DEFAULT 0, "guacamole_config" TEXT, "socks5_proxy_chain" TEXT, "host_key_fingerprint" TEXT, "host_key_type" TEXT, "host_key_algorithm" TEXT DEFAULT 'sha256', "host_key_first_seen" TEXT, "host_key_last_verified" TEXT, "host_key_changed_count" INTEGER DEFAULT 0, "show_terminal_in_sidebar" INTEGER NOT NULL DEFAULT 1, "show_file_manager_in_sidebar" INTEGER NOT NULL DEFAULT 0, "show_tunnel_in_sidebar" INTEGER NOT NULL DEFAULT 0, "show_docker_in_sidebar" INTEGER NOT NULL DEFAULT 0, "show_server_stats_in_sidebar" INTEGER NOT NULL DEFAULT 0, sudo_password TEXT, share_ssh_auth INTEGER NOT NULL DEFAULT 0, mac_address TEXT, port_knock_sequence TEXT, enable_ssh INTEGER NOT NULL DEFAULT 1, enable_rdp INTEGER NOT NULL DEFAULT 0, enable_vnc INTEGER NOT NULL DEFAULT 0, enable_telnet INTEGER NOT NULL DEFAULT 0, ssh_port INTEGER DEFAULT 22, rdp_port INTEGER DEFAULT 3389, vnc_port INTEGER DEFAULT 5900, telnet_port INTEGER DEFAULT 23, rdp_user TEXT, rdp_password TEXT, rdp_domain TEXT, rdp_security TEXT, rdp_ignore_cert INTEGER DEFAULT 0, vnc_password TEXT, vnc_user TEXT, telnet_user TEXT, telnet_password TEXT, rdp_credential_id INTEGER REFERENCES ssh_credentials(id) ON DELETE SET NULL, vnc_credential_id INTEGER REFERENCES ssh_credentials(id) ON DELETE SET NULL, wol_broadcast_address TEXT, use_warpgate INTEGER NOT NULL DEFAULT 0, telnet_credential_id INTEGER REFERENCES ssh_credentials(id) ON DELETE SET NULL, rdp_auth_type TEXT, vnc_auth_type TEXT, telnet_auth_type TEXT, allow_session_sharing INTEGER NOT NULL DEFAULT 1, connection_origin TEXT, parent_host_id INTEGER REFERENCES ssh_data(id) ON DELETE SET NULL, "sync_id" TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE ssh_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT,
        icon TEXT,
        credential_id INTEGER,
        sort_order INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "sync_id" TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (credential_id) REFERENCES ssh_credentials (id) ON DELETE SET NULL
    );

CREATE TABLE sso_providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        display_order INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE sync_tombstones (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          entity_type TEXT NOT NULL,
          sync_id TEXT NOT NULL,
          deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE termix_identities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL UNIQUE,
          handle TEXT NOT NULL UNIQUE,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

CREATE TABLE termix_identity_ca (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          identity_id INTEGER NOT NULL UNIQUE,
          user_id TEXT NOT NULL,
          public_key TEXT NOT NULL,
          private_key TEXT NOT NULL,
          validity_days INTEGER NOT NULL DEFAULT 90,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (identity_id) REFERENCES termix_identities (id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

CREATE TABLE termix_identity_keys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          identity_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          public_key TEXT NOT NULL,
          key_type TEXT NOT NULL,
          algorithm TEXT NOT NULL,
          label TEXT,
          comment TEXT,
          source TEXT NOT NULL DEFAULT 'manual',
          credential_id INTEGER,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (identity_id) REFERENCES termix_identities (id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          FOREIGN KEY (credential_id) REFERENCES ssh_credentials (id) ON DELETE SET NULL
        );

CREATE TABLE tmux_session_tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          host_id INTEGER NOT NULL,
          session_name TEXT NOT NULL,
          tag TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
        );

CREATE TABLE transfer_recent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        source_host_id INTEGER NOT NULL,
        dest_host_id INTEGER NOT NULL,
        dest_path TEXT NOT NULL,
        dest_path_label TEXT NOT NULL,
        last_used TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (source_host_id) REFERENCES ssh_data (id) ON DELETE CASCADE,
        FOREIGN KEY (dest_host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
    );

CREATE TABLE trusted_devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_fingerprint TEXT NOT NULL,
        device_type TEXT NOT NULL,
        device_info TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE ui_preferences (
        user_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE user_open_tabs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tab_type TEXT NOT NULL,
        host_id INTEGER,
        label TEXT NOT NULL,
        tab_order INTEGER NOT NULL DEFAULT 0,
        backend_session_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
    );

CREATE TABLE user_preferences (
        user_id TEXT PRIMARY KEY,
        reopen_tabs_on_login INTEGER NOT NULL DEFAULT 0,
        theme TEXT,
        font_size TEXT,
        accent_color TEXT,
        language TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "storage_mode" TEXT, "command_autocomplete" INTEGER, "command_palette_enabled" INTEGER, "show_host_tags" INTEGER, "host_tray_on_click" INTEGER, "pin_app_rail" INTEGER, "expand_app_rail_on_hover" INTEGER, "show_pin_app_rail_button" INTEGER, "folders_collapsed" INTEGER, "confirm_snippet_execution" INTEGER, "disable_update_check" INTEGER, "confirm_tab_close" INTEGER, "hidden_rail_tabs" TEXT, "ai_assistant_enabled" INTEGER, "ai_read_only_commands" INTEGER, "compact_host_view" INTEGER, "status_color_scheme" TEXT, "custom_themes" TEXT, "custom_keybindings" TEXT, "terminal_defaults" TEXT, "rdp_defaults" TEXT, "terminal_macros" TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE TABLE user_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        role_id INTEGER NOT NULL,
        granted_by TEXT,
        granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, role_id),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE SET NULL
    );

CREATE TABLE user_workspaces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          color TEXT,
          icon TEXT,
          kind TEXT NOT NULL DEFAULT 'manual',
          is_default INTEGER NOT NULL DEFAULT 0,
          payload TEXT NOT NULL DEFAULT '{}',
          sync_id TEXT UNIQUE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_used_at TEXT
        );

CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_oidc INTEGER NOT NULL DEFAULT 0,
        oidc_identifier TEXT,
        client_id TEXT,
        client_secret TEXT,
        issuer_url TEXT,
        authorization_url TEXT,
        token_url TEXT,
        identifier_path TEXT,
        name_path TEXT,
        scopes TEXT DEFAULT 'openid email profile',
        totp_secret TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        totp_backup_codes TEXT,
        registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        donation_modal_dismissed INTEGER NOT NULL DEFAULT 0
    , "sso_provider_id" INTEGER);

CREATE TABLE vault_profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          folder TEXT,
          tags TEXT,
          vault_addr TEXT NOT NULL,
          vault_namespace TEXT,
          oidc_mount TEXT,
          oidc_role TEXT,
          ssh_mount TEXT,
          ssh_role TEXT NOT NULL,
          valid_principals TEXT,
          key_type TEXT,
          shared INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "sync_id" TEXT,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

CREATE TABLE vault_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          profile_id INTEGER NOT NULL,
          ssh_cert TEXT NOT NULL,
          private_key TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TEXT NOT NULL,
          last_used TEXT,
          UNIQUE(user_id, profile_id),
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          FOREIGN KEY (profile_id) REFERENCES vault_profiles (id) ON DELETE CASCADE
        );

CREATE TABLE webauthn_credentials (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        credential_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        device_type TEXT,
        backed_up INTEGER NOT NULL DEFAULT 0,
        transports TEXT,
        user_verification TEXT NOT NULL DEFAULT 'preferred',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

CREATE INDEX idx_ai_conversations_user ON ai_conversations(user_id, updated_at);

CREATE INDEX idx_ai_messages_conversation ON ai_messages(conversation_id, created_at);

CREATE INDEX idx_ai_proposals_conversation ON ai_proposals(conversation_id);

CREATE INDEX idx_ai_proposals_user ON ai_proposals(user_id, status);

CREATE UNIQUE INDEX idx_ai_providers_user_label ON ai_providers(user_id, label);

CREATE INDEX idx_alert_firings_host ON alert_firings(host_id);

CREATE INDEX idx_alert_firings_rule ON alert_firings(rule_id, fired_at);

CREATE INDEX idx_alert_firings_user_fired
          ON alert_firings (user_id, fired_at DESC);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);

CREATE INDEX idx_audit_logs_action_ts ON audit_logs(action, timestamp);

CREATE INDEX idx_audit_logs_resource_ts ON audit_logs(resource_type, timestamp);

CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);

CREATE INDEX idx_audit_logs_user_ts ON audit_logs(user_id, timestamp);

CREATE UNIQUE INDEX idx_automation_channels_pair ON automation_channels(automation_id, channel_id);

CREATE INDEX idx_automation_run_steps_run ON automation_run_steps(run_id, step_index);

CREATE INDEX idx_automation_runs_automation ON automation_runs(automation_id, started_at);

CREATE INDEX idx_automation_runs_user ON automation_runs(user_id, started_at);

CREATE UNIQUE INDEX idx_automation_schedules_automation ON automation_schedules(automation_id);

CREATE INDEX idx_automation_schedules_due ON automation_schedules(next_due_at);

CREATE UNIQUE INDEX idx_automation_trigger_state_key ON automation_trigger_state(automation_id, state_key);

CREATE INDEX idx_automations_user ON automations(user_id, enabled);

CREATE UNIQUE INDEX idx_collab_rooms_guest_token ON collab_rooms (guest_link_token);

CREATE INDEX idx_command_history_user_host ON command_history(user_id, host_id);

CREATE INDEX idx_credential_access_credential_id ON credential_access (credential_id);

CREATE INDEX idx_credential_access_role_id ON credential_access (role_id);

CREATE INDEX idx_credential_access_user_id ON credential_access (user_id);

CREATE UNIQUE INDEX idx_dashboard_service_links_sync_id ON dashboard_service_links(sync_id);

CREATE INDEX idx_dismissed_alerts_user_id ON dismissed_alerts(user_id);

CREATE INDEX idx_file_manager_pinned_user ON file_manager_pinned(user_id, host_id);

CREATE INDEX idx_file_manager_recent_user ON file_manager_recent(user_id, host_id);

CREATE INDEX idx_file_manager_shortcuts_user ON file_manager_shortcuts(user_id, host_id);

CREATE UNIQUE INDEX idx_fleet_inventory_host ON fleet_inventory(host_id, user_id);

CREATE INDEX idx_fleet_inventory_user ON fleet_inventory(user_id);

CREATE INDEX idx_fleet_members_fleet ON fleet_members(fleet_id);

CREATE UNIQUE INDEX idx_fleet_members_fleet_host ON fleet_members(fleet_id, host_id);

CREATE INDEX idx_fleet_members_host ON fleet_members(host_id);

CREATE INDEX idx_folder_access_owner_folder ON folder_access (owner_user_id, folder);

CREATE UNIQUE INDEX idx_homepage_items_sync_id ON homepage_items(sync_id);

CREATE INDEX idx_homepage_items_user_id ON homepage_items(user_id);

CREATE INDEX idx_host_access_expires_at ON host_access(expires_at);

CREATE INDEX idx_host_access_host_id ON host_access(host_id);

CREATE INDEX idx_host_access_role_id ON host_access(role_id);

CREATE INDEX idx_host_access_user_id ON host_access(user_id);

CREATE UNIQUE INDEX idx_host_health_checks_user_host
        ON host_health_checks (user_id, host_id);

CREATE INDEX idx_host_health_history_lookup
        ON host_health_history (user_id, host_id, check_id, ts);

CREATE INDEX idx_host_metrics_history_host_ts
          ON host_metrics_history (host_id, ts DESC);

CREATE UNIQUE INDEX idx_host_metrics_prefs_user_host
        ON host_metrics_preferences (user_id, host_id);

CREATE INDEX idx_plugins_registry_id ON plugins (registry_id);

CREATE INDEX idx_proxmox_node_history_host_ts
          ON proxmox_node_history (host_id, ts DESC);

CREATE UNIQUE INDEX idx_proxmox_stats_prefs_user_host
        ON proxmox_stats_preferences (user_id, host_id);

CREATE INDEX idx_recent_activity_user_ts ON recent_activity(user_id, timestamp);

CREATE INDEX idx_session_recordings_host ON session_recordings(host_id);

CREATE INDEX idx_session_recordings_user_started ON session_recordings(user_id, started_at);

CREATE INDEX idx_session_shares_host_id ON session_shares(host_id);

CREATE INDEX idx_session_shares_session_id ON session_shares(session_id);

CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);

CREATE INDEX idx_shared_credential_secrets_target ON shared_credential_secrets (target_user_id, credential_id);

CREATE INDEX idx_snippet_access_role_id ON snippet_access(role_id);

CREATE INDEX idx_snippet_access_snippet_id ON snippet_access(snippet_id);

CREATE INDEX idx_snippet_access_user_id ON snippet_access(user_id);

CREATE UNIQUE INDEX idx_snippet_folders_sync_id ON snippet_folders(sync_id);

CREATE UNIQUE INDEX idx_snippets_sync_id ON snippets(sync_id);

CREATE INDEX idx_snippets_user_id ON snippets(user_id);

CREATE INDEX idx_ssh_credential_usage_credential ON ssh_credential_usage(credential_id);

CREATE INDEX idx_ssh_credential_usage_user ON ssh_credential_usage(user_id);

CREATE UNIQUE INDEX idx_ssh_credentials_sync_id ON ssh_credentials(sync_id);

CREATE INDEX idx_ssh_credentials_user_id ON ssh_credentials(user_id);

CREATE INDEX idx_ssh_data_credential ON ssh_data(credential_id);

CREATE INDEX idx_ssh_data_parent_host ON ssh_data(parent_host_id);

CREATE UNIQUE INDEX idx_ssh_data_sync_id ON ssh_data(sync_id);

CREATE INDEX idx_ssh_data_user_id ON ssh_data(user_id);

CREATE UNIQUE INDEX idx_ssh_folders_sync_id ON ssh_folders(sync_id);

CREATE INDEX idx_ssh_folders_user_id ON ssh_folders(user_id);

CREATE INDEX idx_sync_tombstones_user_entity ON sync_tombstones(user_id, entity_type);

CREATE UNIQUE INDEX idx_termix_identities_user ON termix_identities(user_id);

CREATE INDEX idx_termix_identity_keys_identity ON termix_identity_keys(identity_id);

CREATE INDEX idx_transfer_recent_user ON transfer_recent(user_id);

CREATE INDEX idx_trusted_devices_user_id ON trusted_devices(user_id);

CREATE INDEX idx_user_open_tabs_user_id ON user_open_tabs(user_id);

CREATE INDEX idx_user_roles_role_id ON user_roles(role_id);

CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);

CREATE INDEX idx_user_workspaces_user_id ON user_workspaces(user_id);

CREATE UNIQUE INDEX idx_vault_profiles_sync_id ON vault_profiles(sync_id);

CREATE UNIQUE INDEX shared_host_auth_overrides_host_user_protocol_unique
    ON shared_host_auth_overrides (host_id, user_id, protocol);
