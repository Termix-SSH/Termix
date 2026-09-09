// Local filesystem access + streamed local<->remote transfers for the
// desktop app's dual-pane file manager.
//
// The renderer has no Node access (contextIsolation), so browsing the user's
// own disk and moving bytes between it and the backend has to happen here.
// Uploads/downloads are streamed through Electron's `net` stack against the
// same file-manager HTTP routes the renderer already uses, so nothing is ever
// buffered whole in memory.
//
// Trust boundary: the renderer never supplies a URL or headers. It names an
// origin ("local" | "remote") and a route from a fixed allowlist; the main
// process resolves the actual Termix backend URL and attaches credentials
// itself (session cookies for the embedded backend, the stored Remote Sync JWT
// for the remote server). Nothing here can be pointed at another host.

const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { URL } = require("url");

const IPC = {
  HOME: "local-fs:home",
  LIST: "local-fs:list",
  MKDIR: "local-fs:mkdir",
  CREATE_FILE: "local-fs:create-file",
  RENAME: "local-fs:rename",
  TRASH: "local-fs:trash",
  ENSURE_DIR: "local-fs:ensure-dir",
  EXISTS: "local-fs:exists",
  WALK: "local-fs:walk",
  REVEAL: "local-fs:reveal",
  OPEN: "local-fs:open",
  UPLOAD: "local-transfer:upload",
  DOWNLOAD: "local-transfer:download",
  CANCEL: "local-transfer:cancel",
  PROGRESS: "local-transfer:progress",
};

const READ_CHUNK_BYTES = 1024 * 1024;
const PROGRESS_INTERVAL_MS = 150;

const activeTransfers = new Map();

function isAbsoluteLocalPath(candidate) {
  return typeof candidate === "string" && path.isAbsolute(candidate);
}

function normalizeLocalPath(candidate) {
  if (!isAbsoluteLocalPath(candidate)) {
    throw new Error("A local absolute path is required");
  }
  return path.normalize(candidate);
}

function isHiddenEntry(name) {
  return name.startsWith(".");
}

// A single path segment: no separators, not "." / "..", no NULs.
function requireEntryName(name, what) {
  const safeName = String(name || "").trim();
  if (
    !safeName ||
    safeName === "." ||
    safeName === ".." ||
    /[\/\\\0]/.test(safeName)
  ) {
    throw new Error(`Invalid ${what}`);
  }
  return safeName;
}

