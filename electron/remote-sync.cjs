// Remote sync engine for the desktop app's optional connection to a
// self-hosted Termix server. Runs entirely in the Electron main process:
// - Holds the remote JWT (safeStorage-encrypted on disk, never exposed to
//   the renderer's localStorage) and the local embedded backend's JWT
//   (cached in memory only, handed over by the renderer at local-login
//   time via notify-local-login).
// - On a timer, pulls + pushes each synced entity type between the
//   embedded backend (always localhost:30001) and the configured remote
//   server, reconciling by syncId with last-write-wins on updatedAt, and
//   propagating tombstones (deletions) in both directions.
// - Pushes connection/sync status to the renderer via IPC so the Settings
//   UI and a global banner can reflect it without polling.

const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");

const SYNCED_ENTITY_TYPES = [
  "hosts",
  "sshCredentials",
  "sshFolders",
  "snippets",
  "snippetFolders",
  "vaultProfiles",
  "dashboardServiceLinks",
  "homepageItems",
];

const SYNC_INTERVAL_MS = 90 * 1000;
const EMBEDDED_BASE_URL = "http://127.0.0.1:30001";

function dataPath(filename) {
  return path.join(app.getPath("userData"), filename);
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  const userDataPath = app.getPath("userData");
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function getDesktopSettingsPath() {
  return dataPath("desktop-settings.json");
}

function getRemoteSyncConfigPath() {
  return dataPath("remote-sync-config.json");
}

function getRemoteSyncCredentialPath() {
  return dataPath("remote-sync-credential.json");
}

function getRemoteSyncStatePath() {
  return dataPath("remote-sync-state.json");
}

function getDesktopSettings() {
  return readJson(getDesktopSettingsPath(), {
    defaultConnectionOrigin: "local",
  });
}

function saveDesktopSettings(settings) {
  writeJson(getDesktopSettingsPath(), settings);
  return { success: true };
}

function getRemoteSyncConfig() {
  return readJson(getRemoteSyncConfigPath(), null);
}

function saveRemoteSyncConfig(config) {
  writeJson(getRemoteSyncConfigPath(), config);
  return { success: true };
}

function clearRemoteSyncConfig() {
  try {
    fs.unlinkSync(getRemoteSyncConfigPath());
  } catch {
    // already absent
  }
  return { success: true };
}

function getSafeStorageAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function saveRemoteSyncJwt(token) {
  if (!getSafeStorageAvailable()) {
    return { success: false, error: "Encryption unavailable on this system" };
  }
  writeJson(getRemoteSyncCredentialPath(), {
    encrypted: true,
    value: safeStorage.encryptString(token).toString("base64"),
    obtainedAt: new Date().toISOString(),
  });
  return { success: true };
}

function getRemoteSyncJwt() {
  const record = readJson(getRemoteSyncCredentialPath(), null);
  if (!record?.encrypted || !getSafeStorageAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(record.value, "base64"));
  } catch {
    return null;
  }
}

function clearRemoteSyncJwt() {
  try {
    fs.unlinkSync(getRemoteSyncCredentialPath());
  } catch {
    // already absent
  }
  return { success: true };
}

