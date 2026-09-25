/**
 * The rows in the committed 2.8 fixture (db.sqlite next to this file), as
 * plain data. scripts/build-upgrade-fixture.ts writes them into the real 2.8
 * schema, encrypting the columns 2.8 kept encrypted with each user's data
 * key, and the upgrade test reads them back through 2.9.0's plugins.
 *
 * Every value a test looks for carries "d4" so it is easy to find.
 */

export type Row = Record<string, unknown>;

/** Every password user signs in with this. */
export const FIXTURE_PASSWORD = "d4-upgrade-password";

/** The TOTP user's secret (base32) and 2.8 backup codes. */
export const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
export const TOTP_BACKUP_CODES = ["D4BACKUP1", "D4BACKUP2", "D4BACKUP3"];

export const USERS = {
  admin: "d4-user-admin",
  alice: "d4-user-alice",
  totp: "d4-user-totp",
  passkey: "d4-user-passkey",
  sso: "d4-user-sso",
  ldap: "d4-user-ldap",
} as const;

export const HOSTS = {
  password: 1,
  key: 2,
  credential: 3,
  none: 4,
  agent: 5,
  opkssh: 6,
  stepca: 7,
  tailscale: 8,
  vault: 9,
  warpgate: 10,
  rdpOnly: 11,
  plain: 12,
  desktop: 13,
} as const;

/** The 2.8 auth_type each host was saved with. */
export const HOST_AUTH_TYPES: Record<number, string> = {
  [HOSTS.password]: "password",
  [HOSTS.key]: "key",
  [HOSTS.credential]: "credential",
  [HOSTS.none]: "none",
  [HOSTS.agent]: "agent",
  [HOSTS.opkssh]: "opkssh",
  [HOSTS.stepca]: "stepca",
  [HOSTS.tailscale]: "tailscale",
  [HOSTS.vault]: "vault",
  [HOSTS.warpgate]: "warpgate",
  [HOSTS.rdpOnly]: "password",
  [HOSTS.plain]: "password",
  [HOSTS.desktop]: "password",
};

/**
 * 2.8 stored recording paths absolute. The fixture writes this token instead,
 * and the harness swaps in the DATA_DIR it boots from, where it also copies
 * the files under upgrade/files.
 */
export const DATA_DIR_TOKEN = "{{DATA_DIR}}";
export const RECORDING_FILES = {
  ssh: "session_logs/d4-user-admin/d4-session.cast",
  rdp: "session_recordings/guacamole/d4-rdp.guac",
};

export const SSO_PROVIDER_ID = 1;
export const LDAP_PROVIDER_ID = 2;
/** 2.8's seeded user role, which the upgrade must leave as it was. */
export const USER_ROLE_PERMISSIONS_28 = [
  "hosts.*",
  "snippets.*",
  "automations.*",
  "credentials.*",
  "ai.*",
];
export const OPERATORS_ROLE_ID = 10;
export const OPERATORS_PERMISSIONS = [
  "hosts.view",
  "credentials.view",
  "snippets.*",
  "automations.run",
  "ai.use",
];

/** 2.8's electron/remote-sync-entities.cjs SYNCED_ENTITY_TYPES. */
export const SYNCED_ENTITY_TYPES_28 = [
  "sshCredentials",
  "vaultProfiles",
  "sshFolders",
  "snippetFolders",
  "hosts",
  "snippets",
  "dashboardServiceLinks",
  "homepageItems",
  "userPreferences",
];

const T = "2026-05-01T10:00:00.000Z";
const LATER = "2099-01-01T00:00:00.000Z";

/**
 * Columns 2.8 stored encrypted with the owning user's data key, as
 * [table, column, field name, column holding the user id]. The record id is
 * the row id, except on users where it is the user id.
 */