async function pathExists(target) {
  try {
    await fsp.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function describeEntry(dirPath, dirent) {
  const entryPath = path.join(dirPath, dirent.name);
  let type = "file";
  let size = 0;
  let modifiedTimestamp;
  let linkTarget;

  try {
    if (dirent.isSymbolicLink()) {
      type = "link";
      try {
        linkTarget = await fsp.readlink(entryPath);
      } catch {
        // dangling or unreadable link
      }
      // Follow the link so a symlinked directory still navigates like one.
      try {
        const target = await fsp.stat(entryPath);
        if (target.isDirectory()) type = "directory";
        size = target.size;
        modifiedTimestamp = target.mtimeMs;
      } catch {
        const own = await fsp.lstat(entryPath);
        modifiedTimestamp = own.mtimeMs;
      }
    } else if (dirent.isDirectory()) {
      type = "directory";
      const stat = await fsp.stat(entryPath);
      modifiedTimestamp = stat.mtimeMs;
    } else {
      const stat = await fsp.stat(entryPath);
      size = stat.size;
      modifiedTimestamp = stat.mtimeMs;
    }
  } catch {
    // Unreadable entry: still list it so the user sees it exists.
  }

  return {
    name: dirent.name,
    path: entryPath,
    type,
    size,
    modifiedTimestamp,
    linkTarget,
    hidden: isHiddenEntry(dirent.name),
  };
}

async function listDirectory(dirPath) {
  const resolved = normalizeLocalPath(dirPath);
  const dirents = await fsp.readdir(resolved, { withFileTypes: true });
  const entries = await Promise.all(
    dirents.map((dirent) => describeEntry(resolved, dirent)),
  );
  const parent = path.dirname(resolved);
  return {
    path: resolved,
    parent: parent === resolved ? null : parent,
    entries,
  };
}

// Expands a set of dropped local paths into the flat list of files (with
// paths relative to the drop root) plus any empty directories, mirroring what
// the browser's FileSystemEntry walker produces for OS drops.
async function walkPaths(rootPaths) {
  const files = [];
  const emptyDirs = [];
  let totalBytes = 0;

  async function walkDir(absDir, relDir) {
    const dirents = await fsp.readdir(absDir, { withFileTypes: true });
    if (dirents.length === 0) {
      emptyDirs.push(relDir);
      return;
    }
    for (const dirent of dirents) {
      const abs = path.join(absDir, dirent.name);
      const rel = `${relDir}/${dirent.name}`;
      if (dirent.isDirectory()) {
        await walkDir(abs, rel);
      } else if (dirent.isFile()) {
        const stat = await fsp.stat(abs);
        files.push({ localPath: abs, relativePath: rel, size: stat.size });
        totalBytes += stat.size;
      } else if (dirent.isSymbolicLink()) {
        // Upload what the link points at, if it is a regular file.
        try {
          const stat = await fsp.stat(abs);
          if (stat.isFile()) {
            files.push({ localPath: abs, relativePath: rel, size: stat.size });
            totalBytes += stat.size;
          }
        } catch {
          // dangling link: skip
        }
      }
    }
  }

  for (const rootPath of rootPaths) {
    const abs = normalizeLocalPath(rootPath);
    const stat = await fsp.stat(abs);
    const name = path.basename(abs);
    if (stat.isDirectory()) {
      await walkDir(abs, name);
    } else if (stat.isFile()) {
      files.push({ localPath: abs, relativePath: name, size: stat.size });
      totalBytes += stat.size;
    }
  }

  return { files, emptyDirs, totalBytes };
}

function toHeaderMap(headers) {
  const out = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    out[key] = String(value);
  }
  return out;
}

function makeProgressReporter(sender, transferId) {
  let lastSentAt = 0;
  return (transferred, total, force = false) => {
    const now = Date.now();
    if (!force && now - lastSentAt < PROGRESS_INTERVAL_MS) return;
    lastSentAt = now;
    if (sender.isDestroyed()) return;
    sender.send(IPC.PROGRESS, { transferId, transferred, total });
  };
}

function collectBody(response) {
  return new Promise((resolve) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    response.on("error", () => resolve(""));
  });
}

function describeHttpError(statusCode, bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed.error === "string") return parsed.error;
    if (parsed && typeof parsed.message === "string") return parsed.message;
  } catch {
    // not JSON
  }
  return bodyText?.trim() || `Request failed with status ${statusCode}`;
}

function writeToRequest(request, chunk) {
  return new Promise((resolve, reject) => {
    try {
      request.write(chunk, () => resolve());
    } catch (error) {
      reject(error);
    }
  });
}

const TRANSFER_ROUTES = Object.freeze({
  uploadFileStream: "/ssh/uploadFileStream",
  downloadFileStream: "/ssh/downloadFileStream",
});

const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const DEFAULT_LOCAL_FILE_MANAGER_BASE =
  "http://localhost:30004/ssh/file_manager";

function normalizeHttpBase(candidate, what) {
  let parsed;
  try {
    parsed = new URL(String(candidate || ""));
  } catch {
    throw new Error(`${what} is not a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${what} must use http or https`);
  }
  return parsed.toString().replace(/\/$/, "");
}

// Resolves where a transfer may go. Only the two file-manager streaming
// routes are reachable, and only on the embedded backend or the configured
// Remote Sync server; credentials come from the main process, not the caller.
function createTargetResolver({
  localBaseUrl = DEFAULT_LOCAL_FILE_MANAGER_BASE,
  getRemoteSyncConfig,
  getRemoteSyncJwt,
}) {
  return function resolveTransferTarget({ origin, route, deviceId } = {}) {
    const routePath = TRANSFER_ROUTES[route];
    if (!routePath) {
      throw new Error(`Unknown transfer route: ${String(route)}`);
    }

    const headers = { "X-Electron-App": "true" };
    if (deviceId !== undefined && deviceId !== null && deviceId !== "") {
      if (typeof deviceId !== "string" || !DEVICE_ID_PATTERN.test(deviceId)) {
        throw new Error("Invalid device id");
      }
      headers["X-Termix-Device-ID"] = deviceId;
    }

    if (origin === "local") {
      return {
        url: `${normalizeHttpBase(localBaseUrl, "Local backend URL")}${routePath}`,
        headers,
      };
    }

    if (origin === "remote") {
      const config =
        typeof getRemoteSyncConfig === "function"
          ? getRemoteSyncConfig()
          : null;
      if (!config || !config.serverUrl) {
        throw new Error("Remote sync server is not configured");
      }
      const base = normalizeHttpBase(
        config.serverUrl,
        "Remote sync server URL",
      );
      const jwt =
        typeof getRemoteSyncJwt === "function" ? getRemoteSyncJwt() : null;
      if (jwt) headers.Authorization = `Bearer ${jwt}`;
      return { url: `${base}/ssh/file_manager${routePath}`, headers };
    }

    throw new Error(`Unknown transfer origin: ${String(origin)}`);
  };
}

