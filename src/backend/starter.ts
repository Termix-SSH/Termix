import { getErrorMessage } from "./utils/error-message.js";
import dotenv from "dotenv";
import { promises as fs, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AutoSSLSetup } from "./utils/auto-ssl-setup.js";
import { AuthManager } from "./utils/auth-manager.js";
import { DataCrypto } from "./utils/data-crypto.js";
import { ensureDatabaseLayerPreupgradeBackup } from "./utils/database-layer-preupgrade-backup.js";
import { DatabaseSaveTrigger } from "./utils/database-save-trigger.js";
import { SystemCrypto } from "./utils/system-crypto.js";
import {
  systemLogger,
  versionLogger,
  setGlobalLogLevel,
} from "./utils/logger.js";
import { getTrustedProxyAuthConfig } from "./utils/trusted-proxy-auth.js";

/**
 * host:port from DATABASE_URL for the startup log. Parsed rather than printed
 * so the password the URL also carries never reaches the logs.
 */
function describeDatabaseHost(): string {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return "unknown";

  try {
    const { host } = new URL(raw);
    return host || "unknown";
  } catch {
    return "unknown";
  }
}

async function provisionLocalDesktopUserIfNeeded(): Promise<void> {
  const { createCurrentUserRepository, createCurrentRoleRepository } =
    await import("./database/repositories/factory.js");
  const { AuthManager } = await import("./utils/auth-manager.js");
  const crypto = await import("crypto");

  const userRepository = createCurrentUserRepository();
  const existingCount = await userRepository.countAll();
  if (existingCount > 0) {
    const allUsers = await userRepository.listAll();
    for (const user of allUsers) {
      try {
        await AuthManager.getInstance().registerUser(user.id);
      } catch (dekError) {
        systemLogger.error(
          "Failed to verify/provision data-encryption key for existing user",
          dekError,
          { operation: "desktop_dek_healing", userId: user.id },
        );
      }
    }
    return;
  }

  const id = crypto.randomUUID();
  const { isFirstUser } = await userRepository.createFirstLocalUser({
    id,
    username: "local",
    passwordHash: "",
    isOidc: false,
    clientId: "",
    clientSecret: "",
    issuerUrl: "",
    authorizationUrl: "",
    tokenUrl: "",
    identifierPath: "",
    namePath: "",
    scopes: "openid email profile",
    totpSecret: null,
    totpEnabled: false,
    totpBackupCodes: null,
  });

  try {
    await createCurrentRoleRepository().assignRoleNameToUser({
      userId: id,
      roleName: isFirstUser ? "admin" : "user",
      grantedBy: id,
    });
  } catch (roleError) {
    systemLogger.error(
      "Failed to assign default role to auto-provisioned local user",
      roleError,
      { operation: "desktop_auto_provision_role" },
    );
  }

  await AuthManager.getInstance().registerUser(
    id,
    crypto.randomBytes(32).toString("hex"),
  );

  systemLogger.success("Auto-provisioned local desktop user", {
    operation: "desktop_auto_provision",
    userId: id,
  });
}