export const ENCRYPTED_COLUMNS: Array<[string, string, string, string]> = [
  ["users", "totp_secret", "totpSecret", "id"],
  ["users", "totp_backup_codes", "totpBackupCodes", "id"],
  ["ssh_data", "password", "password", "user_id"],
  ["ssh_data", "key", "key", "user_id"],
  ["ssh_data", "key_password", "keyPassword", "user_id"],
  ["ssh_data", "sudo_password", "sudoPassword", "user_id"],
  ["ssh_data", "rdp_password", "rdpPassword", "user_id"],
  ["ssh_credentials", "password", "password", "user_id"],
  ["ssh_credentials", "private_key", "privateKey", "user_id"],
  ["ssh_credentials", "key", "key", "user_id"],
  ["ssh_credentials", "public_key", "publicKey", "user_id"],
  ["notification_channels", "config", "config", "user_id"],
  ["opkssh_tokens", "ssh_cert", "sshCert", "user_id"],
  ["opkssh_tokens", "private_key", "privateKey", "user_id"],
  ["vault_tokens", "ssh_cert", "sshCert", "user_id"],
  ["vault_tokens", "private_key", "privateKey", "user_id"],
  ["termix_identity_ca", "private_key", "privateKey", "user_id"],
  ["ai_providers", "api_key", "apiKey", "user_id"],
  ["secret_sources", "token", "token", "user_id"],
];

const PUBLIC_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGd4ZDRkNGQ0ZDRkNGQ0ZDRkNGQ0ZDRkNGQ0ZDRkNGQ0 d4";
const PRIVATE_KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nd4-private-key\n-----END OPENSSH PRIVATE KEY-----";

function host(id: number, name: string, extra: Row = {}): Row {
  return {
    id,
    user_id: USERS.admin,
    name,
    ip: `10.4.0.${id}`,
    port: 22,
    username: "root",
    folder: "d4-folder",
    tags: JSON.stringify(["d4"]),
    auth_type: HOST_AUTH_TYPES[id],
    sync_id: `d4-sync-host-${id}`,
    created_at: T,
    updated_at: T,
    ...extra,
  };
}

const HOST_ROWS: Row[] = [
  // Every plugin switch changed away from its 2.8 default.
  host(HOSTS.password, "d4-password", {
    password: "d4-host-password",
    sudo_password: "d4-sudo",
    enable_terminal: 1,
    enable_command_history: 0,
    enable_terminal_toolbar: 0,
    enable_session_logging: 0,
    allow_session_sharing: 0,
    enable_file_manager: 0,
    default_path: "/srv/d4",
    scp_legacy: 1,
    enable_tunnel: 1,
    tunnel_connections: JSON.stringify([
      {
        sourcePort: 8080,
        endpointPort: 80,
        endpointHost: "d4-key",
        autoStart: false,
      },
    ]),
    enable_web_ui: 1,
    web_ui_config: JSON.stringify({
      endpoints: [
        { id: "grafana", label: "d4-grafana", port: 3000, protocol: "http" },
      ],
    }),
    enable_tmux_monitor: 1,
    enable_docker: 1,
    docker_config: JSON.stringify({ runtime: "podman" }),
    enable_ai_assistant: 1,
    mac_address: "AA:BB:CC:DD:EE:04",
    wol_broadcast_address: "10.4.0.255",
    stats_config: JSON.stringify({
      statusCheckEnabled: false,
      statusCheckInterval: 90,
      metricsEnabled: false,
      useGlobalMetricsInterval: false,
      metricsInterval: 45,
      enabledWidgets: ["cpu", "memory"],
    }),
  }),
  host(HOSTS.key, "d4-key", {
    key: PRIVATE_KEY,
    key_password: "d4-key-pass",
    key_type: "ssh-ed25519",
    enable_proxmox: 1,
    proxmox_config: JSON.stringify({
      apiUrl: "https://pve.d4.example:8006",
      tokenId: "root@pam!d4",
    }),
    enable_proxmox_stats: 1,
    proxmox_stats_config: JSON.stringify({ node: "d4-node" }),
  }),
  host(HOSTS.credential, "d4-credential", { credential_id: 1 }),
  host(HOSTS.none, "d4-none"),
  host(HOSTS.agent, "d4-agent"),
  host(HOSTS.opkssh, "d4-opkssh"),
  host(HOSTS.stepca, "d4-stepca"),
  host(HOSTS.tailscale, "d4-tailscale"),
  host(HOSTS.vault, "d4-vault", { vault_profile_id: 1 }),
  host(HOSTS.warpgate, "d4-warpgate"),
  // A host from before the per-protocol switches: connection_type alone made
  // it an RDP host with SSH off.
  host(HOSTS.rdpOnly, "d4-rdp", {
    connection_type: "rdp",
    rdp_user: "d4-rdp-user",
    rdp_password: "d4-rdp-password",
  }),
  host(HOSTS.desktop, "d4-desktop", {
    enable_rdp: 1,
    enable_vnc: 1,
    enable_telnet: 1,
    rdp_port: 3390,
    vnc_port: 5901,
    telnet_port: 2323,
    rdp_user: "d4-rdp-user",
    rdp_password: "d4-rdp-password",
    rdp_security: "nla",
    rdp_ignore_cert: 1,
    guacamole_config: JSON.stringify({ colorDepth: 24 }),
  }),
  // Touches nothing, so it has to keep reading 2.8's defaults.
  host(HOSTS.plain, "d4-plain"),
];

