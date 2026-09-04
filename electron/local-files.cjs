// Local filesystem access + streamed local<->remote transfers for the
// desktop app's dual-pane file manager.
//
// The renderer has no Node access (contextIsolation), so browsing the user's
// own disk and moving bytes between it and the backend has to happen here.
// Uploads/downloads are streamed through Electron's `net` stack against the
// same file-manager HTTP routes the renderer already uses, so nothing is ever
// buffered whole in memory and the existing auth (session cookies + bearer
// JWT supplied by the renderer) keeps working unchanged.

const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { URL } = require("url");
const { net } = require("electron");

const IPC = {
  HOME: "local-fs:home",
  LIST: "local-fs:list",
  MKDIR: "local-fs:mkdir",
  ENSURE_DIR: "local-fs:ensure-dir",
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

function createNetRequest(event, method, url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) transfer targets are supported");
  }
  return net.request({
    method,
    url: parsed.toString(),
    session: event.sender.session,
    useSessionCookies: true,
  });
}

// Streams one local file to the backend's multipart `uploadFileStream` route.
async function uploadLocalFile(event, options) {
  const { transferId, url, headers, fields, localPath, fileName } =
    options || {};

  if (!transferId || !url || !localPath) {
    throw new Error("Missing upload parameters");
  }

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

  const request = createNetRequest(event, "POST", url);
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

// Streams one remote file (via the backend's `downloadFileStream` route) into
// a local destination, writing to a temp sibling and renaming on success so
// a failed transfer never leaves a truncated file behind under the real name.
async function downloadToLocal(event, options) {
  const { transferId, url, headers, body, destPath, expectedSize } =
    options || {};

  if (!transferId || !url || !destPath) {
    throw new Error("Missing download parameters");
  }

  const absDest = normalizeLocalPath(destPath);
  await fsp.mkdir(path.dirname(absDest), { recursive: true });
  const partialPath = `${absDest}.termix-part`;

  const request = createNetRequest(event, "POST", url);
  for (const [key, value] of Object.entries(toHeaderMap(headers))) {
    request.setHeader(key, value);
  }
  const payload = Buffer.from(JSON.stringify(body || {}), "utf8");
  request.setHeader("Content-Type", "application/json");
  request.setHeader("Content-Length", String(payload.length));

  const report = makeProgressReporter(event.sender, transferId);
  const state = {
    cancelled: false,
    abort: () => {
      state.cancelled = true;
      request.abort();
    },
  };
  activeTransfers.set(transferId, state);

  try {
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

        const writeStream = fs.createWriteStream(partialPath);
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

    await fsp.rename(partialPath, absDest);
    return { success: true, path: absDest };
  } catch (error) {
    await fsp.rm(partialPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    activeTransfers.delete(transferId);
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

function registerLocalFileHandlers({ ipcMain, shell }) {
  ipcMain.handle(
    IPC.HOME,
    wrap(async () => ({
      home: os.homedir(),
      separator: path.sep,
      platform: process.platform,
    })),
  );

  ipcMain.handle(
    IPC.LIST,
    wrap(async (_event, dirPath) => listDirectory(dirPath)),
  );

  ipcMain.handle(
    IPC.MKDIR,
    wrap(async (_event, parentPath, name) => {
      const parent = normalizeLocalPath(parentPath);
      const safeName = String(name || "").trim();
      if (
        !safeName ||
        safeName === "." ||
        safeName === ".." ||
        /[\/\\\0]/.test(safeName)
      ) {
        throw new Error("Invalid folder name");
      }
      const target = path.join(parent, safeName);
      await fsp.mkdir(target);
      return { path: target };
    }),
  );

  ipcMain.handle(
    IPC.ENSURE_DIR,
    wrap(async (_event, dirPath) => {
      const target = normalizeLocalPath(dirPath);
      await fsp.mkdir(target, { recursive: true });
      return { path: target };
    }),
  );

  ipcMain.handle(
    IPC.WALK,
    wrap(async (_event, rootPaths) => {
      if (!Array.isArray(rootPaths) || rootPaths.length === 0) {
        throw new Error("No local paths provided");
      }
      return walkPaths(rootPaths);
    }),
  );

  ipcMain.handle(
    IPC.REVEAL,
    wrap(async (_event, targetPath) => {
      shell.showItemInFolder(normalizeLocalPath(targetPath));
    }),
  );

  ipcMain.handle(
    IPC.OPEN,
    wrap(async (_event, targetPath) => {
      const error = await shell.openPath(normalizeLocalPath(targetPath));
      if (error) throw new Error(error);
    }),
  );

  ipcMain.handle(
    IPC.UPLOAD,
    wrap((event, options) => uploadLocalFile(event, options)),
  );

  ipcMain.handle(
    IPC.DOWNLOAD,
    wrap((event, options) => downloadToLocal(event, options)),
  );

  ipcMain.handle(
    IPC.CANCEL,
    wrap(async (_event, transferId) => {
      const state = activeTransfers.get(transferId);
      if (!state) return { cancelled: false };
      state.abort();
      return { cancelled: true };
    }),
  );
}

module.exports = {
  IPC,
  registerLocalFileHandlers,
  // exported for tests / reuse
  walkPaths,
  listDirectory,
};