function decodeJwtExpiry(token) {
  try {
    const payloadB64 = token.split(".")[1];
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64").toString("utf8"),
    );
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isJwtExpiredOrExpiringSoon(token, marginMs = 60 * 1000) {
  const expiresAt = decodeJwtExpiry(token);
  if (expiresAt === null) return false;
  return Date.now() + marginMs >= expiresAt;
}

class RemoteSyncEngine {
  constructor(getMainWindow) {
    this.getMainWindow = getMainWindow;
    this.localJwt = null;
    this.timer = null;
    this.syncing = false;
    this.status = {
      connected: false,
      syncing: false,
      lastSyncedAt: null,
      lastError: null,
      needsReauth: false,
    };
  }

  setLocalJwt(token) {
    this.localJwt = token || null;
  }

  emitStatus() {
    const win = this.getMainWindow?.();
    if (!win || win.isDestroyed()) return;
    win.webContents.send("remote-sync-status-changed", this.status);
  }

  updateStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emitStatus();
  }

  start() {
    const config = getRemoteSyncConfig();
    this.status.connected = !!config?.serverUrl;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.syncNow(), SYNC_INTERVAL_MS);
    if (config?.serverUrl) {
      // Fire an initial sync shortly after startup rather than waiting a
      // full interval, but don't block app boot on it.
      setTimeout(() => this.syncNow(), 5000);
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async syncNow() {
    if (this.syncing) return this.status;
    const config = getRemoteSyncConfig();
    if (!config?.serverUrl) {
      this.updateStatus({ connected: false, syncing: false });
      return this.status;
    }

    const remoteJwt = getRemoteSyncJwt();
    if (!remoteJwt) {
      this.updateStatus({
        connected: true,
        syncing: false,
        needsReauth: true,
        lastError: "Not signed in to remote server",
      });
      return this.status;
    }
    if (isJwtExpiredOrExpiringSoon(remoteJwt)) {
      this.updateStatus({
        connected: true,
        syncing: false,
        needsReauth: true,
        lastError: "Remote session expired",
      });
      return this.status;
    }
    if (!this.localJwt) {
      // Local login hasn't handed us a token yet (e.g. very early after
      // boot) -- skip this tick rather than fail loudly.
      return this.status;
    }

    this.syncing = true;
    this.updateStatus({ connected: true, syncing: true, lastError: null });

    try {
      const state = readJson(getRemoteSyncStatePath(), { entities: {} });
      let sawAuthFailure = false;

      for (const entityType of SYNCED_ENTITY_TYPES) {
        const entityState = state.entities[entityType] || {
          lastPulledAt: null,
          lastPushedAt: null,
        };

        const result = await this.syncEntity({
          entityType,
          remoteBaseUrl: config.serverUrl.replace(/\/$/, ""),
          remoteJwt,
          since: entityState.lastPulledAt,
        });

        if (result.authFailure) {
          sawAuthFailure = true;
          break;
        }

        state.entities[entityType] = {
          lastPulledAt: result.syncedAt,
          lastPushedAt: result.syncedAt,
        };
      }

      if (sawAuthFailure) {
        this.updateStatus({
          syncing: false,
          needsReauth: true,
          lastError: "Remote server rejected the session",
        });
        return this.status;
      }

      writeJson(getRemoteSyncStatePath(), state);
      writeJson(getRemoteSyncConfigPath(), {
        ...config,
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: "ok",
        lastSyncError: null,
      });

      this.updateStatus({
        connected: true,
        syncing: false,
        needsReauth: false,
        lastSyncedAt: new Date().toISOString(),
        lastError: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(getRemoteSyncConfigPath(), {
        ...config,
        lastSyncStatus: "error",
        lastSyncError: message,
      });
      this.updateStatus({ syncing: false, lastError: message });
    } finally {
      this.syncing = false;
    }

    return this.status;
  }

  async fetchJson(url, token, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    if (res.status === 401 || res.status === 403) {
      const err = new Error(`Auth failed (${res.status})`);
      err.authFailure = true;
      throw err;
    }
    if (!res.ok) {
      throw new Error(`Request failed (${res.status}): ${url}`);
    }
    return res.json();
  }

  async pullSide(baseUrl, token, entityType, since) {
    const url = `${baseUrl}/sync/${entityType}${since ? `?since=${encodeURIComponent(since)}` : ""}`;
    const data = await this.fetchJson(url, token);
    return data.rows || [];
  }

  async pullTombstones(baseUrl, token, entityType, since) {
    const url = `${baseUrl}/sync/${entityType}/tombstones${since ? `?since=${encodeURIComponent(since)}` : ""}`;
    const data = await this.fetchJson(url, token);
    return data.tombstones || [];
  }

  async pushRow(baseUrl, token, entityType, row) {
    await this.fetchJson(`${baseUrl}/sync/${entityType}`, token, {
      method: "POST",
      body: JSON.stringify({ row }),
    });
  }

  async pushTombstone(baseUrl, token, entityType, syncId) {
    await this.fetchJson(`${baseUrl}/sync/tombstones`, token, {
      method: "POST",
      body: JSON.stringify({ entityType, syncId }),
    });
  }

  async syncEntity({ entityType, remoteBaseUrl, remoteJwt, since }) {
    const syncedAt = new Date().toISOString();
    try {
      const [localRows, remoteRows, localTombstones, remoteTombstones] =
        await Promise.all([
          this.pullSide(EMBEDDED_BASE_URL, this.localJwt, entityType, since),
          this.pullSide(remoteBaseUrl, remoteJwt, entityType, since),
          this.pullTombstones(
            EMBEDDED_BASE_URL,
            this.localJwt,
            entityType,
            since,
          ),
          this.pullTombstones(remoteBaseUrl, remoteJwt, entityType, since),
        ]);

      const tombstonedSyncIds = new Set([
        ...localTombstones.map((t) => t.syncId),
        ...remoteTombstones.map((t) => t.syncId),
      ]);

      const localBySyncId = new Map(
        localRows.filter((r) => r.syncId).map((r) => [r.syncId, r]),
      );
      const remoteBySyncId = new Map(
        remoteRows.filter((r) => r.syncId).map((r) => [r.syncId, r]),
      );
      const allSyncIds = new Set([
        ...localBySyncId.keys(),
        ...remoteBySyncId.keys(),
      ]);

      for (const syncId of allSyncIds) {
        if (tombstonedSyncIds.has(syncId)) continue;

        const localRow = localBySyncId.get(syncId);
        const remoteRow = remoteBySyncId.get(syncId);

        if (localRow && !remoteRow) {
          await this.pushRow(remoteBaseUrl, remoteJwt, entityType, localRow);
        } else if (remoteRow && !localRow) {
          await this.pushRow(
            EMBEDDED_BASE_URL,
            this.localJwt,
            entityType,
            remoteRow,
          );
        } else if (localRow && remoteRow) {
          const localUpdatedAt = new Date(localRow.updatedAt || 0).getTime();
          const remoteUpdatedAt = new Date(remoteRow.updatedAt || 0).getTime();
          if (localUpdatedAt > remoteUpdatedAt) {
            await this.pushRow(remoteBaseUrl, remoteJwt, entityType, localRow);
          } else if (remoteUpdatedAt > localUpdatedAt) {
            await this.pushRow(
              EMBEDDED_BASE_URL,
              this.localJwt,
              entityType,
              remoteRow,
            );
          }
        }
      }

      // Apply tombstones to whichever side hasn't already deleted the row.
      for (const tombstone of localTombstones) {
        if (remoteBySyncId.has(tombstone.syncId)) {
          await this.pushTombstone(
            remoteBaseUrl,
            remoteJwt,
            entityType,
            tombstone.syncId,
          );
        }
      }
      for (const tombstone of remoteTombstones) {
        if (localBySyncId.has(tombstone.syncId)) {
          await this.pushTombstone(
            EMBEDDED_BASE_URL,
            this.localJwt,
            entityType,
            tombstone.syncId,
          );
        }
      }

      return { syncedAt };
    } catch (error) {
      if (error?.authFailure) {
        return { syncedAt, authFailure: true };
      }
      throw error;
    }
  }
}

let engine = null;

function initRemoteSync(getMainWindow) {
  engine = new RemoteSyncEngine(getMainWindow);
  engine.start();
  return engine;
}

function getRemoteSyncEngine() {
  return engine;
}

module.exports = {
  initRemoteSync,
  getRemoteSyncEngine,
  getDesktopSettings,
  saveDesktopSettings,
  getRemoteSyncConfig,
  saveRemoteSyncConfig,
  clearRemoteSyncConfig,
  saveRemoteSyncJwt,
  getRemoteSyncJwt,
  clearRemoteSyncJwt,
  isJwtExpiredOrExpiringSoon,
  decodeJwtExpiry,
};