export const ROWS: Record<string, Row[]> = {
  users: [
    { id: USERS.admin, username: "d4-admin", is_admin: 1 },
    { id: USERS.alice, username: "d4-alice" },
    {
      id: USERS.totp,
      username: "d4-totp",
      totp_enabled: 1,
      totp_secret: TOTP_SECRET,
      totp_backup_codes: JSON.stringify(TOTP_BACKUP_CODES),
    },
    { id: USERS.passkey, username: "d4-passkey" },
    {
      id: USERS.sso,
      username: "d4-sso",
      password_hash: "",
      is_oidc: 1,
      oidc_identifier: "d4-oidc-subject",
      sso_provider_id: SSO_PROVIDER_ID,
    },
    {
      id: USERS.ldap,
      username: "d4-ldap",
      password_hash: "",
      is_oidc: 1,
      oidc_identifier: `ldap:${LDAP_PROVIDER_ID}:d4-ldap-dn`,
      sso_provider_id: LDAP_PROVIDER_ID,
    },
  ].map((user) => ({ registered_at: T, ...user })),

  roles: [
    {
      id: 1,
      name: "admin",
      display_name: "rbac.roles.admin",
      description: "Administrator with full access",
      is_system: 1,
      permissions: JSON.stringify(["*"]),
    },
    {
      id: 2,
      name: "user",
      display_name: "rbac.roles.user",
      description: "Regular user",
      is_system: 1,
      permissions: JSON.stringify(USER_ROLE_PERMISSIONS_28),
    },
    {
      id: OPERATORS_ROLE_ID,
      name: "d4-operators",
      display_name: "D4 operators",
      is_system: 0,
      permissions: JSON.stringify(OPERATORS_PERMISSIONS),
    },
  ],
  user_roles: [
    { user_id: USERS.admin, role_id: 1 },
    ...[USERS.alice, USERS.totp, USERS.passkey, USERS.sso, USERS.ldap].map(
      (userId) => ({ user_id: userId, role_id: 2 }),
    ),
    {
      user_id: USERS.alice,
      role_id: OPERATORS_ROLE_ID,
      granted_by: USERS.admin,
    },
  ],

  ssh_credentials: [
    {
      id: 1,
      user_id: USERS.admin,
      name: "d4-credential",
      auth_type: "key",
      username: "deploy",
      private_key: PRIVATE_KEY,
      public_key: PUBLIC_KEY,
      key_type: "ssh-ed25519",
      sync_id: "d4-sync-credential",
    },
  ],
  ssh_folders: [
    {
      id: 1,
      user_id: USERS.admin,
      name: "d4-folder",
      sync_id: "d4-sync-folder",
    },
  ],
  vault_profiles: [
    {
      id: 1,
      user_id: USERS.admin,
      name: "d4-vault",
      vault_addr: "https://vault.d4.example",
      ssh_mount: "ssh",
      ssh_role: "admin",
      shared: 0,
      sync_id: "d4-sync-vault",
    },
  ],
  ssh_data: HOST_ROWS,
  host_access: [
    {
      id: 1,
      host_id: HOSTS.password,
      user_id: USERS.alice,
      granted_by: USERS.admin,
      permission_level: "connect",
    },
  ],
  user_preferences: [
    {
      user_id: USERS.admin,
      theme: "dark",
      ai_assistant_enabled: 1,
      ai_read_only_commands: 1,
      rdp_defaults: JSON.stringify({
        colorDepth: 16,
        resizeMethod: "reconnect",
        enableDrive: true,
      }),
    },
  ],
  sso_providers: [
    {
      id: SSO_PROVIDER_ID,
      name: "d4-sso",
      type: "oidc",
      enabled: 1,
      display_order: 0,
      config: JSON.stringify({
        issuerUrl: "https://id.d4.example",
        clientId: "termix",
        clientSecret: "d4-client-secret",
      }),
    },
    {
      id: LDAP_PROVIDER_ID,
      name: "d4-ldap",
      type: "ldap",
      enabled: 1,
      display_order: 1,
      config: JSON.stringify({
        url: "ldaps://ldap.d4.example",
        bindDn: "cn=termix,dc=d4",
        bindPassword: "d4-bind",
        searchBase: "dc=d4",
      }),
    },
  ],
  webauthn_credentials: [
    {
      id: "d4-passkey-id",
      user_id: USERS.passkey,
      name: "d4-passkey",
      credential_id: "ZDQtY3JlZGVudGlhbA",
      public_key: "ZDQtcHVibGljLWtleQ",
      counter: 3,
      transports: JSON.stringify(["internal"]),
    },
  ],
  notification_channels: [
    {
      id: 1,
      user_id: USERS.admin,
      name: "d4-channel",
      type: "ntfy",
      config: JSON.stringify({ url: "https://ntfy.d4.example/d4" }),
      enabled: 1,
    },
  ],
  dismissed_alerts: [
    {
      id: 1,
      user_id: USERS.admin,
      alert_id: "d4-dismissed-announcement",
      dismissed_at: T,
    },
  ],

  snippet_folders: [
    {
      id: 1,
      user_id: USERS.admin,
      name: "d4-snippet-folder",
      sync_id: "d4-sync-snippet-folder",
    },
  ],
  snippets: [
    {
      id: 1,
      user_id: USERS.admin,
      name: "d4-snippet",
      content: "uptime",
      folder: "d4-snippet-folder",
      sync_id: "d4-sync-snippet",
    },
    {
      id: 2,
      user_id: USERS.admin,
      name: "d4-shared-snippet",
      content: "df -h",
      sync_id: "d4-sync-snippet-shared",
    },
  ],
  snippet_access: [
    {
      id: 1,
      snippet_id: 2,
      user_id: USERS.alice,
      granted_by: USERS.admin,
      permission_level: "view",
    },
  ],

  fleets: [{ id: 1, user_id: USERS.admin, name: "d4-fleet" }],
  fleet_members: [
    { id: 1, fleet_id: 1, host_id: HOSTS.password },
    { id: 2, fleet_id: 1, host_id: HOSTS.key },
  ],
  fleet_inventory: [
    {
      id: 1,
      host_id: HOSTS.password,
      user_id: USERS.admin,
      os_pretty_name: "d4 Linux",
      hostname: "d4-password",
    },
  ],

  automations: [
    {
      id: 1,
      user_id: USERS.admin,
      name: "d4-automation",
      enabled: 0,
      definition: JSON.stringify({
        version: 1,
        trigger: { type: "manual" },
        steps: [],
      }),
    },
  ],
  automation_trigger_state: [
    { id: 1, automation_id: 1, state_key: "d4-state", last_value: 1 },
  ],
  automation_schedules: [
    { id: 1, automation_id: 1, cron: "0 4 * * *", timezone: "UTC" },
  ],
  automation_runs: [
    {
      id: 1,
      automation_id: 1,
      user_id: USERS.admin,
      trigger_type: "manual",
      status: "success",
      started_at: T,
      finished_at: T,
    },
  ],
  automation_run_steps: [
    {
      id: 1,
      run_id: 1,
      step_index: 0,
      step_id: "d4-step",
      step_type: "command",
      status: "success",
      output: "d4-output",
    },
  ],
  automation_channels: [{ id: 1, automation_id: 1, channel_id: 1 }],

  user_workspaces: [
    {
      id: 1,
      user_id: USERS.admin,
      name: "d4-workspace",
      payload: JSON.stringify({}),
      sync_id: "d4-sync-workspace",
    },
  ],
  network_topology: [
    {
      id: 1,
      user_id: USERS.admin,
      topology: JSON.stringify({ nodes: [{ id: "d4-node" }], edges: [] }),
    },
  ],

  homepage_items: [
    {
      id: 1,
      user_id: USERS.admin,
      type_id: "clock",
      title: "d4-widget",
      config: JSON.stringify({}),
      sync_id: "d4-sync-homepage-item",
    },
  ],
  homepage_layouts: [
    {
      id: 1,
      user_id: USERS.admin,
      layout: JSON.stringify([{ i: "1", x: 0, y: 0, w: 2, h: 2 }]),
    },
  ],
  dashboard_service_links: [
    {
      id: 1,
      user_id: USERS.admin,
      label: "d4-link",
      url: "https://d4.example",
      sync_id: "d4-sync-service-link",
    },
  ],

  vault_tokens: [
    {
      id: 1,
      user_id: USERS.admin,
      profile_id: 1,
      ssh_cert: "d4-vault-cert",
      private_key: PRIVATE_KEY,
      expires_at: LATER,
    },
  ],
  opkssh_tokens: [
    {
      id: 1,
      user_id: USERS.admin,
      host_id: HOSTS.opkssh,
      ssh_cert: "d4-opkssh-cert",
      private_key: PRIVATE_KEY,
      email: "d4@example.com",
      expires_at: LATER,
    },
  ],

  session_recordings: [
    {
      id: 1,
      host_id: HOSTS.password,
      user_id: USERS.admin,
      username: "d4-admin",
      started_at: T,
      ended_at: T,
      duration: 12,
      recording_path: `${DATA_DIR_TOKEN}/${RECORDING_FILES.ssh}`,
      protocol: "ssh",
      format: "asciicast",
    },
    {
      id: 2,
      host_id: HOSTS.desktop,
      user_id: USERS.admin,
      username: "d4-admin",
      started_at: T,
      ended_at: T,
      duration: 30,
      recording_path: `${DATA_DIR_TOKEN}/${RECORDING_FILES.rdp}`,
      protocol: "rdp",
      format: "guacamole",
    },
  ],
  command_history: [
    {
      id: 1,
      user_id: USERS.admin,
      host_id: HOSTS.password,
      command: "d4-history-command",
      executed_at: T,
    },
  ],
  c2s_tunnel_presets: [
    {
      id: 1,
      user_id: USERS.admin,
      name: "d4-preset",
      config: JSON.stringify({ tunnels: [] }),
    },
  ],

  ai_providers: [
    {
      id: 1,
      user_id: USERS.admin,
      provider_type: "openai",
      label: "d4-provider",
      api_key: "sk-d4-provider-key",
      api_key_prefix: "sk-d4",
      default_model: "gpt-d4",
      enabled: 1,
    },
  ],
  ai_conversations: [
    { id: 1, user_id: USERS.admin, title: "d4-conversation", provider_id: 1 },
  ],
  ai_messages: [
    { id: 1, conversation_id: 1, role: "user", content: "d4-message" },
  ],
  ai_proposals: [
    {
      id: 1,
      conversation_id: 1,
      user_id: USERS.admin,
      kind: "run_command",
      summary: "d4-proposal",
      payload: JSON.stringify({ command: "uptime" }),
    },
  ],

  secret_sources: [
    {
      id: "d4-source",
      user_id: USERS.admin,
      name: "d4-source",
      kind: "vaultwarden",
      base_url: "https://vw.d4.example",
      token: "d4-source-token",
    },
  ],

  termix_identities: [{ id: 1, user_id: USERS.admin, handle: "d4-handle" }],
  termix_identity_keys: [
    {
      id: 1,
      identity_id: 1,
      user_id: USERS.admin,
      public_key: PUBLIC_KEY,
      key_type: "ssh-ed25519",
      algorithm: "ed25519",
      label: "d4-identity-key",
    },
  ],
  termix_identity_ca: [
    {
      id: 1,
      identity_id: 1,
      user_id: USERS.admin,
      public_key: PUBLIC_KEY,
      private_key: PRIVATE_KEY,
    },
  ],

  host_metrics_preferences: [
    {
      id: 1,
      user_id: USERS.admin,
      host_id: HOSTS.password,
      layout: JSON.stringify({ d4: true }),
    },
  ],
  host_health_checks: [
    {
      id: 1,
      user_id: USERS.admin,
      host_id: HOSTS.password,
      checks: JSON.stringify([{ id: "d4-check", type: "tcp", port: 22 }]),
    },
  ],
  host_health_history: [
    {
      id: 1,
      user_id: USERS.admin,
      host_id: HOSTS.password,
      check_id: "d4-check",
      ts: T,
      ok: 1,
      latency_ms: 4,
    },
  ],
  host_metrics_history: [
    { id: 1, host_id: HOSTS.password, ts: T, cpu_percent: 44 },
  ],
  proxmox_stats_preferences: [
    {
      id: 1,
      user_id: USERS.admin,
      host_id: HOSTS.key,
      layout: JSON.stringify({ d4: true }),
    },
  ],
  proxmox_node_history: [{ id: 1, host_id: HOSTS.key, ts: T, cpu_percent: 4 }],

  session_shares: [
    {
      id: "d4-share",
      host_id: HOSTS.password,
      owner_user_id: USERS.admin,
      protocol: "ssh",
      session_id: "d4-session",
      share_type: "user",
      target_user_id: USERS.alice,
      permission_level: "read",
      expires_at: LATER,
    },
  ],
  session_share_participants: [
    { id: 1, share_id: "d4-share", user_id: USERS.alice, joined_at: T },
  ],
  collab_rooms: [
    {
      id: "d4-room",
      name: "d4-room",
      owner_user_id: USERS.admin,
      persistent: 1,
    },
  ],
  collab_room_members: [
    { id: 1, room_id: "d4-room", user_id: USERS.admin, room_role: "owner" },
    { id: 2, room_id: "d4-room", user_id: USERS.alice, added_by: USERS.admin },
  ],

  file_manager_recent: [
    {
      id: 1,
      user_id: USERS.admin,
      host_id: HOSTS.password,
      name: "d4-recent",
      path: "/srv/d4/recent",
    },
  ],
  file_manager_pinned: [
    {
      id: 1,
      user_id: USERS.admin,
      host_id: HOSTS.password,
      name: "d4-pinned",
      path: "/srv/d4/pinned",
    },
  ],
  file_manager_shortcuts: [
    {
      id: 1,
      user_id: USERS.admin,
      host_id: HOSTS.password,
      name: "d4-shortcut",
      path: "/srv/d4/shortcut",
    },
  ],
  transfer_recent: [
    {
      id: 1,
      user_id: USERS.admin,
      source_host_id: HOSTS.password,
      dest_host_id: HOSTS.key,
      dest_path: "/srv/d4/transfer",
      dest_path_label: "d4-transfer",
    },
  ],
  tmux_session_tags: [
    {
      id: 1,
      user_id: USERS.admin,
      host_id: HOSTS.password,
      session_name: "d4-tmux",
      tag: "d4-tag",
    },
  ],

  settings: [
    ["tailscale_api_key", "tskey-d4"],
    ["tailscale_api_base_url", "https://headscale.d4.example"],
    ["guac_enabled", "true"],
    ["guac_url", "guacd.d4.example:4822"],
    ["global_metrics_interval", "40"],
    ["metrics_history_retention_days", "14"],
    [
      "host_defaults",
      JSON.stringify({ metricsEnabled: false, enableCommandHistory: false }),
    ],
    ["ai_globally_enabled", "true"],
    ["ai_private_endpoint_allowlist", JSON.stringify(["10.4.0.0/24"])],
    [
      "acme_ssl_settings",
      JSON.stringify({
        enabled: true,
        domain: "termix.d4.example",
        email: "d4@example.com",
        challengeType: "cloudflare",
        cloudflareToken: "d4-cloudflare-token",
      }),
    ],
    ["step_ca_url", "https://ca.d4.example"],
    ["step_ca_fingerprint", "d4fingerprint"],
    ["step_ca_provisioner", "d4-provisioner"],
    ["terminal_session_timeout_minutes", "45"],
    ["terminal_session_persistence_enabled", "false"],
    ["terminal_image_max_count", "7"],
    ["session_sharing_globally_enabled", "false"],
    // Long enough that the fixture's recordings never age out.
    ["session_recording_retention_days", "3650"],
  ].map(([key, value]) => ({ key, value })),
};

/** The 2.8 core tables the fixture fills that stay core in 2.9.0. */
export const CORE_TABLES = new Set([
  "users",
  "roles",
  "user_roles",
  "ssh_credentials",
  "ssh_folders",
  "ssh_data",
  "host_access",
  "user_preferences",
  "settings",
]);