function createNetRequest(net, event, method, url) {
  return net.request({
    method,
    url,
    session: event.sender.session,
    useSessionCookies: true,
  });
}

// Streams one local file to the backend's multipart `uploadFileStream` route.
async function uploadLocalFile({ net, resolveTransferTarget }, event, options) {
  const { transferId, origin, deviceId, fields, localPath, fileName } =
    options || {};

  if (!transferId || !localPath) {
    throw new Error("Missing upload parameters");
  }
  const { url, headers } = resolveTransferTarget({
    origin,
    route: "uploadFileStream",
    deviceId,
  });

  const absPath = normalizeLocalPath(localPath);
  const stat = await fsp.stat(absPath);
  if (!stat.isFile()) {
    throw new Error("Only regular files can be uploaded");
  }

  const boundary = `----TermixLocalUpload${Date.now()}${Math.random()
    .toString(36)
    .slice(2)}`;
  const safeName = String(fileName || path.basename(absPath))
    .replace(/[\r\n]/g, " ")
    .replace(/"/g, "%22");

  let preamble = "";
  for (const [key, value] of Object.entries(fields || {})) {
    if (value === undefined || value === null) continue;
    preamble +=
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
      `${String(value)}\r\n`;
  }
  preamble +=
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`;
  const epilogue = `\r\n--${boundary}--\r\n`;

  const preambleBuffer = Buffer.from(preamble, "utf8");
  const epilogueBuffer = Buffer.from(epilogue, "utf8");

  const request = createNetRequest(net, event, "POST", url);
  for (const [key, value] of Object.entries(toHeaderMap(headers))) {
    request.setHeader(key, value);
  }
  request.setHeader(
    "Content-Type",
    `multipart/form-data; boundary=${boundary}`,
  );
  // Without chunked encoding Electron buffers the whole body in the main
  // process before sending; chunked keeps memory flat for multi-GB files.
  // Busboy on the backend parses the multipart stream incrementally either way.
  request.chunkedEncoding = true;

  const report = makeProgressReporter(event.sender, transferId);
  const readStream = fs.createReadStream(absPath, {
    highWaterMark: READ_CHUNK_BYTES,
  });

  const state = {
    cancelled: false,
    abort: () => {
      state.cancelled = true;
      readStream.destroy();
      request.abort();
    },
  };
  activeTransfers.set(transferId, state);

  // The server may answer early (auth failure, missing session) while the
  // body is still streaming; stop pushing bytes as soon as it does.
  let responded = false;
  const responsePromise = new Promise((resolve, reject) => {
    request.on("response", async (response) => {
      responded = true;
      const bodyText = await collectBody(response);
      resolve({ statusCode: response.statusCode, bodyText });
    });
    request.on("error", (error) => reject(error));
    request.on("abort", () => reject(new Error("Transfer cancelled")));
  });
  // Avoid an unhandled rejection if we bail out before awaiting below.
  responsePromise.catch(() => {});

  // A write callback never fires once the request has errored or been
  // aborted, so every write races against the response promise's rejection.
  const write = (chunk) =>
    Promise.race([writeToRequest(request, chunk), responsePromise]);

  try {
    await write(preambleBuffer);
    let sent = 0;
    for await (const chunk of readStream) {
      if (state.cancelled) throw new Error("Transfer cancelled");
      if (responded) break;
      await write(chunk);
      sent += chunk.length;
      report(sent, stat.size);
    }
    if (!responded) {
      await write(epilogueBuffer);
      request.end();
    }

    const { statusCode, bodyText } = await responsePromise;
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(describeHttpError(statusCode, bodyText));
    }
    report(stat.size, stat.size, true);
    return { success: true, bytes: stat.size };
  } catch (error) {
    readStream.destroy();
    throw error;
  } finally {
    activeTransfers.delete(transferId);
  }
}

class LocalFileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LocalFileError";
    this.code = code;
  }
}

// Destinations with a download in flight, so two transfers can never race
// each other onto the same file.
const activeDestinations = new Set();

function partialPathFor(absDest, transferId) {
  const token = String(transferId)
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 48);
  return `${absDest}.${token || "transfer"}.termix-part`;
}

// File operations used to publish a download, injectable so the replace
// strategy can be tested against Windows-like semantics (where rename() onto
// an existing name fails) without running on Windows.
const defaultPublishFs = Object.freeze({
  rename: (from, to) => fsp.rename(from, to),
  link: (from, to) => fsp.link(from, to),
  copyFileExcl: (from, to) =>
    fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL),
  rm: (target) => fsp.rm(target, { force: true }),
  lstat: (target) => fsp.lstat(target),
});

function replacedPathFor(absDest, transferId) {
  const token = String(transferId)
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 48);
  return `${absDest}.${token || "transfer"}.termix-replaced`;
}

// Puts `sourcePath` under `absDest` without ever replacing an existing file:
// link() is atomic and fails with EEXIST if the name is taken; filesystems
// without hard links fall back to an exclusive copy. The source is removed
// once the destination exists.
async function publishExclusive(io, sourcePath, absDest) {
  const exists = () =>
    new LocalFileError("EEXIST", `"${path.basename(absDest)}" already exists`);
  try {
    await io.link(sourcePath, absDest);
  } catch (error) {
    if (error && error.code === "EEXIST") throw exists();
    try {
      await io.copyFileExcl(sourcePath, absDest);
    } catch (copyError) {
      if (copyError && copyError.code === "EEXIST") throw exists();
      throw copyError;
    }
  }
  await io.rm(sourcePath);
}

// Replaces `absDest` with the finished partial. rename() over an existing
// file is not portable: POSIX replaces it, but on Windows the call commonly
// fails (EEXIST / EPERM, always when the file is open), so the swap never
// renames onto an occupied name. Instead:
//   1. move the current file aside to a transfer-unique sibling
//      (renaming to a fresh name is safe everywhere);
//   2. publish the partial exclusively under the now-free name;
//   3. delete the aside copy.
// If step 1 fails nothing has changed and the caller gets EBUSY. If step 2
// fails the aside copy is moved back, so the original survives.
async function replaceExisting(io, partialPath, absDest, transferId) {
  let current;
  try {
    current = await io.lstat(absDest);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      // Nothing to replace after all (the file went away meanwhile).
      await publishExclusive(io, partialPath, absDest);
      return;
    }
    throw error;
  }
  if (current.isDirectory()) {
    throw new LocalFileError(
      "EISDIR",
      `"${path.basename(absDest)}" is a folder and cannot be replaced by a file`,
    );
  }

  const asidePath = replacedPathFor(absDest, transferId);
  try {
    await io.rename(absDest, asidePath);
  } catch (error) {
    if (
      error &&
      (error.code === "EPERM" ||
        error.code === "EBUSY" ||
        error.code === "EACCES")
    ) {
      throw new LocalFileError(
        "EBUSY",
        `"${path.basename(absDest)}" is in use and could not be replaced`,
      );
    }
    throw error;
  }

  try {
    await publishExclusive(io, partialPath, absDest);
  } catch (error) {
    // Put the original back under its name; the partial is cleaned up by
    // the caller.
    await io.rm(absDest).catch(() => {});
    await io.rename(asidePath, absDest).catch(() => {});
    throw error;
  }

  // The old contents are no longer reachable under the real name; removing
  // the aside copy can still fail on Windows if another process holds it
  // open, so retry once before giving up and leaving it for the user.
  try {
    await io.rm(asidePath);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await io.rm(asidePath).catch((error) => {
      console.warn(
        `[local-files] replaced "${absDest}" but could not remove the previous copy at "${asidePath}": ${error && error.message}`,
      );
    });
  }
}

// Moves a finished partial file onto its final name. Without `overwrite` the
// publish is exclusive: an existing file is never replaced, even if it
// appeared while the download was running. With `overwrite` the existing file
// is swapped out in a way that also works on Windows.
async function publishDownload(
  partialPath,
  absDest,
  overwrite,
  transferId,
  io = defaultPublishFs,
) {
  if (overwrite) {
    await replaceExisting(io, partialPath, absDest, transferId);
    return;
  }
  await publishExclusive(io, partialPath, absDest);
}

// Streams one remote file (via the backend's `downloadFileStream` route) into
// a local destination. Bytes go to a transfer-unique temp sibling first and
// are published under the real name only on success, so a failed transfer
// never leaves a truncated file behind. Existing files are refused unless
// the caller explicitly asked to overwrite.
async function downloadToLocal(
  { net, resolveTransferTarget, publishFs },
  event,
  options,
) {
  const { transferId, origin, deviceId, body, destPath, expectedSize } =
    options || {};
  const overwrite = options?.overwrite === true;

  if (!transferId || !destPath) {
    throw new Error("Missing download parameters");
  }
  const { url, headers } = resolveTransferTarget({
    origin,
    route: "downloadFileStream",
    deviceId,
  });

  const absDest = normalizeLocalPath(destPath);
  if (activeDestinations.has(absDest)) {
    throw new LocalFileError(
      "EBUSY",
      `"${path.basename(absDest)}" is already being downloaded`,
    );
  }
  activeDestinations.add(absDest);

  const partialPath = partialPathFor(absDest, transferId);
  const report = makeProgressReporter(event.sender, transferId);
  const state = {
    cancelled: false,
    abort: () => {
      state.cancelled = true;
      request.abort();
    },
  };
  let request = null;

  try {
    if (!overwrite && (await pathExists(absDest))) {
      throw new LocalFileError(
        "EEXIST",
        `"${path.basename(absDest)}" already exists`,
      );
    }
    await fsp.mkdir(path.dirname(absDest), { recursive: true });

    request = createNetRequest(net, event, "POST", url);
    for (const [key, value] of Object.entries(toHeaderMap(headers))) {
      request.setHeader(key, value);
    }
    const payload = Buffer.from(JSON.stringify(body || {}), "utf8");
    request.setHeader("Content-Type", "application/json");
    request.setHeader("Content-Length", String(payload.length));
    activeTransfers.set(transferId, state);

    await new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      request.on("error", fail);
      request.on("abort", () => fail(new Error("Transfer cancelled")));
      request.on("response", (response) => {
        const statusCode = response.statusCode;
        if (statusCode < 200 || statusCode >= 300) {
          collectBody(response).then((bodyText) =>
            fail(new Error(describeHttpError(statusCode, bodyText))),
          );
          return;
        }

        const lengthHeader = response.headers["content-length"];
        const total =
          Number(
            Array.isArray(lengthHeader) ? lengthHeader[0] : lengthHeader,
          ) ||
          Number(expectedSize) ||
          undefined;

        // "wx": the temp name is ours alone; refuse to reuse a stale one.
        const writeStream = fs.createWriteStream(partialPath, { flags: "wx" });
        let received = 0;

        response.on("data", (chunk) => {
          received += chunk.length;
          const ok = writeStream.write(chunk);
          if (!ok) {
            response.pause();
            writeStream.once("drain", () => response.resume());
          }
          report(received, total);
        });
        response.on("end", () => {
          writeStream.end(() => {
            report(received, total ?? received, true);
            if (settled) return;
            settled = true;
            resolve();
          });
        });
        response.on("error", (error) => {
          writeStream.destroy();
          fail(error);
        });
        writeStream.on("error", (error) => {
          request.abort();
          fail(error);
        });
      });

      request.write(payload);
      request.end();
    });

    await publishDownload(
      partialPath,
      absDest,
      overwrite,
      transferId,
      publishFs || defaultPublishFs,
    );
    return { success: true, path: absDest };
  } catch (error) {
    await fsp.rm(partialPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    activeTransfers.delete(transferId);
    activeDestinations.delete(absDest);
  }
}

function wrap(handler) {
  return async (event, ...args) => {
    try {
      const result = await handler(event, ...args);
      return { success: true, ...(result || {}) };
    } catch (error) {
      return {
        success: false,
        error: error && error.message ? error.message : String(error),
        code: error && error.code ? error.code : undefined,
      };
    }
  };
}

// Builds the IPC handler map from injected dependencies so the whole boundary
// can be exercised in tests with a Node http shim instead of Electron.
function createLocalFileHandlers({
  net,
  shell,
  getRemoteSyncConfig,
  getRemoteSyncJwt,
  localBaseUrl,
  publishFs,
}) {
  if (!net || typeof net.request !== "function") {
    throw new Error("createLocalFileHandlers requires a net implementation");
  }
  const resolveTransferTarget = createTargetResolver({
    localBaseUrl,
    getRemoteSyncConfig,
    getRemoteSyncJwt,
  });
  const deps = {
    net,
    resolveTransferTarget,
    publishFs: publishFs || defaultPublishFs,
  };

  return {
    [IPC.HOME]: wrap(async () => ({
      home: os.homedir(),
      separator: path.sep,
      platform: process.platform,
    })),

    [IPC.LIST]: wrap(async (_event, dirPath) => listDirectory(dirPath)),

    [IPC.MKDIR]: wrap(async (_event, parentPath, name) => {
      const parent = normalizeLocalPath(parentPath);
      const safeName = requireEntryName(name, "folder name");
      const target = path.join(parent, safeName);
      await fsp.mkdir(target);
      return { path: target };
    }),

    [IPC.CREATE_FILE]: wrap(async (_event, parentPath, name) => {
      const parent = normalizeLocalPath(parentPath);
      const safeName = requireEntryName(name, "file name");
      const target = path.join(parent, safeName);
      // "wx" fails if the file already exists rather than truncating it.
      await fsp.writeFile(target, "", { flag: "wx" });
      return { path: target };
    }),

    [IPC.RENAME]: wrap(async (_event, oldPath, newName) => {
      const source = normalizeLocalPath(oldPath);
      const safeName = requireEntryName(newName, "name");
      const target = path.join(path.dirname(source), safeName);
      if (target === source) return { path: source };
      if (await pathExists(target)) {
        throw new LocalFileError("EEXIST", `"${safeName}" already exists`);
      }
      await fsp.rename(source, target);
      return { path: target };
    }),

    // Moves entries to the OS trash (Finder Trash / Recycle Bin) rather than
    // deleting outright, so a mis-click in the file manager is recoverable.
    [IPC.TRASH]: wrap(async (_event, targetPaths) => {
      if (!Array.isArray(targetPaths) || targetPaths.length === 0) {
        throw new Error("No local paths provided");
      }
      const failed = [];
      for (const candidate of targetPaths) {
        const target = normalizeLocalPath(candidate);
        try {
          await shell.trashItem(target);
        } catch (error) {
          failed.push({
            path: target,
            error: error && error.message ? error.message : String(error),
          });
        }
      }
      return { trashed: targetPaths.length - failed.length, failed };
    }),

    [IPC.ENSURE_DIR]: wrap(async (_event, dirPath) => {
      const target = normalizeLocalPath(dirPath);
      await fsp.mkdir(target, { recursive: true });
      return { path: target };
    }),

    // Which of the given paths already exist; lets the renderer ask about
    // collisions before a batch download starts.
    [IPC.EXISTS]: wrap(async (_event, targetPaths) => {
      if (!Array.isArray(targetPaths)) {
        throw new Error("Expected a list of paths");
      }
      const existing = [];
      for (const candidate of targetPaths) {
        const target = normalizeLocalPath(candidate);
        if (await pathExists(target)) existing.push(target);
      }
      return { existing };
    }),

    [IPC.WALK]: wrap(async (_event, rootPaths) => {
      if (!Array.isArray(rootPaths) || rootPaths.length === 0) {
        throw new Error("No local paths provided");
      }
      return walkPaths(rootPaths);
    }),

    [IPC.REVEAL]: wrap(async (_event, targetPath) => {
      shell.showItemInFolder(normalizeLocalPath(targetPath));
    }),

    [IPC.OPEN]: wrap(async (_event, targetPath) => {
      const error = await shell.openPath(normalizeLocalPath(targetPath));
      if (error) throw new Error(error);
    }),

    [IPC.UPLOAD]: wrap((event, options) =>
      uploadLocalFile(deps, event, options),
    ),

    [IPC.DOWNLOAD]: wrap((event, options) =>
      downloadToLocal(deps, event, options),
    ),

    [IPC.CANCEL]: wrap(async (_event, transferId) => {
      const state = activeTransfers.get(transferId);
      if (!state) return { cancelled: false };
      state.abort();
      return { cancelled: true };
    }),
  };
}

function registerLocalFileHandlers({ ipcMain, shell }) {
  // Real Electron wiring; tests build the handlers directly instead.
  const { net } = require("electron");
  const remoteSync = require("./remote-sync.cjs");
  const handlers = createLocalFileHandlers({
    net,
    shell,
    getRemoteSyncConfig: remoteSync.getRemoteSyncConfig,
    getRemoteSyncJwt: remoteSync.getRemoteSyncJwt,
  });
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler);
  }
}

module.exports = {
  IPC,
  TRANSFER_ROUTES,
  registerLocalFileHandlers,
  // exported for tests / reuse
  createLocalFileHandlers,
  createTargetResolver,
  publishDownload,
  defaultPublishFs,
  walkPaths,
  listDirectory,
};
