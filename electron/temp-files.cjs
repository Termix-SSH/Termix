const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function sanitizeFileName(fileName) {
  const baseName = path.basename(String(fileName || "file"));
  const cleaned = baseName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return "file";
  }
  return cleaned;
}

function decodeFileContent(content, encoding) {
  if (encoding === "base64") {
    return Buffer.from(String(content || ""), "base64");
  }
  return Buffer.from(String(content || ""), "utf8");
}

function createTempFileManager({
  getTempRoot,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  ttlMs = DEFAULT_TTL_MS,
  sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS,
  now = () => Date.now(),
  log = () => {},
  fsImpl = fs,
}) {
  const entries = new Map();
  let totalBytes = 0;
  let sweepTimer = null;

  function ensureTempRoot() {
    const tempRoot = getTempRoot();
    fsImpl.mkdirSync(tempRoot, { recursive: true });
    return tempRoot;
  }

  function generateTempId() {
    const suffix = Math.random().toString(36).slice(2) || "0";
    return `${now()}-${suffix}`;
  }

  function removeDir(dirPath) {
    try {
      fsImpl.rmSync(dirPath, { recursive: true, force: true });
    } catch (error) {
      log("Failed to clean up temporary file:", error.message);
    }
  }

  function cleanupTempFile(tempId) {
    const entry = entries.get(tempId);
    if (!entry) return;
    removeDir(entry.dir);
    totalBytes = Math.max(0, totalBytes - entry.size);
    entries.delete(tempId);
  }

  function cleanupExpired() {
    const cutoff = now() - ttlMs;

    for (const [tempId, entry] of entries.entries()) {
      if (entry.createdAt <= cutoff) {
        cleanupTempFile(tempId);
      }
    }

    const activeDirs = new Set();
    for (const entry of entries.values()) {
      activeDirs.add(path.resolve(entry.dir));
    }

    let tempRoot;
    try {
      tempRoot = getTempRoot();
      if (!fsImpl.existsSync(tempRoot)) return;
    } catch {
      return;
    }

    let dirEntries;
    try {
      dirEntries = fsImpl.readdirSync(tempRoot, { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of dirEntries) {
      const fullPath = path.resolve(tempRoot, dirent.name);
      if (activeDirs.has(fullPath)) continue;
      try {
        const stat = fsImpl.statSync(fullPath);
        if (stat.mtimeMs <= cutoff) {
          removeDir(fullPath);
        }
      } catch {
        // Entry may have been removed concurrently.
      }
    }
  }

  function assertWithinQuota(incomingBytes) {
    if (totalBytes + incomingBytes > maxTotalBytes) {
      throw new Error(
        `Temporary file storage quota exceeded (${maxTotalBytes} bytes limit)`,
      );
    }
  }

  function createTempFile(fileName, content, encoding = "utf8") {
    cleanupExpired();
    const buffer = decodeFileContent(content, encoding);
    assertWithinQuota(buffer.length);

    const tempId = generateTempId();
    const tempDir = fsImpl.mkdtempSync(
      path.join(ensureTempRoot(), `${tempId}-`),
    );
    const filePath = path.join(tempDir, sanitizeFileName(fileName));

    try {
      fsImpl.writeFileSync(filePath, buffer);
    } catch (error) {
      removeDir(tempDir);
      throw error;
    }

    entries.set(tempId, {
      path: filePath,
      dir: tempDir,
      size: buffer.length,
      createdAt: now(),
    });
    totalBytes += buffer.length;
    return { tempId, path: filePath };
  }

  function createTempFolder(folderName, files = []) {
    cleanupExpired();

    const prepared = [];
    let folderBytes = 0;

    for (const file of files || []) {
      const segments = String(file?.relativePath || "")
        .split(/[\\/]+/)
        .filter((segment) => segment && segment !== "." && segment !== "..")
        .map(sanitizeFileName);
      if (segments.length === 0) continue;

      const buffer = decodeFileContent(file?.content, file?.encoding);
      folderBytes += buffer.length;
      assertWithinQuota(folderBytes);
      prepared.push({ relativePath: segments.join(path.sep), buffer });
    }

    const tempId = generateTempId();
    const tempDir = fsImpl.mkdtempSync(
      path.join(ensureTempRoot(), `${tempId}-`),
    );
    const folderPath = path.join(
      tempDir,
      sanitizeFileName(folderName || "files"),
    );

    try {
      fsImpl.mkdirSync(folderPath, { recursive: true });
      for (const item of prepared) {
        const targetPath = path.join(folderPath, item.relativePath);
        fsImpl.mkdirSync(path.dirname(targetPath), { recursive: true });
        fsImpl.writeFileSync(targetPath, item.buffer);
      }
    } catch (error) {
      removeDir(tempDir);
      throw error;
    }

    entries.set(tempId, {
      path: folderPath,
      dir: tempDir,
      size: folderBytes,
      createdAt: now(),
    });
    totalBytes += folderBytes;
    return { tempId, path: folderPath };
  }

  function getTempPath(tempId) {
    return entries.get(tempId)?.path;
  }

  function cleanupAll() {
    stopCleanupTimer();
    for (const tempId of Array.from(entries.keys())) {
      cleanupTempFile(tempId);
    }
  }

  function startCleanupTimer() {
    if (sweepTimer || sweepIntervalMs <= 0) return;
    sweepTimer = setInterval(() => {
      cleanupExpired();
    }, sweepIntervalMs);
    if (typeof sweepTimer.unref === "function") {
      sweepTimer.unref();
    }
  }

  function stopCleanupTimer() {
    if (!sweepTimer) return;
    clearInterval(sweepTimer);
    sweepTimer = null;
  }

  return {
    createTempFile,
    createTempFolder,
    getTempPath,
    cleanupTempFile,
    cleanupExpired,
    cleanupAll,
    startCleanupTimer,
    stopCleanupTimer,
    getTotalBytes: () => totalBytes,
    size: () => entries.size,
  };
}

module.exports = {
  DEFAULT_MAX_TOTAL_BYTES,
  DEFAULT_TTL_MS,
  DEFAULT_SWEEP_INTERVAL_MS,
  sanitizeFileName,
  decodeFileContent,
  createTempFileManager,
};