(async () => {
  const initStartTime = Date.now();
  try {
    dotenv.config({ quiet: true });

    const dataDir = process.env.DATA_DIR || "./db/data";
    const envPath = path.join(dataDir, ".env");
    try {
      await fs.access(envPath);
      const persistentConfig = dotenv.config({ path: envPath, quiet: true });
      if (persistentConfig.parsed) {
        Object.assign(process.env, persistentConfig.parsed);
      }
    } catch {
      // expected - env file may not exist
    }

    systemLogger.info("Termix backend initialization started", {
      operation: "backend_init_start",
      nodeEnv: process.env.NODE_ENV || "production",
      port: process.env.PORT || 4090,
    });

    let version = process.env.VERSION || "unknown";
    if (version === "unknown") {
      const candidates = [
        path.join(process.cwd(), "package.json"),
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../../package.json",
        ),
      ];
      for (const packageJsonPath of candidates) {
        try {
          const packageJson = JSON.parse(
            readFileSync(packageJsonPath, "utf-8"),
          );
          if (packageJson.version) {
            version = packageJson.version;
            break;
          }
        } catch {
          // try the next location
        }
      }
    }
    process.env.VERSION = version;

    versionLogger.info(`Termix Backend starting - Version: ${version}`, {
      operation: "startup",
      version: version,
    });

    const trustedProxyAuth = getTrustedProxyAuthConfig();

    const systemCrypto = SystemCrypto.getInstance();
    await systemCrypto.initializeJWTSecret();
    await systemCrypto.initializeDatabaseKey();
    await systemCrypto.initializeEncryptionKey();
    await systemCrypto.initializeInternalAuthToken();

    const { needsExplicitPersist, resolveDatabaseDialect } =
      await import("./database/db/dialect.js");
    const databaseDialect = resolveDatabaseDialect();

    // The pre-upgrade backup copies the SQLite file, so there is nothing for it
    // to do on a client-server engine. Say so rather than no-op silently:
    // backups are the operator's own responsibility there.
    if (needsExplicitPersist(databaseDialect)) {
      ensureDatabaseLayerPreupgradeBackup({ dataDir, version });
    } else {
      systemLogger.info(
        `Skipping pre-upgrade backup on ${databaseDialect} - back up the database yourself`,
        {
          operation: "backend_init_db_backup_skipped",
          dialect: databaseDialect,
        },
      );
    }

    await AutoSSLSetup.initialize();
    systemLogger.success("SSL setup completed", {
      operation: "backend_init_ssl",
      sslEnabled: process.env.ENABLE_SSL === "true",
    });

    const dbModule = await import("./database/db/index.js");
    await dbModule.initializeDatabase();
    // Naming the engine makes a misconfiguration obvious: without it, a bad
    // DATABASE_DIALECT silently falls back to SQLite and looks like data loss.
    systemLogger.success(`Database initialized (${databaseDialect})`, {
      operation: "backend_init_db",
      dialect: databaseDialect,
      // Host only, never the credentials the URL also carries.
      ...(needsExplicitPersist(databaseDialect)
        ? {}
        : { host: describeDatabaseHost() }),
    });

    if (trustedProxyAuth.enabled) {
      const {
        createCurrentSettingsRepository,
        createCurrentSsoProviderRepository,
        createCurrentUserRepository,
      } = await import("./database/repositories/factory.js");
      const [legacyOidc, providers, users] = await Promise.all([
        createCurrentSettingsRepository().get("oidc_config"),
        createCurrentSsoProviderRepository().listEnabled(),
        createCurrentUserRepository().listAll(),
      ]);
      const conflictingProvider = providers.some((provider) =>
        ["oidc", "github", "google"].includes(provider.type),
      );
      const conflictingUser = users.some(
        (user) => user.isOidc || user.totpEnabled,
      );
      if (
        legacyOidc ||
        process.env.OIDC_CLIENT_ID ||
        conflictingProvider ||
        conflictingUser
      ) {
        throw new Error(
          "Trusted proxy authentication cannot start while OIDC or TOTP is enabled",
        );
      }
      systemLogger.info("Trusted proxy authentication enabled", {
        operation: "trusted_proxy_auth_enabled",
        usernameHeader: trustedProxyAuth.usernameHeader,
        roleHeader: trustedProxyAuth.roleHeader,
        trustedProxyCount: trustedProxyAuth.trustedProxies.length,
      });
    }

    const { UserKeyManager } = await import("./utils/user-keys.js");
    await UserKeyManager.getInstance().initialize();

    const { runBootDekMigration } =
      await import("./utils/crypto-migration/dek-migration.js");
    await runBootDekMigration({ cleanupLegacy: true });

    const { runLegacySharedCredentialCleanup } =
      await import("./utils/crypto-migration/legacy-share-cleanup.js");
    await runLegacySharedCredentialCleanup();

    const authManager = AuthManager.getInstance();
    await authManager.initialize();
    DataCrypto.initialize();

    const { runLegacySharedSshAuthOptInMigration } =
      await import("./utils/crypto-migration/legacy-shared-ssh-auth-opt-in-migration.js");
    await runLegacySharedSshAuthOptInMigration();

    const { runSharedHostSecretsMigration } =
      await import("./utils/crypto-migration/shared-host-secrets-migration.js");
    await runSharedHostSecretsMigration();

    const { runPrivateSharedSshAuthMigration } =
      await import("./utils/crypto-migration/private-shared-ssh-auth-migration.js");
    await runPrivateSharedSshAuthMigration();

    const { runChannelConfigEncryptionMigration } =
      await import("./utils/crypto-migration/channel-config-encryption.js");
    await runChannelConfigEncryptionMigration();

    const { runExternalIdentityMigration } =
      await import("./utils/crypto-migration/external-identity-migration.js");
    await runExternalIdentityMigration();

    const { runHostStatusConfigMigration } =
      await import("./utils/crypto-migration/host-status-config-migration.js");
    await runHostStatusConfigMigration();

    const { hostStatusService } =
      await import("./hosts/status/host-status-service.js");
    hostStatusService.start();

    if (process.env.ELECTRON_EMBEDDED === "true") {
      await provisionLocalDesktopUserIfNeeded();
    }

    import("./utils/opkssh-binary-manager.js").then(
      ({ OPKSSHBinaryManager }) => {
        OPKSSHBinaryManager.ensureBinary().catch((error) => {
          const dataDir =
            process.env.DATA_DIR || path.join(process.cwd(), "db", "data");
          systemLogger.warn(
            "Failed to initialize OPKSSH binary - OPKSSH authentication will not be available",
            {
              operation: "opkssh_binary_init_failed",
              error: getErrorMessage(error),
              stack: error instanceof Error ? error.stack : undefined,
              platform: process.platform,
              arch: process.arch,
              dataDir,
            },
          );
        });
      },
    );

    const { serverReady } = await import("./database/database.js");
    await serverReady;

    // Before any role is edited: a role may hold a plugin permission whose
    // plugin is disabled or gone, and PUT /rbac/roles/:id has to keep
    // accepting it.
    const { primeKnownPermissions } =
      await import("./utils/known-permissions.js");
    await primeKnownPermissions();
    // Terminal, docker, host-metrics, file-manager and tmux monitoring are
    // deliberately absent: the ssh-terminal, docker, host-metrics,
    // file-manager and tmux-monitor plugins start their own servers, so
    // disabling any of them stops its WS/HTTP server. See
    // plugins/ssh-terminal, plugins/docker, plugins/host-metrics,
    // plugins/file-manager and plugins/tmux-monitor.
    // Every other plugin (AI, Proxmox, Remote Desktop, Fleets, Automations,
    // Network Topology, Workspaces, Web Endpoint, Tunnels, Serial, Homepage)
    // is absent for the same reason: each one serves its routes under
    // /plugin-api/<id>/ (or a WS route under /plugin-ws/<id>/) through ctx on
    // activate, so disabling it answers 503 instead of leaving a dead import
    // here. The dashboard's own uptime and recent-activity routes are core
    // and are mounted on the main server in database.ts.
    // Automations' scheduler and tunnel autostart also start from their own
    // activate() rather than here.

    // Initialize log level from database settings
    const { getCurrentSettingValue } =
      await import("./database/repositories/factory.js");
    const logLevel = getCurrentSettingValue("log_level");
    if (logLevel) {
      setGlobalLogLevel(logLevel);
      systemLogger.info(`Log level set to: ${logLevel}`, {
        operation: "log_level_init",
      });
    }

    // Last, so a plugin's activate() sees a fully wired server. A plugin that
    // fails to load must not stop the backend, so this never rejects.
    try {
      const { initializePlugins } = await import("./plugins/index.js");
      const loaded = await initializePlugins();
      if (loaded.length > 0) {
        systemLogger.info(`Loaded ${loaded.length} plugin(s)`, {
          operation: "plugin_init",
        });
      }

      // After seeding: plugin_settings has a foreign key to plugins, so there
      // is nothing to migrate into until the plugin row exists.
      const { runTailscaleSettingsMigration } =
        await import("./utils/crypto-migration/tailscale-settings-migration.js");
      await runTailscaleSettingsMigration();

      const { runProxmoxSettingsMigration } =
        await import("./utils/crypto-migration/proxmox-settings-migration.js");
      await runProxmoxSettingsMigration();

      const { runFileManagerSettingsMigration } =
        await import("./utils/crypto-migration/file-manager-settings-migration.js");
      await runFileManagerSettingsMigration();

      const { runTunnelsSettingsMigration } =
        await import("./utils/crypto-migration/tunnels-settings-migration.js");
      await runTunnelsSettingsMigration();

      const { runWebEndpointSettingsMigration } =
        await import("./utils/crypto-migration/web-endpoint-settings-migration.js");
      await runWebEndpointSettingsMigration();

      const { runSshTerminalSettingsMigration } =
        await import("./utils/crypto-migration/ssh-terminal-settings-migration.js");
      await runSshTerminalSettingsMigration();

      const { runTmuxMonitorSettingsMigration } =
        await import("./utils/crypto-migration/tmux-monitor-settings-migration.js");
      await runTmuxMonitorSettingsMigration();

      const { runSessionSharingSettingsMigration } =
        await import("./utils/crypto-migration/session-sharing-settings-migration.js");
      await runSessionSharingSettingsMigration();

      const { runSessionRecordingSettingsMigration } =
        await import("./utils/crypto-migration/session-recording-settings-migration.js");
      await runSessionRecordingSettingsMigration();

      const { runRemoteDesktopSettingsMigration } =
        await import("./utils/crypto-migration/remote-desktop-settings-migration.js");
      await runRemoteDesktopSettingsMigration();

      const { runHostMetricsSettingsMigration } =
        await import("./utils/crypto-migration/host-metrics-settings-migration.js");
      await runHostMetricsSettingsMigration();

      const { runDockerSettingsMigration } =
        await import("./utils/crypto-migration/docker-settings-migration.js");
      await runDockerSettingsMigration();

      const { runAiSettingsMigration } =
        await import("./utils/crypto-migration/ai-settings-migration.js");
      await runAiSettingsMigration();

      const { runWakeOnLanSettingsMigration } =
        await import("./utils/crypto-migration/wake-on-lan-settings-migration.js");
      await runWakeOnLanSettingsMigration();

      const { runSecretSourcesTokenMigration } =
        await import("./utils/crypto-migration/secret-sources-token-migration.js");
      await runSecretSourcesTokenMigration();
    } catch (error) {
      systemLogger.warn("Plugin runtime failed to initialize", {
        operation: "plugin_init",
        error: getErrorMessage(error),
      });
    }

    const { startAnalyticsHeartbeat } = await import("./utils/analytics.js");
    startAnalyticsHeartbeat();

    systemLogger.success("Termix backend started successfully", {
      operation: "backend_init_complete",
      port: process.env.PORT || 4090,
      ssl: process.env.ENABLE_SSL === "true",
      duration: Date.now() - initStartTime,
    });

    const gracefulShutdown = async (signal: string) => {
      systemLogger.info(`Received ${signal}, initiating graceful shutdown...`, {
        operation: "shutdown",
      });

      // Terminate plugin workers before the database goes away, so a plugin
      // mid-write cannot outlive it.
      try {
        const { shutdownPlugins } = await import("./plugins/index.js");
        await shutdownPlugins();
      } catch {
        // Nothing to stop.
      }

      // Only SQLite has anything to flush. On a client-server engine the writes
      // committed as they happened, so there is no file to save and claiming
      // otherwise in the log would be untrue.
      if (needsExplicitPersist(databaseDialect)) {
        try {
          await DatabaseSaveTrigger.forceSave("shutdown_explicit_save");
          systemLogger.info("Database saved to disk before exit", {
            operation: "shutdown_db_saved",
          });
        } catch (error) {
          systemLogger.error("Failed to save database during shutdown", error, {
            operation: "shutdown_db_save_failed",
          });
        }
      }
      process.exit(0);
    };

    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

    process.on("message", (msg: { type?: string }) => {
      if (msg?.type === "shutdown") {
        gracefulShutdown("IPC shutdown");
      }
    });

    // A single bad request must not take the server down. Exit only on errors
    // that leave the process genuinely unusable; log and keep serving
    // otherwise, since these are almost always scoped to one connection.
    const isFatalError = (error: unknown): boolean => {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "ERR_WORKER_OUT_OF_MEMORY") return true;
      if (error instanceof RangeError) {
        return /call stack|heap out of memory/i.test(error.message);
      }
      return false;
    };

    process.on("uncaughtException", (error) => {
      systemLogger.error("Uncaught exception occurred", error, {
        operation: "error_handling",
        fatal: isFatalError(error),
      });
      if (isFatalError(error)) {
        process.exit(1);
      }
    });

    process.on("unhandledRejection", (reason) => {
      systemLogger.error("Unhandled promise rejection", reason, {
        operation: "error_handling",
        fatal: isFatalError(reason),
      });
      if (isFatalError(reason)) {
        process.exit(1);
      }
    });
  } catch (error) {
    systemLogger.error("Failed to initialize backend services", error, {
      operation: "startup_failed",
    });
    process.exit(1);
  }
})();
