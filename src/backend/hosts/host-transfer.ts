import { randomUUID } from "crypto";
import { networkInterfaces } from "os";
import { performance } from "node:perf_hooks";
import type { ClientChannel } from "ssh2";
import { fileLogger } from "../utils/logger.js";
import {
  basename,
  buildPathFromSegments,
  dirname,
  getWorkingDir,
  inferPlatformFromPath,
  joinPath,
  normalizeSftpPath,
  pathsOverlap,
  sftpPathToLocalPath,
  splitPathSegments,
  type TransferPlatform,
} from "./transfer-paths.js";
import {
  buildTransferScanSummary,
  getArchiveTransferReasonKey,
  resolveArchiveTransferMethod,
  type TransferMethodPreference,
  type TransferScanSummary,
} from "./transfer-routing.js";

export type {
  TransferMethodPreference,
  TransferScanSummary,
} from "./transfer-routing.js";

export interface TransferMethodPreview {
  methodPreference: TransferMethodPreference;
  resolvedMethod: "tar" | "item_sftp";
  reasonKey: ReturnType<typeof getArchiveTransferReasonKey>;
  sourcePlatform: TransferPlatform;
  destPlatform: TransferPlatform;
  sourceHasTar: boolean;
  destHasTar: boolean;
  summary: TransferScanSummary;
}

type SFTPWrapper = import("ssh2").SFTPWrapper;

export interface SSHSessionLike {
  client: import("ssh2").Client;
  isConnected: boolean;
  lastActive: number;
  activeOperations: number;
  sftp?: SFTPWrapper;
  sftpPending?: Promise<SFTPWrapper>;
  channelOpener: { run: <T>(fn: () => Promise<T>) => Promise<T> };
  userId?: string;
  ip?: string;
  port?: number;
  transferPlatform?: TransferPlatform;
}

export interface HostTransferDeps {
  sshSessions: Record<string, SSHSessionLike>;
  getSessionSftp: (session: SSHSessionLike) => Promise<SFTPWrapper>;
  execChannel: (
    session: SSHSessionLike,
    command: string,
    callback: (err: Error | undefined, stream: ClientChannel) => void,
  ) => void;
  verifySessionOwnership: (session: SSHSessionLike, userId: string) => boolean;
  openDedicatedTransferSession: (
    browseSessionId: string,
    dedicatedSessionId: string,
    userId: string,
    transferId: string,
    options?: { allowBrowseDisconnected?: boolean },
  ) => Promise<SSHSessionLike>;
  closeDedicatedTransferSession: (sessionId: string) => void;
}

export type TransferPhase =
  | "compressing"
  | "transferring"
  | "extracting"
  | "reconnecting";
export type TransferStatus =
  | "running"
  | "success"
  | "partial"
  | "error"
  | "cancelled";
export type TransferMethod = "stream" | "tar" | "item_sftp";

export type TransferHopId =
  | "source_read"
  | "dest_sftp_write"
  | "dest_local_write";

export interface TransferHopMetrics {
  id: TransferHopId;
  bytes: number;
  /** Wall-clock span from first I/O on this hop to last I/O complete. */
  spanMs: number;
  mbPerSec: number;
}

export interface TransferTimings {
  prepareDestMs?: number;
  compressMs?: number;
  transferMs?: number;
  extractMs?: number;
  sourceDeleteMs?: number;
  totalMs?: number;
  transferBytes?: number;
  endToEndMbPerSec?: number;
  hops?: TransferHopMetrics[];
}

export interface TransferProgress {
  transferId: string;
  status: TransferStatus;
  phase: TransferPhase;
  bytesTransferred?: number;
  totalBytes?: number;
  itemsCompleted?: number;
  totalItems?: number;
  failedPaths?: string[];
  message?: string;
  method?: TransferMethod;
  sourcePaths?: string[];
  destPath?: string;
  userId?: string;
  sourceSessionId?: string;
  destSessionId?: string;
  dedicatedSourceSessionId?: string;
  dedicatedDestSessionId?: string;
  startedAt?: number;
  lastActivityAt?: number;
  reconnectingAt?: number;
  timings?: TransferTimings;
  sourceDeleted?: boolean;
  moveRequested?: boolean;
  methodPreference?: TransferMethodPreference;
  parallelSegmentCount?: number;
  /** Destination paths created or partially written before cancel. */
  destArtifacts?: string[];
  tempArchivePath?: string;
  partialDestRemaining?: boolean;
  cleanupCompleted?: boolean;
  retryable?: boolean;
  requestSnapshot?: {
    sourceSessionId: string;
    sourcePaths: string[];
    destSessionId: string;
    destPath: string;
    move?: boolean;
    methodPreference?: TransferMethodPreference;
    parallelSegmentCount?: number;
  };
}

export interface TransferRequest {
  sourceSessionId: string;
  sourcePaths: string[];
  destSessionId: string;
  destPath: string;
  move?: boolean;
  userId: string;
  methodPreference?: TransferMethodPreference;
  /** Parallel 256 MiB segment lanes for single-file SFTP copy (default 2). */
  parallelSegmentCount?: number;
}

const activeTransfers = new Map<string, TransferProgress>();
const cancelRequestedTransfers = new Set<string>();

/** In-flight pipelined SFTP reads; force-closed when the user cancels. */
interface ActiveXferControl {
  abort: (err: Error) => void;
  closeResources: () => Promise<void>;
}
const activeXferControls = new Map<string, ActiveXferControl>();
const cancelWatchdogs = new Map<string, ReturnType<typeof setTimeout>>();

class TransferCancelledError extends Error {
  constructor() {
    super("Transfer cancelled");
    this.name = "TransferCancelledError";
  }
}

class TransferStalledError extends Error {
  readonly byteOffset?: number;
  readonly segmentIndex?: number;

  constructor(byteOffset?: number, segmentIndex?: number) {
    const pos = byteOffset !== undefined ? ` at byte offset ${byteOffset}` : "";
    const seg = segmentIndex !== undefined ? ` (segment ${segmentIndex})` : "";
    super(`Transfer stalled — no data moved for 45 seconds${pos}${seg}`);
    this.name = "TransferStalledError";
    this.byteOffset = byteOffset;
    this.segmentIndex = segmentIndex;
  }
}

class TransferConnectionLostError extends Error {
  constructor(message = "Transfer SSH connection lost") {
    super(message);
    this.name = "TransferConnectionLostError";
  }
}

function throwIfCancelled(transferId: string): void {
  if (cancelRequestedTransfers.has(transferId)) {
    throw new TransferCancelledError();
  }
}

function createTransferShouldAbort(transferId: string): () => boolean {
  return () => {
    if (cancelRequestedTransfers.has(transferId)) {
      return true;
    }
    const progress = activeTransfers.get(transferId);
    return progress !== undefined && progress.status !== "running";
  };
}

export function requestTransferCancel(
  transferId: string,
  userId: string,
): boolean {
  const progress = activeTransfers.get(transferId);
  if (
    !progress ||
    progress.userId !== userId ||
    progress.status !== "running"
  ) {
    return false;
  }
  cancelRequestedTransfers.add(transferId);
  updateTransfer(transferId, { message: "Cancellation requested" });
  void forceAbortActiveXfer(transferId);

  if (!cancelWatchdogs.has(transferId)) {
    cancelWatchdogs.set(
      transferId,
      setTimeout(() => {
        cancelWatchdogs.delete(transferId);
        const current = activeTransfers.get(transferId);
        if (
          current?.status === "running" &&
          cancelRequestedTransfers.has(transferId)
        ) {
          void forceAbortActiveXfer(transferId);
          finalizeTransfer(
            transferId,
            cancelledProgressPatch(current, {
              status: "cancelled",
              phase: current.phase ?? "transferring",
              message: "Transfer cancelled by user",
              method: current.method,
              sourcePaths: current.sourcePaths,
              destPath: current.destPath,
              bytesTransferred: current.bytesTransferred,
              totalBytes: current.totalBytes,
              itemsCompleted: current.itemsCompleted,
              totalItems: current.totalItems,
              moveRequested: current.moveRequested,
              sourceDeleted: false,
            }),
          );
          fileLogger.warn("Force-finalized stuck transfer after cancel", {
            operation: "host_transfer",
            transferId,
          });
        }
      }, 8000),
    );
  }

  return true;
}

async function forceAbortActiveXfer(transferId: string): Promise<void> {
  const control = activeXferControls.get(transferId);
  if (!control) return;
  control.abort(new TransferCancelledError());
  await control.closeResources().catch(() => {});
}
const SMALL_FILE_SYNC_THRESHOLD = 10 * 1024 * 1024;
/** OpenSSH SFTP max packet payload is ~256 KiB; larger chunks cut round-trips. */
const SFTP_XFER_CHUNK_SIZE = 256 * 1024;
/** Pipelined in-flight READ requests per leg (ssh2 fastGet/fastPut default is 64). */
const SFTP_XFER_CONCURRENCY = 32;
/** Reset pipelined scheduler every segment to avoid long-run deadlocks at GiB boundaries. */
const SFTP_XFER_SEGMENT_SIZE = 256 * 1024 * 1024;
/** Files above this size use segmented copy; smaller files use a single scheduler run. */
const SFTP_XFER_SEGMENT_THRESHOLD = 32 * 1024 * 1024;
/** Per-segment attempts before giving up (sequential and parallel). */
const SFTP_SEQUENTIAL_SEGMENT_MAX_ATTEMPTS = 4;
/** Per-lane attempts in parallel mode (each opens a fresh lane SSH pair quickly). */
const SFTP_PARALLEL_SEGMENT_MAX_ATTEMPTS = 4;
/** Full copy restarts after segment exhaustion. */
const SFTP_SEQUENTIAL_COPY_MAX_ATTEMPTS = 2;
const SFTP_PARALLEL_COPY_MAX_ATTEMPTS = 2;
/** Short backoff before opening fresh dedicated SSH sessions. */
const TRANSFER_SESSION_RESET_DELAYS_MS = [1000, 2000, 3000];
const DEFAULT_PARALLEL_SEGMENT_COUNT = 2;
const MAX_PARALLEL_SEGMENT_COUNT = 8;
const TRANSFER_HANDLE_CLOSE_TIMEOUT_MS = 2500;
const HUNG_TRANSFER_MS = 90_000;
const HUNG_RECONNECTING_MS = 180_000;
const TRANSFER_PROGRESS_INTERVAL_MS = 200;
const SFTP_OPEN_READ = 0x00000001;
/** WRITE | CREATE | TRUNCATE — new file or overwrite from start. */
const SFTP_OPEN_WRITE = 0x00000002 | 0x00000008 | 0x00000010;
/** READ | WRITE | CREATE — resume into an existing partial file without truncating. */
const SFTP_OPEN_WRITE_RESUME = 0x00000001 | 0x00000002 | 0x00000008;

interface TransferReconnectContext {
  deps: HostTransferDeps;
  userId: string;
  browseSourceSessionId: string;
  browseDestSessionId: string;
  dedicatedSourceSessionId: string;
  dedicatedDestSessionId: string;
  transferId: string;
}

type TransferReconnectMeta = Omit<
  TransferReconnectContext,
  "deps" | "transferId"
>;

function buildTransferReconnectContext(
  deps: HostTransferDeps,
  transferId: string,
  meta: TransferReconnectMeta,
): TransferReconnectContext {
  return { deps, transferId, ...meta };
}

function isRecoverableTransferConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("no response from server") ||
    msg.includes("connection lost") ||
    msg.includes("not connected") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("protocol error") ||
    msg.includes("connection closed") ||
    msg.includes("channel open failure")
  );
}

function isRecoverableTransferError(err: unknown): boolean {
  return (
    err instanceof TransferStalledError ||
    err instanceof TransferConnectionLostError ||
    isRecoverableTransferConnectionError(err)
  );
}

async function probeDestResumeOffset(
  destSftp: SFTPWrapper,
  destPath: string,
  fileSize: number,
): Promise<number> {
  try {
    const destStat = await promisifySftpStat(destSftp, destPath);
    return Math.min(destStat.size, fileSize);
  } catch {
    return 0;
  }
}

function buildStreamTransferTimings(
  transferId: string,
  fileSize: number,
  prepareDestMs?: number,
): TransferTimings {
  const progress = activeTransfers.get(transferId);
  const wallStart = progress?.startedAt ?? Date.now();
  const totalMs = elapsedMs(wallStart);
  const prepare = prepareDestMs ?? progress?.timings?.prepareDestMs ?? 0;
  const dataMs = Math.max(1, totalMs - prepare);

  return {
    ...progress?.timings,
    prepareDestMs: prepare > 0 ? prepare : undefined,
    transferMs: dataMs,
    transferBytes: fileSize,
    endToEndMbPerSec: computeTransferMbPerSec(fileSize, dataMs),
    totalMs,
  };
}

async function finalizeStreamTransferIfDestAtSize(
  transferId: string,
  destSftp: SFTPWrapper,
  destPath: string,
  expectedSize: number,
  extra: Partial<TransferProgress> = {},
): Promise<boolean> {
  try {
    const destSize = await probeDestResumeOffset(
      destSftp,
      destPath,
      expectedSize,
    );
    if (destSize < expectedSize) {
      return false;
    }

    fileLogger.info("Destination file complete — finalizing transfer", {
      operation: "host_transfer_dest_complete",
      transferId,
      destSize,
      expectedSize,
    });

    finalizeTransfer(transferId, {
      status: "success",
      phase: "transferring",
      method: "stream",
      bytesTransferred: expectedSize,
      totalBytes: expectedSize,
      destPath,
      timings: buildStreamTransferTimings(transferId, expectedSize),
      ...extra,
    });
    return true;
  } catch {
    return false;
  }
}

async function tryFinalizeStreamTransferIfDestComplete(
  deps: HostTransferDeps,
  transferId: string,
  destSession: SSHSessionLike,
  destPath: string,
  expectedSize: number,
  extra: Partial<TransferProgress> = {},
): Promise<boolean> {
  try {
    const destSftp = await deps.getSessionSftp(destSession);
    return finalizeStreamTransferIfDestAtSize(
      transferId,
      destSftp,
      destPath,
      expectedSize,
      extra,
    );
  } catch {
    return false;
  }
}

async function reconnectDedicatedTransferSessions(
  ctx: TransferReconnectContext,
  parallelWorkers = 0,
): Promise<{ sourceSession: SSHSessionLike; destSession: SSHSessionLike }> {
  fileLogger.warn("Reconnecting dedicated transfer SSH sessions", {
    operation: "transfer_ssh_reconnect",
    transferId: ctx.transferId,
    parallelWorkers,
  });

  closeAllTransferSessions(ctx.deps, ctx, parallelWorkers);

  const [sourceSession, destSession] = await Promise.all([
    ctx.deps.openDedicatedTransferSession(
      ctx.browseSourceSessionId,
      ctx.dedicatedSourceSessionId,
      ctx.userId,
      ctx.transferId,
      { allowBrowseDisconnected: true },
    ),
    ctx.deps.openDedicatedTransferSession(
      ctx.browseDestSessionId,
      ctx.dedicatedDestSessionId,
      ctx.userId,
      ctx.transferId,
      { allowBrowseDisconnected: true },
    ),
  ]);

  return { sourceSession, destSession };
}

async function resetDedicatedTransferSessions(
  ctx: TransferReconnectContext,
  attempt: number,
  reason: string,
): Promise<{
  sourceSession: SSHSessionLike;
  destSession: SSHSessionLike;
  sourceSftp: SFTPWrapper;
  destSftp: SFTPWrapper;
}> {
  fileLogger.warn("Resetting transfer SSH sessions (fresh connection)", {
    operation: "transfer_session_reset",
    transferId: ctx.transferId,
    attempt,
    reason,
  });

  closeAllTransferSessions(ctx.deps, ctx, 0);

  const delayMs =
    TRANSFER_SESSION_RESET_DELAYS_MS[
      Math.min(attempt - 1, TRANSFER_SESSION_RESET_DELAYS_MS.length - 1)
    ] ?? 3000;
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  const { sourceSession, destSession } =
    await reconnectDedicatedTransferSessions(ctx, 0);
  const sourceSftp = await ctx.deps.getSessionSftp(sourceSession);
  const destSftp = await ctx.deps.getSessionSftp(destSession);

  if (ctx.transferId) {
    updateTransfer(ctx.transferId, { lastActivityAt: Date.now() });
  }

  return { sourceSession, destSession, sourceSftp, destSftp };
}

let cachedLocalAddresses: Set<string> | null = null;

function normalizeHostAddress(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed.split(":")[0] ?? trimmed;
}

function getLocalAddresses(): Set<string> {
  if (cachedLocalAddresses) return cachedLocalAddresses;

  const addresses = new Set(["127.0.0.1", "::1", "localhost"]);
  for (const ifaces of Object.values(networkInterfaces())) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (!iface.internal && iface.family === "IPv4") {
        addresses.add(iface.address.toLowerCase());
      }
    }
  }
  cachedLocalAddresses = addresses;
  return addresses;
}

export function isLocalSshEndpoint(ip?: string): boolean {
  if (!ip) return false;
  const bare = normalizeHostAddress(ip);
  if (bare === "localhost" || bare === "127.0.0.1" || bare === "::1") {
    return true;
  }
  return getLocalAddresses().has(bare);
}

function createThrottledProgress(onProgress?: (bytes: number) => void) {
  let pending = 0;
  let lastFlush = 0;

  const flush = () => {
    if (pending > 0) {
      onProgress?.(pending);
      pending = 0;
      lastFlush = Date.now();
    }
  };

  return {
    add(bytes: number) {
      pending += bytes;
      const now = Date.now();
      if (now - lastFlush >= TRANSFER_PROGRESS_INTERVAL_MS) {
        flush();
      }
    },
    flush,
  };
}

function escapeShell(s: string): string {
  return s.replace(/'/g, "'\"'\"'");
}

async function detectTransferPlatform(
  deps: HostTransferDeps,
  session: SSHSessionLike,
  pathHints: string[] = [],
): Promise<TransferPlatform> {
  if (session.transferPlatform) return session.transferPlatform;

  for (const path of pathHints) {
    const inferred = inferPlatformFromPath(path);
    if (inferred === "windows") {
      session.transferPlatform = "windows";
      return "windows";
    }
  }

  try {
    const { code } = await execCommand(deps, session, "uname -s");
    if (code === 0) {
      session.transferPlatform = "unix";
      return "unix";
    }
  } catch {
    /* not unix */
  }

  try {
    const { code } = await execCommand(
      deps,
      session,
      'cmd /c "if defined OS (exit 0) else (exit 1)"',
    );
    if (code === 0) {
      session.transferPlatform = "windows";
      return "windows";
    }
  } catch {
    /* not cmd */
  }

  try {
    const { code } = await execCommand(
      deps,
      session,
      "powershell -NoProfile -Command \"if ($IsWindows -or $env:OS -like 'Windows*') { exit 0 } else { exit 1 }\"",
    );
    if (code === 0) {
      session.transferPlatform = "windows";
      return "windows";
    }
  } catch {
    /* not powershell */
  }

  session.transferPlatform = "unix";
  return "unix";
}

function isRootOnlyPath(path: string): boolean {
  const normalized = normalizeSftpPath(path);
  return (
    normalized === "/" ||
    /^\/[A-Za-z]:$/.test(normalized) ||
    /^[A-Za-z]:$/.test(normalized)
  );
}

function isPermissionError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return (
    msg.includes("permission denied") ||
    msg.includes("eacces") ||
    msg.includes("access denied")
  );
}

function promisifySftpStat(
  sftp: SFTPWrapper,
  path: string,
): Promise<import("ssh2").Stats> {
  return new Promise((resolve, reject) => {
    sftp.stat(path, (err, stats) => {
      if (err) reject(err);
      else resolve(stats);
    });
  });
}

function promisifySftpUnlink(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(path, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function promisifySftpRmdir(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(path, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function ensureDirectoryTreeSftp(
  sftp: SFTPWrapper,
  dirPath: string,
  created: Set<string> = new Set(),
): Promise<void> {
  const normalized = normalizeSftpPath(dirPath);
  if (!normalized || isRootOnlyPath(normalized)) return;

  const { root, segments } = splitPathSegments(normalized);
  if (segments.length === 0) return;

  for (let i = 0; i < segments.length; i++) {
    const current = buildPathFromSegments(root, segments, i + 1);
    if (created.has(current)) continue;

    try {
      await promisifySftpMkdir(sftp, current, 0o755);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        try {
          const stats = await promisifySftpStat(sftp, current);
          if (!stats.isDirectory()) throw err;
        } catch {
          throw err;
        }
      }
    }
    created.add(current);
  }
}

async function deletePathSftp(sftp: SFTPWrapper, path: string): Promise<void> {
  let stats: import("ssh2").Stats;
  try {
    stats = await promisifySftpStat(sftp, path);
  } catch {
    return;
  }

  if (stats.isDirectory()) {
    const entries = await promisifySftpReaddir(sftp, path);
    for (const entry of entries) {
      if (entry.filename === "." || entry.filename === "..") continue;
      await deletePathSftp(sftp, joinPath(path, entry.filename));
    }
    await promisifySftpRmdir(sftp, path);
    return;
  }

  if (stats.isFile()) {
    await promisifySftpUnlink(sftp, path);
  }
}

function promisifySftpMkdir(
  sftp: SFTPWrapper,
  path: string,
  mode: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(path, { mode }, (err) => {
      if (err && (err as NodeJS.ErrnoException).code !== "EEXIST") {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function promisifySftpChmod(
  sftp: SFTPWrapper,
  path: string,
  mode: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.chmod(path, mode, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function promisifySftpReaddir(
  sftp: SFTPWrapper,
  path: string,
): Promise<Array<{ filename: string; attrs: import("ssh2").Stats }>> {
  return new Promise((resolve, reject) => {
    sftp.readdir(path, (err, list) => {
      if (err) reject(err);
      else resolve(list);
    });
  });
}

function execCommand(
  deps: HostTransferDeps,
  session: SSHSessionLike,
  command: string,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    deps.execChannel(session, command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let stderr = "";
      stream.on("data", () => {
        /* consume stdout */
      });
      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
      stream.on("close", (code: number) => {
        resolve({ code: code ?? 0, stderr });
      });
      stream.on("error", (streamErr: Error) => {
        reject(streamErr);
      });
    });
  });
}

async function checkTarAvailable(
  deps: HostTransferDeps,
  session: SSHSessionLike,
): Promise<boolean> {
  const platform = await detectTransferPlatform(deps, session);
  if (platform === "windows") return false;

  try {
    const { code } = await execCommand(deps, session, "command -v tar");
    return code === 0;
  } catch {
    return false;
  }
}

async function ensureDestDirectory(
  deps: HostTransferDeps,
  destSession: SSHSessionLike,
  dirPath: string,
  created: Set<string> = new Set(),
): Promise<void> {
  const destSftp = await deps.getSessionSftp(destSession);
  await ensureDirectoryTreeSftp(destSftp, dirPath, created);
}

function updateTransfer(
  transferId: string,
  patch: Partial<TransferProgress>,
): void {
  const current = activeTransfers.get(transferId);
  if (current) {
    const next: TransferProgress = { ...current, ...patch };
    if (
      patch.bytesTransferred !== undefined &&
      current.totalBytes !== undefined &&
      current.totalBytes > 0
    ) {
      next.bytesTransferred = Math.min(
        patch.bytesTransferred,
        current.totalBytes,
      );
    }
    if (
      patch.bytesTransferred !== undefined &&
      patch.bytesTransferred !== current.bytesTransferred
    ) {
      next.lastActivityAt = Date.now();
    }
    activeTransfers.set(transferId, next);
  }
}

async function closeTransferHandlesSafe(
  handles: TransferFileHandles | null | undefined,
): Promise<void> {
  if (!handles) return;
  await Promise.race([
    handles.close(),
    new Promise<void>((resolve) =>
      setTimeout(resolve, TRANSFER_HANDLE_CLOSE_TIMEOUT_MS),
    ),
  ]).catch(() => {});
}

function checkHungTransfers(): void {
  const now = Date.now();
  for (const [transferId, progress] of activeTransfers) {
    if (progress.status !== "running") continue;

    if (
      progress.method === "stream" &&
      progress.totalBytes &&
      progress.totalBytes > 0 &&
      progress.bytesTransferred !== undefined &&
      progress.bytesTransferred >= progress.totalBytes
    ) {
      fileLogger.info("Transfer progress at 100% — marking complete", {
        operation: "host_transfer_progress_complete",
        transferId,
        bytesTransferred: progress.bytesTransferred,
        totalBytes: progress.totalBytes,
      });
      finalizeTransfer(transferId, {
        status: "success",
        phase: "transferring",
        method: "stream",
        bytesTransferred: progress.totalBytes,
        totalBytes: progress.totalBytes,
        sourcePaths: progress.sourcePaths,
        destPath: progress.destPath,
        moveRequested: progress.moveRequested,
        timings: buildStreamTransferTimings(transferId, progress.totalBytes),
      });
      continue;
    }

    if (progress.phase === "reconnecting") {
      const reconnectStarted =
        progress.reconnectingAt ?? progress.lastActivityAt ?? now;
      if (now - reconnectStarted < HUNG_RECONNECTING_MS) continue;
    }

    const lastActivity = progress.lastActivityAt ?? progress.startedAt ?? now;
    if (now - lastActivity < HUNG_TRANSFER_MS) continue;

    fileLogger.error("Force-finalizing unresponsive transfer", {
      operation: "host_transfer_hung",
      transferId,
      lastActivityAt: lastActivity,
      bytesTransferred: progress.bytesTransferred,
    });

    finalizeTransfer(
      transferId,
      failedProgressPatch(progress, {
        status: "error",
        phase:
          progress.phase === "reconnecting" ? "transferring" : progress.phase,
        message: "Transfer stopped responding",
        method: progress.method,
        sourcePaths: progress.sourcePaths,
        destPath: progress.destPath,
        bytesTransferred: Math.min(
          progress.bytesTransferred ?? 0,
          progress.totalBytes ?? Number.MAX_SAFE_INTEGER,
        ),
        totalBytes: progress.totalBytes,
        itemsCompleted: progress.itemsCompleted,
        totalItems: progress.totalItems,
        moveRequested: progress.moveRequested,
      }),
    );
  }
}

/** Before marking a stalled stream transfer as failed, verify the destination file size. */
export async function probeHungStreamTransfers(
  deps: HostTransferDeps,
): Promise<void> {
  const now = Date.now();
  for (const [transferId, progress] of activeTransfers) {
    if (progress.status !== "running" || progress.method !== "stream") {
      continue;
    }
    if (!progress.destPath || !progress.totalBytes || !progress.userId) {
      continue;
    }

    const lastActivity = progress.lastActivityAt ?? progress.startedAt ?? now;
    if (now - lastActivity < HUNG_TRANSFER_MS) {
      continue;
    }

    const browseDestId = progress.destSessionId;
    if (!browseDestId) {
      continue;
    }

    const destId = progress.dedicatedDestSessionId ?? `xfer:${transferId}:dst`;
    let destSession = deps.sshSessions[destId];
    if (!destSession?.isConnected) {
      try {
        destSession = await deps.openDedicatedTransferSession(
          browseDestId,
          destId,
          progress.userId,
          transferId,
          { allowBrowseDisconnected: true },
        );
      } catch {
        continue;
      }
    }

    await tryFinalizeStreamTransferIfDestComplete(
      deps,
      transferId,
      destSession,
      progress.destPath,
      progress.totalBytes,
      {
        sourcePaths: progress.sourcePaths,
        moveRequested: progress.moveRequested,
      },
    );
  }
}

function trackDestArtifact(transferId: string, path: string): void {
  const normalized = normalizeSftpPath(path);
  const current = activeTransfers.get(transferId);
  if (!current) return;
  const existing = current.destArtifacts ?? [];
  if (existing.includes(normalized)) return;
  updateTransfer(transferId, { destArtifacts: [...existing, normalized] });
}

function buildCleanupPaths(progress: TransferProgress): string[] {
  const paths = new Set<string>(progress.destArtifacts ?? []);

  if (progress.tempArchivePath) {
    paths.add(normalizeSftpPath(progress.tempArchivePath));
  }

  if (paths.size === 0 && progress.destPath) {
    if (progress.method === "stream") {
      paths.add(normalizeSftpPath(progress.destPath));
    } else if (progress.sourcePaths?.length) {
      for (const sourcePath of progress.sourcePaths) {
        paths.add(
          normalizeSftpPath(joinPath(progress.destPath, basename(sourcePath))),
        );
      }
    }
  }

  return [...paths];
}

function partialDestWasWritten(progress: TransferProgress): boolean {
  return (
    (progress.bytesTransferred ?? 0) > 0 ||
    (progress.itemsCompleted ?? 0) > 0 ||
    (progress.destArtifacts?.length ?? 0) > 0
  );
}

function failedProgressPatch(
  current: TransferProgress | undefined,
  patch: Partial<TransferProgress>,
): Partial<TransferProgress> {
  const merged = { ...current, ...patch } as TransferProgress;
  const hasPartial = partialDestWasWritten(merged);
  return {
    ...patch,
    partialDestRemaining: hasPartial,
    retryable: hasPartial && !!current?.requestSnapshot,
  };
}

function cancelledProgressPatch(
  current: TransferProgress | undefined,
  patch: Partial<TransferProgress>,
): Partial<TransferProgress> {
  const merged = { ...current, ...patch } as TransferProgress;
  return {
    ...patch,
    partialDestRemaining: partialDestWasWritten(merged),
  };
}

function finalizeTransfer(
  transferId: string,
  patch: Partial<TransferProgress>,
): TransferProgress {
  cancelRequestedTransfers.delete(transferId);
  const watchdog = cancelWatchdogs.get(transferId);
  if (watchdog) {
    clearTimeout(watchdog);
    cancelWatchdogs.delete(transferId);
  }
  const current = activeTransfers.get(transferId);
  const result: TransferProgress = {
    transferId,
    status: "success",
    phase: "transferring",
    ...current,
    ...patch,
  };
  activeTransfers.set(transferId, result);
  return result;
}

function elapsedMs(start: number): number {
  return Date.now() - start;
}

export function computeTransferMbPerSec(
  bytes: number,
  ms: number,
): number | undefined {
  if (ms <= 0 || bytes <= 0) return undefined;
  return ((bytes / ms) * 1000) / (1024 * 1024);
}

interface HopWallClock {
  firstAt: number | null;
  lastAt: number | null;
}

function createHopWallClock(): HopWallClock {
  return { firstAt: null, lastAt: null };
}

function noteHopStart(
  clock: HopWallClock,
  t: number = performance.now(),
): void {
  if (clock.firstAt === null) clock.firstAt = t;
}

function noteHopEnd(clock: HopWallClock, t: number = performance.now()): void {
  clock.lastAt = t;
}

function hopSpanMs(clock: HopWallClock): number {
  if (clock.firstAt === null || clock.lastAt === null) return 0;
  return Math.max(0, clock.lastAt - clock.firstAt);
}

interface PipelinedXferStats {
  bytes: number;
  sourceReadSpanMs: number;
  destWriteSpanMs: number;
  destWriteKind: "sftp" | "local";
}

function createEmptyXferStats(): PipelinedXferStats {
  return {
    bytes: 0,
    sourceReadSpanMs: 0,
    destWriteSpanMs: 0,
    destWriteKind: "sftp",
  };
}

function mergeXferStats(
  target: PipelinedXferStats,
  source: PipelinedXferStats,
): void {
  target.bytes += source.bytes;
  target.sourceReadSpanMs += source.sourceReadSpanMs;
  target.destWriteSpanMs += source.destWriteSpanMs;
  target.destWriteKind = source.destWriteKind;
}

function buildTransferHopTimings(
  stats: PipelinedXferStats,
  transferMs: number,
): Pick<TransferTimings, "transferBytes" | "endToEndMbPerSec" | "hops"> {
  const hops: TransferHopMetrics[] = [];

  const sourceRate = computeTransferMbPerSec(
    stats.bytes,
    stats.sourceReadSpanMs,
  );
  if (sourceRate !== undefined) {
    hops.push({
      id: "source_read",
      bytes: stats.bytes,
      spanMs: stats.sourceReadSpanMs,
      mbPerSec: sourceRate,
    });
  }

  const destHopId: TransferHopId =
    stats.destWriteKind === "local" ? "dest_local_write" : "dest_sftp_write";
  const destRate = computeTransferMbPerSec(stats.bytes, stats.destWriteSpanMs);
  if (destRate !== undefined) {
    hops.push({
      id: destHopId,
      bytes: stats.bytes,
      spanMs: stats.destWriteSpanMs,
      mbPerSec: destRate,
    });
  }

  return {
    transferBytes: stats.bytes,
    endToEndMbPerSec: computeTransferMbPerSec(stats.bytes, transferMs),
    hops,
  };
}

async function deleteSourcePathsAfterSuccess(
  deps: HostTransferDeps,
  transferId: string,
  sourceSession: SSHSessionLike,
  sourcePaths: string[],
): Promise<number> {
  const deleteStart = Date.now();
  await deleteSourcePaths(deps, sourceSession, sourcePaths);
  const sourceDeleteMs = elapsedMs(deleteStart);
  updateTransfer(transferId, {
    sourceDeleted: true,
    timings: {
      ...activeTransfers.get(transferId)?.timings,
      sourceDeleteMs,
    },
  });
  return sourceDeleteMs;
}

async function ensureDestParentForFile(
  deps: HostTransferDeps,
  destSession: SSHSessionLike,
  filePath: string,
): Promise<void> {
  const parent = dirname(filePath);
  if (!parent || isRootOnlyPath(parent)) return;
  await ensureDestDirectory(deps, destSession, parent);
}

interface FileWorkItem {
  sourcePath: string;
  destPath: string;
  mode: number;
  size: number;
}

async function collectFileWorkItems(
  sftp: SFTPWrapper,
  sourcePath: string,
  destRoot: string,
  destBaseName?: string,
): Promise<FileWorkItem[]> {
  const stats = await promisifySftpStat(sftp, sourcePath);
  const name = destBaseName ?? basename(sourcePath);
  const destPath = joinPath(destRoot, name);

  if (stats.isFile()) {
    return [
      {
        sourcePath,
        destPath,
        mode: stats.mode & 0o7777,
        size: stats.size,
      },
    ];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  const items: FileWorkItem[] = [];
  const walk = async (srcDir: string, dstDir: string) => {
    const entries = await promisifySftpReaddir(sftp, srcDir);
    for (const entry of entries) {
      if (entry.filename === "." || entry.filename === "..") continue;
      const srcChild = joinPath(srcDir, entry.filename);
      const dstChild = joinPath(dstDir, entry.filename);

      if (entry.attrs.isDirectory()) {
        await walk(srcChild, dstChild);
      } else if (entry.attrs.isFile()) {
        items.push({
          sourcePath: srcChild,
          destPath: dstChild,
          mode: entry.attrs.mode & 0o7777,
          size: entry.attrs.size,
        });
      }
    }
  };

  await walk(sourcePath, destPath);
  return items;
}

async function scanSourcePathsForRouting(
  sftp: SFTPWrapper,
  sourcePaths: string[],
  transferId: string,
) {
  const scanItems: Array<{ sourcePath: string; size: number }> = [];
  for (const sourcePath of sourcePaths) {
    throwIfCancelled(transferId);
    const work = await collectFileWorkItems(sftp, sourcePath, "/");
    scanItems.push(
      ...work.map((w) => ({ sourcePath: w.sourcePath, size: w.size })),
    );
  }
  return buildTransferScanSummary(scanItems);
}

function promisifySftpOpen(
  sftp: SFTPWrapper,
  path: string,
  flags: number,
  mode: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.open(path, flags, mode, (err, handle) => {
      if (err) reject(err);
      else resolve(handle);
    });
  });
}

function promisifySftpClose(sftp: SFTPWrapper, handle: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.close(handle, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function promisifySftpFstat(
  sftp: SFTPWrapper,
  handle: Buffer,
): Promise<import("ssh2").Stats> {
  return new Promise((resolve, reject) => {
    sftp.fstat(handle, (err, stats) => {
      if (err) reject(err);
      else resolve(stats);
    });
  });
}

interface PipelinedXferOptions {
  fileSize?: number;
  initialOffset?: number;
  parallelSegmentCount?: number;
  onProgress?: (bytes: number) => void;
  shouldAbort?: () => boolean;
  transferId?: string;
  segmentIndex?: number;
  reconnect?: TransferReconnectContext;
  onResumeOffset?: (offset: number) => void;
}

interface SegmentCopyJob {
  offset: number;
  length: number;
  segmentIndex: number;
}

function clampParallelSegmentCount(value?: number): number {
  const n = value ?? DEFAULT_PARALLEL_SEGMENT_COUNT;
  return Math.max(1, Math.min(MAX_PARALLEL_SEGMENT_COUNT, Math.floor(n)));
}

function buildSegmentCopyJobs(
  fileSize: number,
  initialOffset: number,
  destResumeSize: number,
): SegmentCopyJob[] {
  const jobs: SegmentCopyJob[] = [];
  for (
    let offset = initialOffset;
    offset < fileSize;
    offset += SFTP_XFER_SEGMENT_SIZE
  ) {
    const length = Math.min(SFTP_XFER_SEGMENT_SIZE, fileSize - offset);
    const segmentIndex = Math.floor(offset / SFTP_XFER_SEGMENT_SIZE);
    if (destResumeSize >= offset + length) {
      continue;
    }
    const start = destResumeSize > offset ? destResumeSize : offset;
    jobs.push({
      offset: start,
      length: offset + length - start,
      segmentIndex,
    });
  }
  return jobs;
}

function closeAllTransferSessions(
  deps: HostTransferDeps,
  ctx: TransferReconnectContext,
  parallelWorkers: number,
): void {
  deps.closeDedicatedTransferSession(ctx.dedicatedSourceSessionId);
  deps.closeDedicatedTransferSession(ctx.dedicatedDestSessionId);
  for (let i = 0; i < parallelWorkers; i++) {
    deps.closeDedicatedTransferSession(`${ctx.dedicatedSourceSessionId}:p${i}`);
    deps.closeDedicatedTransferSession(`${ctx.dedicatedDestSessionId}:p${i}`);
  }
}

interface TransferFileHandles {
  sourceSftp: SFTPWrapper;
  destSftp: SFTPWrapper;
  srcHandle: Buffer;
  dstHandle: Buffer;
  close: () => Promise<void>;
}

async function openTransferFileHandles(
  sourceSftp: SFTPWrapper,
  destSftp: SFTPWrapper,
  sourcePath: string,
  destPath: string,
  resume: boolean,
): Promise<TransferFileHandles> {
  const srcHandle = await promisifySftpOpen(
    sourceSftp,
    sourcePath,
    SFTP_OPEN_READ,
    0o666,
  );
  const dstHandle = await promisifySftpOpen(
    destSftp,
    destPath,
    resume ? SFTP_OPEN_WRITE_RESUME : SFTP_OPEN_WRITE,
    0o666,
  );

  return {
    sourceSftp,
    destSftp,
    srcHandle,
    dstHandle,
    close: async () => {
      await promisifySftpClose(sourceSftp, srcHandle).catch(() => {});
      await promisifySftpClose(destSftp, dstHandle).catch(() => {});
    },
  };
}

/**
 * Parallel SFTP copy using the same scheduling model as ssh2's fastXfer.
 * Scoped to [fileBaseOffset, fileBaseOffset + byteLength) so callers can reset
 * scheduler state between segments on large files.
 */
async function runFastSftpCopy(
  sourceSftp: SFTPWrapper,
  srcHandle: Buffer,
  destSftp: SFTPWrapper,
  dstHandle: Buffer,
  byteLength: number,
  fileBaseOffset: number,
  options: PipelinedXferOptions,
  sourceReadClock: ReturnType<typeof createHopWallClock>,
  destWriteClock: ReturnType<typeof createHopWallClock>,
): Promise<void> {
  let concurrency = SFTP_XFER_CONCURRENCY;
  let chunkSize = SFTP_XFER_CHUNK_SIZE;
  let bufsize = chunkSize * concurrency;
  while (bufsize > byteLength && concurrency > 1) {
    bufsize -= chunkSize;
    concurrency -= 1;
  }
  if (byteLength <= chunkSize) {
    chunkSize = byteLength;
    concurrency = 1;
    bufsize = byteLength;
  }

  const readbuf = Buffer.alloc(bufsize);
  const progress = createThrottledProgress(options.onProgress);
  let lastActivity = Date.now();
  let stallTimer: ReturnType<typeof setInterval> | undefined;

  await new Promise<void>((resolve, reject) => {
    let finished = false;
    let hadError = false;
    let pdst = 0;
    let total = 0;

    const fail = (err: Error) => {
      if (hadError) return;
      hadError = true;
      finished = true;
      progress.flush();
      reject(err);
    };

    const succeed = () => {
      if (finished) return;
      finished = true;
      progress.flush();
      resolve();
    };

    stallTimer = setInterval(() => {
      if (finished) return;
      if (options.shouldAbort?.()) {
        fail(new TransferCancelledError());
        return;
      }
      if (Date.now() - lastActivity > 45000) {
        fail(
          new TransferStalledError(
            fileBaseOffset + total,
            options.segmentIndex,
          ),
        );
      }
    }, 10000);

    const onread = (
      err: Error | undefined,
      nb: number,
      _data: Buffer | undefined,
      localDstPos: number,
      datapos: number,
      origChunkLen: number,
    ) => {
      if (err) {
        fail(err);
        return;
      }
      if (options.shouldAbort?.()) {
        fail(new TransferCancelledError());
        return;
      }

      noteHopStart(destWriteClock);
      destSftp.write(
        dstHandle,
        readbuf,
        datapos,
        nb,
        fileBaseOffset + localDstPos,
        (writeErr: Error | undefined) => {
          noteHopEnd(destWriteClock);
          if (writeErr) {
            fail(writeErr);
            return;
          }

          total += nb;
          progress.add(nb);
          lastActivity = Date.now();

          if (options.shouldAbort?.()) {
            fail(new TransferCancelledError());
            return;
          }

          if (nb < origChunkLen) {
            singleRead(datapos, localDstPos + nb, origChunkLen - nb);
            return;
          }

          if (total >= byteLength) {
            succeed();
            return;
          }

          if (pdst >= byteLength) {
            return;
          }

          const chunk = Math.min(chunkSize, byteLength - pdst);
          singleRead(datapos, pdst, chunk);
          pdst += chunk;
        },
      );
    };

    const makeCb =
      (psrc: number, localFilePos: number, chunk: number) =>
      (err: Error | undefined, nb?: number, data?: Buffer) => {
        onread(err, nb ?? 0, data, localFilePos, psrc, chunk);
      };

    const singleRead = (psrc: number, localFilePos: number, chunk: number) => {
      if (options.shouldAbort?.()) {
        fail(new TransferCancelledError());
        return;
      }
      noteHopStart(sourceReadClock);
      sourceSftp.read(
        srcHandle,
        readbuf,
        psrc,
        chunk,
        fileBaseOffset + localFilePos,
        (err, nb, data) => {
          noteHopEnd(sourceReadClock);
          makeCb(psrc, localFilePos, chunk)(err, nb, data);
        },
      );
    };

    const startReads = () => {
      let reads = 0;
      let psrc = 0;
      while (pdst < byteLength && reads < concurrency) {
        const chunk = Math.min(chunkSize, byteLength - pdst);
        singleRead(psrc, pdst, chunk);
        psrc += chunk;
        pdst += chunk;
        reads += 1;
      }
    };

    startReads();
  }).finally(() => {
    if (stallTimer) clearInterval(stallTimer);
  });
}

async function runFastSftpCopySegmented(
  handles: TransferFileHandles,
  fileSize: number,
  options: PipelinedXferOptions,
  sourceReadClock: ReturnType<typeof createHopWallClock>,
  destWriteClock: ReturnType<typeof createHopWallClock>,
  sourcePath: string,
  destPath: string,
): Promise<TransferFileHandles> {
  const parallel = clampParallelSegmentCount(options.parallelSegmentCount);
  if (parallel > 1 && options.reconnect) {
    return runFastSftpCopySegmentedParallel(
      handles,
      fileSize,
      { ...options, parallelSegmentCount: parallel },
      sourceReadClock,
      destWriteClock,
      sourcePath,
      destPath,
    );
  }
  return runFastSftpCopySegmentedSequential(
    handles,
    fileSize,
    options,
    sourceReadClock,
    destWriteClock,
    sourcePath,
    destPath,
  );
}

async function runFastSftpCopySegmentedSequential(
  handles: TransferFileHandles,
  fileSize: number,
  options: PipelinedXferOptions,
  sourceReadClock: ReturnType<typeof createHopWallClock>,
  destWriteClock: ReturnType<typeof createHopWallClock>,
  sourcePath: string,
  destPath: string,
): Promise<TransferFileHandles> {
  const transferId = options.transferId;
  const segmentCount = Math.ceil(fileSize / SFTP_XFER_SEGMENT_SIZE);
  let offset = options.initialOffset ?? 0;
  let currentHandles = handles;

  while (offset < fileSize) {
    if (options.shouldAbort?.()) {
      throw new TransferCancelledError();
    }

    let segLen = Math.min(SFTP_XFER_SEGMENT_SIZE, fileSize - offset);
    const segmentIndex = Math.floor(offset / SFTP_XFER_SEGMENT_SIZE);
    let attempts = 0;

    while (true) {
      fileLogger.info("Transfer segment started", {
        operation: "host_transfer_segment",
        transferId,
        segmentIndex,
        segmentCount,
        fileBaseOffset: offset,
        byteLength: segLen,
        attempt: attempts + 1,
      });

      try {
        await runFastSftpCopy(
          currentHandles.sourceSftp,
          currentHandles.srcHandle,
          currentHandles.destSftp,
          currentHandles.dstHandle,
          segLen,
          offset,
          { ...options, segmentIndex },
          sourceReadClock,
          destWriteClock,
        );

        fileLogger.info("Transfer segment completed", {
          operation: "host_transfer_segment",
          transferId,
          segmentIndex,
          segmentCount,
          fileBaseOffset: offset,
          byteLength: segLen,
        });

        offset += segLen;
        break;
      } catch (err) {
        if (err instanceof TransferCancelledError) {
          throw err;
        }

        const message =
          err instanceof Error ? err.message : "Segment transfer failed";
        const recoverable =
          options.reconnect &&
          isRecoverableTransferError(err) &&
          attempts < SFTP_SEQUENTIAL_SEGMENT_MAX_ATTEMPTS;

        fileLogger.error("Transfer segment failed", err, {
          operation: "host_transfer_segment",
          transferId,
          segmentIndex,
          fileBaseOffset: offset,
          byteLength: segLen,
          attempt: attempts + 1,
          maxAttempts: SFTP_SEQUENTIAL_SEGMENT_MAX_ATTEMPTS,
          recoverable,
        });

        if (!recoverable || !options.reconnect) {
          throw new Error(
            `Segment ${segmentIndex} failed at offset ${offset}: ${message}`,
          );
        }

        attempts += 1;
        await closeTransferHandlesSafe(currentHandles);

        const { sourceSftp, destSftp } = await resetDedicatedTransferSessions(
          options.reconnect,
          attempts,
          message,
        );

        let resumeOffset = offset;
        try {
          resumeOffset = await probeDestResumeOffset(
            destSftp,
            destPath,
            fileSize,
          );
        } catch {
          /* use last known offset */
        }

        if (resumeOffset > offset) {
          fileLogger.info("Resuming transfer from destination size", {
            operation: "host_transfer_resume",
            transferId,
            previousOffset: offset,
            resumeOffset,
            fileSize,
          });
          offset = resumeOffset;
          options.onResumeOffset?.(offset);
        }

        if (offset >= fileSize) {
          break;
        }

        segLen = Math.min(SFTP_XFER_SEGMENT_SIZE, fileSize - offset);
        currentHandles = await openTransferFileHandles(
          sourceSftp,
          destSftp,
          sourcePath,
          destPath,
          offset > 0,
        );
      }
    }
  }

  return currentHandles;
}

interface WorkerSessionCache {
  sourceSession: SSHSessionLike;
  destSession: SSHSessionLike;
  sourceSftp: SFTPWrapper;
  destSftp: SFTPWrapper;
}

async function runFastSftpCopySegmentedParallel(
  handles: TransferFileHandles,
  fileSize: number,
  options: PipelinedXferOptions,
  sourceReadClock: ReturnType<typeof createHopWallClock>,
  destWriteClock: ReturnType<typeof createHopWallClock>,
  sourcePath: string,
  destPath: string,
): Promise<TransferFileHandles> {
  const transferId = options.transferId;
  const parallel = clampParallelSegmentCount(options.parallelSegmentCount);
  const initialOffset = options.initialOffset ?? 0;
  const reconnect = options.reconnect!;

  let destResumeSize = initialOffset;
  try {
    destResumeSize = await probeDestResumeOffset(
      handles.destSftp,
      destPath,
      fileSize,
    );
  } catch {
    /* use initial offset */
  }

  const jobs = buildSegmentCopyJobs(fileSize, initialOffset, destResumeSize);
  if (jobs.length === 0) {
    options.onResumeOffset?.(fileSize);
    return handles;
  }

  fileLogger.info("Starting parallel segment transfer", {
    operation: "host_transfer_parallel",
    transferId,
    parallel,
    segmentJobs: jobs.length,
    fileSize,
    destResumeSize,
  });

  updateTransfer(transferId ?? "", {
    parallelSegmentCount: parallel,
    bytesTransferred: destResumeSize,
  });
  options.onResumeOffset?.(destResumeSize);

  let aggregateBytes = destResumeSize;
  let lastDestProbeAt = 0;
  const DEST_PROGRESS_PROBE_MS = 1500;

  const refreshDestProgress = async (force = false): Promise<number> => {
    const now = Date.now();
    if (!force && now - lastDestProbeAt < DEST_PROGRESS_PROBE_MS) {
      return aggregateBytes;
    }
    lastDestProbeAt = now;
    try {
      const size = await probeDestResumeOffset(
        handles.destSftp,
        destPath,
        fileSize,
      );
      if (size > aggregateBytes) {
        aggregateBytes = size;
      } else if (force) {
        aggregateBytes = size;
      }
      options.onResumeOffset?.(aggregateBytes);
      if (transferId) {
        updateTransfer(transferId, { bytesTransferred: aggregateBytes });
      }
    } catch {
      /* keep last known progress */
    }
    return aggregateBytes;
  };

  /** Parallel lanes share one dest file — use dest size, not summed segment deltas. */
  const reportDelta = (_delta: number) => {
    void refreshDestProgress(false);
  };

  let nextJobIndex = 0;
  const workerCaches = new Map<number, WorkerSessionCache>();

  const resetParallelLane = async (
    workerId: number,
    attempt: number,
    reason: string,
  ): Promise<void> => {
    fileLogger.warn("Resetting parallel transfer lane (fresh SSH session)", {
      operation: "transfer_lane_reset",
      transferId: reconnect.transferId,
      parallelLane: workerId,
      attempt,
      reason,
    });
    workerCaches.delete(workerId);
    reconnect.deps.closeDedicatedTransferSession(
      `${reconnect.dedicatedSourceSessionId}:p${workerId}`,
    );
    reconnect.deps.closeDedicatedTransferSession(
      `${reconnect.dedicatedDestSessionId}:p${workerId}`,
    );
    const delayMs =
      TRANSFER_SESSION_RESET_DELAYS_MS[
        Math.min(attempt - 1, TRANSFER_SESSION_RESET_DELAYS_MS.length - 1)
      ] ?? 3000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  };

  const ensureWorkerSessions = async (
    workerId: number,
  ): Promise<WorkerSessionCache> => {
    const cached = workerCaches.get(workerId);
    if (cached) return cached;

    const srcId = `${reconnect.dedicatedSourceSessionId}:p${workerId}`;
    const dstId = `${reconnect.dedicatedDestSessionId}:p${workerId}`;
    const sourceSession = await reconnect.deps.openDedicatedTransferSession(
      reconnect.browseSourceSessionId,
      srcId,
      reconnect.userId,
      reconnect.transferId,
      { allowBrowseDisconnected: true },
    );
    const destSession = await reconnect.deps.openDedicatedTransferSession(
      reconnect.browseDestSessionId,
      dstId,
      reconnect.userId,
      reconnect.transferId,
      { allowBrowseDisconnected: true },
    );
    const sourceSftp = await reconnect.deps.getSessionSftp(sourceSession);
    const destSftp = await reconnect.deps.getSessionSftp(destSession);
    const entry: WorkerSessionCache = {
      sourceSession,
      destSession,
      sourceSftp,
      destSftp,
    };
    workerCaches.set(workerId, entry);
    return entry;
  };

  const runSegmentJob = async (
    job: SegmentCopyJob,
    workerId: number,
  ): Promise<void> => {
    let attempts = 0;

    while (true) {
      if (options.shouldAbort?.()) {
        throw new TransferCancelledError();
      }

      fileLogger.info("Transfer segment started", {
        operation: "host_transfer_segment",
        transferId,
        segmentIndex: job.segmentIndex,
        fileBaseOffset: job.offset,
        byteLength: job.length,
        attempt: attempts + 1,
        parallelLane: workerId,
      });

      const { sourceSftp, destSftp } = await ensureWorkerSessions(workerId);
      const laneHandles = await openTransferFileHandles(
        sourceSftp,
        destSftp,
        sourcePath,
        destPath,
        job.offset > 0,
      );

      try {
        await runFastSftpCopy(
          laneHandles.sourceSftp,
          laneHandles.srcHandle,
          laneHandles.destSftp,
          laneHandles.dstHandle,
          job.length,
          job.offset,
          {
            ...options,
            segmentIndex: job.segmentIndex,
            onProgress: reportDelta,
          },
          sourceReadClock,
          destWriteClock,
        );

        fileLogger.info("Transfer segment completed", {
          operation: "host_transfer_segment",
          transferId,
          segmentIndex: job.segmentIndex,
          fileBaseOffset: job.offset,
          byteLength: job.length,
          parallelLane: workerId,
        });

        await closeTransferHandlesSafe(laneHandles);
        await refreshDestProgress(true);
        return;
      } catch (err) {
        await closeTransferHandlesSafe(laneHandles);

        if (err instanceof TransferCancelledError) {
          throw err;
        }

        const message =
          err instanceof Error ? err.message : "Segment transfer failed";
        const recoverable =
          isRecoverableTransferError(err) &&
          attempts < SFTP_PARALLEL_SEGMENT_MAX_ATTEMPTS;

        fileLogger.error("Transfer segment failed", err, {
          operation: "host_transfer_segment",
          transferId,
          segmentIndex: job.segmentIndex,
          fileBaseOffset: job.offset,
          byteLength: job.length,
          attempt: attempts + 1,
          maxAttempts: SFTP_PARALLEL_SEGMENT_MAX_ATTEMPTS,
          recoverable,
          parallelLane: workerId,
        });

        if (!recoverable) {
          if (
            transferId &&
            (await finalizeStreamTransferIfDestAtSize(
              transferId,
              handles.destSftp,
              destPath,
              fileSize,
            ))
          ) {
            return;
          }
          throw new Error(
            `Segment ${job.segmentIndex} failed at offset ${job.offset}: ${message}`,
          );
        }

        attempts += 1;
        await resetParallelLane(workerId, attempts, message);
        await refreshDestProgress(true);
      }
    }
  };

  const runWorker = async (workerId: number) => {
    while (true) {
      if (options.shouldAbort?.()) {
        throw new TransferCancelledError();
      }

      const jobIndex = nextJobIndex;
      nextJobIndex += 1;
      if (jobIndex >= jobs.length) {
        return;
      }

      await runSegmentJob(jobs[jobIndex], workerId);
    }
  };

  try {
    await Promise.all(
      Array.from({ length: parallel }, (_, workerId) => runWorker(workerId)),
    );
    await refreshDestProgress(true);
  } finally {
    workerCaches.clear();
    for (let i = 0; i < parallel; i++) {
      reconnect.deps.closeDedicatedTransferSession(
        `${reconnect.dedicatedSourceSessionId}:p${i}`,
      );
      reconnect.deps.closeDedicatedTransferSession(
        `${reconnect.dedicatedDestSessionId}:p${i}`,
      );
    }
  }

  options.onResumeOffset?.(fileSize);
  return handles;
}

function promisifyFastGet(
  sftp: SFTPWrapper,
  remotePath: string,
  localPath: string,
  opts: {
    concurrency?: number;
    chunkSize?: number;
    fileSize?: number;
    step?: (totalTransferred: number, chunk: number, total: number) => void;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, opts, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function pipelinedSftpFile(
  sourceSftp: SFTPWrapper,
  destSftp: SFTPWrapper,
  sourcePath: string,
  destPath: string,
  options: PipelinedXferOptions = {},
): Promise<PipelinedXferStats> {
  let fileSize = options.fileSize ?? 0;
  const stats = createEmptyXferStats();
  stats.destWriteKind = "sftp";

  let handles: TransferFileHandles | null = null;
  const transferId = options.transferId;

  try {
    if (!fileSize) {
      const srcProbe = await promisifySftpOpen(
        sourceSftp,
        sourcePath,
        SFTP_OPEN_READ,
        0o666,
      );
      try {
        const fstats = await promisifySftpFstat(sourceSftp, srcProbe);
        fileSize = fstats.size;
      } finally {
        await promisifySftpClose(sourceSftp, srcProbe).catch(() => {});
      }
    }
    if (fileSize <= 0) return stats;

    stats.bytes = fileSize;

    const sourceReadClock = createHopWallClock();
    const destWriteClock = createHopWallClock();

    const runCopyWithRetry = async (): Promise<void> => {
      let attempts = 0;
      let sftpSource = sourceSftp;
      let sftpDest = destSftp;
      const parallelLanes = clampParallelSegmentCount(
        options.parallelSegmentCount,
      );
      const isParallelCopy = parallelLanes > 1;
      const maxCopyAttempts = isParallelCopy
        ? SFTP_PARALLEL_COPY_MAX_ATTEMPTS
        : SFTP_SEQUENTIAL_COPY_MAX_ATTEMPTS;

      while (true) {
        const resumeOffset = await probeDestResumeOffset(
          sftpDest,
          destPath,
          fileSize,
        );
        if (resumeOffset >= fileSize) {
          options.onResumeOffset?.(resumeOffset);
          return;
        }
        if (resumeOffset > 0) {
          options.onResumeOffset?.(resumeOffset);
          if (attempts === 0) {
            fileLogger.info("Resuming transfer from destination size", {
              operation: "host_transfer_resume",
              transferId,
              resumeOffset,
              fileSize,
            });
          }
        }

        try {
          if (handles) {
            await handles.close().catch(() => {});
          }
          handles = await openTransferFileHandles(
            sftpSource,
            sftpDest,
            sourcePath,
            destPath,
            resumeOffset > 0,
          );

          if (fileSize <= SFTP_XFER_SEGMENT_THRESHOLD) {
            await runFastSftpCopy(
              handles.sourceSftp,
              handles.srcHandle,
              handles.destSftp,
              handles.dstHandle,
              fileSize - resumeOffset,
              resumeOffset,
              options,
              sourceReadClock,
              destWriteClock,
            );
          } else {
            handles = await runFastSftpCopySegmented(
              handles,
              fileSize,
              { ...options, initialOffset: resumeOffset },
              sourceReadClock,
              destWriteClock,
              sourcePath,
              destPath,
            );
          }
          return;
        } catch (err) {
          if (err instanceof TransferCancelledError) {
            throw err;
          }

          const recoverable =
            options.reconnect &&
            isRecoverableTransferError(err) &&
            attempts < maxCopyAttempts;

          fileLogger.error("Transfer copy attempt failed", err, {
            operation: "host_transfer_copy",
            transferId,
            attempt: attempts + 1,
            maxAttempts: maxCopyAttempts,
            recoverable,
            parallelLanes: isParallelCopy ? parallelLanes : undefined,
          });

          if (!recoverable || !options.reconnect) {
            if (
              transferId &&
              (await finalizeStreamTransferIfDestAtSize(
                transferId,
                sftpDest,
                destPath,
                fileSize,
              ))
            ) {
              return;
            }
            throw err;
          }

          attempts += 1;
          await closeTransferHandlesSafe(handles);

          if (isParallelCopy) {
            closeAllTransferSessions(
              options.reconnect.deps,
              options.reconnect,
              parallelLanes,
            );
            const delayMs =
              TRANSFER_SESSION_RESET_DELAYS_MS[
                Math.min(
                  attempts - 1,
                  TRANSFER_SESSION_RESET_DELAYS_MS.length - 1,
                )
              ] ?? 3000;
            fileLogger.warn(
              "Restarting parallel copy after segment exhaustion",
              {
                operation: "host_transfer_parallel_restart",
                transferId,
                attempt: attempts,
                delayMs,
              },
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          } else {
            const reset = await resetDedicatedTransferSessions(
              options.reconnect,
              attempts,
              err instanceof Error ? err.message : "copy failed",
            );
            sftpSource = reset.sourceSftp;
            sftpDest = reset.destSftp;
          }
        }
      }
    };

    if (transferId) {
      let abortFn: ((err: Error) => void) | null = null;
      const control: ActiveXferControl = {
        abort: (err) => abortFn?.(err),
        closeResources: async () => {
          await closeTransferHandlesSafe(handles);
        },
      };
      activeXferControls.set(transferId, control);

      try {
        await new Promise<void>((resolve, reject) => {
          abortFn = reject;
          runCopyWithRetry().then(resolve).catch(reject);
        });
      } finally {
        activeXferControls.delete(transferId);
      }
    } else {
      await runCopyWithRetry();
    }

    stats.sourceReadSpanMs = hopSpanMs(sourceReadClock);
    stats.destWriteSpanMs = hopSpanMs(destWriteClock);
  } finally {
    if (handles) {
      await handles.close().catch(() => {});
    }
  }

  return stats;
}

/** Source SFTP → local filesystem (skips SFTP write when dest SSH target is this host). */
async function pipelinedSftpToLocalFile(
  sourceSftp: SFTPWrapper,
  sourcePath: string,
  destPath: string,
  options: PipelinedXferOptions = {},
): Promise<PipelinedXferStats> {
  let fileSize = options.fileSize ?? 0;
  const stats = createEmptyXferStats();
  stats.destWriteKind = "local";

  if (!fileSize) {
    const srcHandle = await promisifySftpOpen(
      sourceSftp,
      sourcePath,
      SFTP_OPEN_READ,
      0o666,
    );
    try {
      const fstats = await promisifySftpFstat(sourceSftp, srcHandle);
      fileSize = fstats.size;
    } finally {
      await promisifySftpClose(sourceSftp, srcHandle).catch(() => {});
    }
  }
  if (fileSize <= 0) return stats;

  stats.bytes = fileSize;
  const localPath = sftpPathToLocalPath(destPath);
  const progress = createThrottledProgress(options.onProgress);
  const transferStart = Date.now();

  await promisifyFastGet(sourceSftp, sourcePath, localPath, {
    concurrency: SFTP_XFER_CONCURRENCY,
    chunkSize: SFTP_XFER_CHUNK_SIZE,
    fileSize,
    step: (_total, chunk) => {
      if (options.shouldAbort?.()) {
        throw new TransferCancelledError();
      }
      progress.add(chunk);
    },
  });

  progress.flush();
  stats.sourceReadSpanMs = elapsedMs(transferStart);
  stats.destWriteSpanMs = stats.sourceReadSpanMs;
  return stats;
}

async function transferFileData(
  sourceSftp: SFTPWrapper,
  destSftp: SFTPWrapper,
  destSession: SSHSessionLike,
  sourcePath: string,
  destPath: string,
  fileSize: number,
  onProgress?: (bytes: number) => void,
  shouldAbort?: () => boolean,
  transferId?: string,
  reconnect?: TransferReconnectContext,
  onResumeOffset?: (offset: number) => void,
  parallelSegmentCount?: number,
): Promise<PipelinedXferStats> {
  const pipeOptions: PipelinedXferOptions = {
    fileSize,
    onProgress,
    shouldAbort,
    transferId,
    reconnect,
    onResumeOffset,
    parallelSegmentCount,
  };

  if (isLocalSshEndpoint(destSession.ip)) {
    return pipelinedSftpToLocalFile(
      sourceSftp,
      sourcePath,
      destPath,
      pipeOptions,
    );
  }

  return pipelinedSftpFile(
    sourceSftp,
    destSftp,
    sourcePath,
    destPath,
    pipeOptions,
  );
}

async function transferSingleFile(
  deps: HostTransferDeps,
  transferId: string,
  sourceSession: SSHSessionLike,
  destSession: SSHSessionLike,
  sourcePath: string,
  destPath: string,
  move: boolean,
  reconnectMeta: TransferReconnectMeta,
): Promise<TransferProgress> {
  const sourceSftp = await deps.getSessionSftp(sourceSession);
  const destSftp = await deps.getSessionSftp(destSession);
  const shouldAbort = createTransferShouldAbort(transferId);

  const reconnect = buildTransferReconnectContext(
    deps,
    transferId,
    reconnectMeta,
  );

  const stats = await promisifySftpStat(sourceSftp, sourcePath);
  if (!stats.isFile()) {
    throw new Error(`Source is not a regular file: ${sourcePath}`);
  }

  updateTransfer(transferId, {
    method: "stream",
    phase: "transferring",
    totalBytes: stats.size,
  });

  let bytesTransferred = 0;
  try {
    const destStat = await promisifySftpStat(destSftp, destPath);
    bytesTransferred = Math.min(destStat.size, stats.size);
  } catch {
    /* destination file does not exist yet */
  }

  updateTransfer(transferId, { bytesTransferred });
  const prepareStart = Date.now();
  await ensureDestParentForFile(deps, destSession, destPath);
  const prepareDestMs = elapsedMs(prepareStart);
  updateTransfer(transferId, { timings: { prepareDestMs } });

  const syncProgress = (absoluteOffset: number) => {
    bytesTransferred = absoluteOffset;
    updateTransfer(transferId, { bytesTransferred: absoluteOffset });
  };

  const parallelLanes = clampParallelSegmentCount(
    activeTransfers.get(transferId)?.parallelSegmentCount,
  );
  const useAbsoluteProgressOnly = parallelLanes > 1;

  throwIfCancelled(transferId);
  trackDestArtifact(transferId, destPath);
  await transferFileData(
    sourceSftp,
    destSftp,
    destSession,
    sourcePath,
    destPath,
    stats.size,
    useAbsoluteProgressOnly
      ? undefined
      : (n) => {
          bytesTransferred += n;
          updateTransfer(transferId, { bytesTransferred });
        },
    shouldAbort,
    transferId,
    reconnect,
    syncProgress,
    parallelLanes,
  );

  if (move) {
    await deleteSourcePathsAfterSuccess(deps, transferId, sourceSession, [
      sourcePath,
    ]);
  }

  return finalizeTransfer(transferId, {
    status: "success",
    phase: "transferring",
    method: "stream",
    bytesTransferred: stats.size,
    totalBytes: stats.size,
    sourcePaths: [sourcePath],
    destPath,
    sourceDeleted: move,
    moveRequested: move,
    timings: buildStreamTransferTimings(transferId, stats.size, prepareDestMs),
  });
}

async function cleanupDestItems(
  deps: HostTransferDeps,
  destSession: SSHSessionLike,
  destDir: string,
  basenames: string[],
): Promise<void> {
  const destSftp = await deps.getSessionSftp(destSession);
  for (const name of basenames) {
    const target = joinPath(destDir, name);
    try {
      await deletePathSftp(destSftp, target);
    } catch {
      /* best effort */
    }
  }
}

async function deleteSourcePaths(
  deps: HostTransferDeps,
  sourceSession: SSHSessionLike,
  sourcePaths: string[],
): Promise<void> {
  const sourceSftp = await deps.getSessionSftp(sourceSession);
  for (const path of sourcePaths) {
    try {
      await deletePathSftp(sourceSftp, path);
    } catch {
      /* best effort */
    }
  }
}

async function transferViaTar(
  deps: HostTransferDeps,
  transferId: string,
  sourceSession: SSHSessionLike,
  destSession: SSHSessionLike,
  sourcePaths: string[],
  destPath: string,
  move: boolean,
  reconnectMeta: TransferReconnectMeta,
): Promise<TransferProgress> {
  const sourceSftp = await deps.getSessionSftp(sourceSession);
  const destSftp = await deps.getSessionSftp(destSession);
  const reconnect = buildTransferReconnectContext(
    deps,
    transferId,
    reconnectMeta,
  );
  const archiveId = randomUUID();
  const tempArchive = `/tmp/termix-transfer-${archiveId}.tar.gz`;
  updateTransfer(transferId, { tempArchivePath: tempArchive });
  trackDestArtifact(transferId, tempArchive);
  const workingDir = getWorkingDir(sourcePaths);
  const basenames = sourcePaths.map((p) => basename(p));
  const escapedNames = basenames.map((n) => `'${escapeShell(n)}'`).join(" ");
  const escapedDir = escapeShell(workingDir);
  const escapedArchive = escapeShell(tempArchive);
  const escapedDest = escapeShell(destPath);

  await ensureDestDirectory(deps, destSession, destPath);

  updateTransfer(transferId, {
    method: "tar",
    phase: "compressing",
  });

  throwIfCancelled(transferId);
  const compressStart = Date.now();
  const compressCmd = `cd '${escapedDir}' && tar -czf '${escapedArchive}' ${escapedNames}`;
  const compressResult = await execCommand(deps, sourceSession, compressCmd);
  const compressMs = elapsedMs(compressStart);
  updateTransfer(transferId, { timings: { compressMs } });
  if (compressResult.code !== 0) {
    throw new Error(
      compressResult.stderr || "Failed to compress on source host",
    );
  }

  throwIfCancelled(transferId);
  let archiveSize = 0;
  try {
    const archiveStats = await promisifySftpStat(sourceSftp, tempArchive);
    archiveSize = archiveStats.size;
  } catch {
    /* size unknown */
  }

  updateTransfer(transferId, {
    phase: "transferring",
    totalBytes: archiveSize,
    bytesTransferred: 0,
  });

  let bytesTransferred = 0;
  const transferStart = Date.now();
  const xferStats = createEmptyXferStats();
  const syncProgress = (absoluteOffset: number) => {
    bytesTransferred = absoluteOffset;
    updateTransfer(transferId, { bytesTransferred: absoluteOffset });
  };
  try {
    const fileStats = await transferFileData(
      sourceSftp,
      destSftp,
      destSession,
      tempArchive,
      tempArchive,
      archiveSize,
      (n) => {
        bytesTransferred += n;
        updateTransfer(transferId, { bytesTransferred });
      },
      () => cancelRequestedTransfers.has(transferId),
      transferId,
      reconnect,
      syncProgress,
    );
    mergeXferStats(xferStats, fileStats);
  } catch (err) {
    if (!(err instanceof TransferCancelledError)) {
      await cleanupDestItems(deps, destSession, destPath, basenames);
    }
    throw err;
  } finally {
    await promisifySftpUnlink(sourceSftp, tempArchive);
  }
  throwIfCancelled(transferId);
  const transferMs = elapsedMs(transferStart);
  const hopTimings = buildTransferHopTimings(xferStats, transferMs);
  updateTransfer(transferId, {
    timings: {
      ...activeTransfers.get(transferId)?.timings,
      transferMs,
      ...hopTimings,
    },
  });

  updateTransfer(transferId, { phase: "extracting" });

  throwIfCancelled(transferId);
  const extractStart = Date.now();
  const extractCmd = `tar -xzf '${escapedArchive}' -C '${escapedDest}'`;
  const extractResult = await execCommand(deps, destSession, extractCmd);
  const extractMs = elapsedMs(extractStart);

  await promisifySftpUnlink(destSftp, tempArchive);

  if (extractResult.code !== 0) {
    await cleanupDestItems(deps, destSession, destPath, basenames);
    throw new Error(
      extractResult.stderr || "Failed to extract on destination host",
    );
  }

  if (move) {
    await deleteSourcePathsAfterSuccess(
      deps,
      transferId,
      sourceSession,
      sourcePaths,
    );
  }

  return finalizeTransfer(transferId, {
    status: "success",
    phase: "extracting",
    method: "tar",
    bytesTransferred,
    totalBytes: archiveSize,
    sourcePaths,
    destPath,
    sourceDeleted: move,
    moveRequested: move,
    timings: {
      ...activeTransfers.get(transferId)?.timings,
      extractMs,
      ...hopTimings,
    },
  });
}

async function transferViaItemSftp(
  deps: HostTransferDeps,
  transferId: string,
  sourceSession: SSHSessionLike,
  destSession: SSHSessionLike,
  sourcePaths: string[],
  destPath: string,
  move: boolean,
  destPlatform: TransferPlatform,
  reconnectMeta: TransferReconnectMeta,
): Promise<TransferProgress> {
  const sourceSftp = await deps.getSessionSftp(sourceSession);
  const destSftp = await deps.getSessionSftp(destSession);
  const reconnect = buildTransferReconnectContext(
    deps,
    transferId,
    reconnectMeta,
  );

  const createdDirs = new Set<string>();
  await ensureDirectoryTreeSftp(destSftp, destPath, createdDirs);

  const allWork: FileWorkItem[] = [];
  for (const sourcePath of sourcePaths) {
    const items = await collectFileWorkItems(sourceSftp, sourcePath, destPath);
    allWork.push(...items);
  }

  allWork.sort((a, b) => b.size - a.size);

  const totalBytes = allWork.reduce((sum, item) => sum + item.size, 0);

  updateTransfer(transferId, {
    method: "item_sftp",
    phase: "transferring",
    totalItems: allWork.length,
    itemsCompleted: 0,
    totalBytes,
    bytesTransferred: 0,
  });

  const failedPaths: string[] = [];
  const createdFiles: string[] = [];
  let itemsCompleted = 0;
  let bytesTransferred = 0;
  const transferStart = Date.now();
  const xferStats = createEmptyXferStats();

  for (const item of allWork) {
    throwIfCancelled(transferId);
    trackDestArtifact(transferId, item.destPath);
    const bytesBeforeItem = bytesTransferred;
    try {
      const parentDir = dirname(item.destPath);
      if (parentDir && !isRootOnlyPath(parentDir)) {
        await ensureDirectoryTreeSftp(destSftp, parentDir, createdDirs);
      }
      const itemStats = await promisifySftpStat(sourceSftp, item.sourcePath);
      const itemXferStats = await transferFileData(
        sourceSftp,
        destSftp,
        destSession,
        item.sourcePath,
        item.destPath,
        itemStats.size,
        (n) => {
          bytesTransferred += n;
          updateTransfer(transferId, { bytesTransferred });
        },
        () => cancelRequestedTransfers.has(transferId),
        transferId,
        reconnect,
        (absoluteOffset) => {
          bytesTransferred = bytesBeforeItem + absoluteOffset;
          updateTransfer(transferId, { bytesTransferred });
        },
      );
      mergeXferStats(xferStats, itemXferStats);
      if (destPlatform !== "windows") {
        await promisifySftpChmod(destSftp, item.destPath, item.mode);
      }
      createdFiles.push(item.destPath);
      itemsCompleted++;
      updateTransfer(transferId, { itemsCompleted, bytesTransferred });
    } catch (err) {
      if (isPermissionError(err as Error)) {
        failedPaths.push(item.sourcePath);
        itemsCompleted++;
        updateTransfer(transferId, { itemsCompleted, bytesTransferred });
        continue;
      }
      if (!(err instanceof TransferCancelledError)) {
        for (const created of [...createdFiles].reverse()) {
          await deletePathSftp(destSftp, created).catch(() => {});
        }
      }
      throw err;
    }
  }

  const transferMs = elapsedMs(transferStart);
  const hopTimings = buildTransferHopTimings(xferStats, transferMs);

  const status: TransferStatus = failedPaths.length > 0 ? "partial" : "success";

  // Move only after every file succeeded — never delete source on partial transfer
  if (status === "success" && move) {
    await deleteSourcePathsAfterSuccess(
      deps,
      transferId,
      sourceSession,
      sourcePaths,
    );
  }

  return finalizeTransfer(transferId, {
    status,
    phase: "transferring",
    method: "item_sftp",
    itemsCompleted,
    totalItems: allWork.length,
    failedPaths: failedPaths.length > 0 ? failedPaths : undefined,
    sourcePaths,
    destPath,
    sourceDeleted: status === "success" && move,
    moveRequested: move,
    timings: {
      ...activeTransfers.get(transferId)?.timings,
      transferMs,
      ...hopTimings,
    },
  });
}

async function runTransfer(
  deps: HostTransferDeps,
  transferId: string,
  request: TransferRequest,
): Promise<void> {
  const {
    sourceSessionId: browseSourceSessionId,
    sourcePaths,
    destSessionId: browseDestSessionId,
    destPath,
    move = false,
    userId,
    methodPreference = "auto",
    parallelSegmentCount:
      requestParallelSegments = DEFAULT_PARALLEL_SEGMENT_COUNT,
  } = request;

  const parallelSegmentCount = clampParallelSegmentCount(
    requestParallelSegments,
  );

  const dedicatedSourceSessionId = `xfer:${transferId}:src`;
  const dedicatedDestSessionId = `xfer:${transferId}:dst`;
  const runStart = Date.now();
  const reconnectMeta: TransferReconnectMeta = {
    userId,
    browseSourceSessionId,
    browseDestSessionId,
    dedicatedSourceSessionId,
    dedicatedDestSessionId,
  };

  try {
    const sourceSession = await deps.openDedicatedTransferSession(
      browseSourceSessionId,
      dedicatedSourceSessionId,
      userId,
      transferId,
    );
    const destSession = await deps.openDedicatedTransferSession(
      browseDestSessionId,
      dedicatedDestSessionId,
      userId,
      transferId,
    );

    sourceSession.lastActive = Date.now();
    destSession.lastActive = Date.now();

    updateTransfer(transferId, {
      parallelSegmentCount,
      dedicatedSourceSessionId,
      dedicatedDestSessionId,
    });

    const pathHints = [destPath, ...sourcePaths];
    const sourcePlatform = await detectTransferPlatform(
      deps,
      sourceSession,
      pathHints,
    );
    const destPlatform = await detectTransferPlatform(
      deps,
      destSession,
      pathHints,
    );

    const sourceSftp = await deps.getSessionSftp(sourceSession);

    for (const path of sourcePaths) {
      try {
        await promisifySftpStat(sourceSftp, path);
      } catch {
        throw new Error(`Source not found: ${path}`);
      }
    }

    if (browseSourceSessionId === browseDestSessionId) {
      for (const src of sourcePaths) {
        if (pathsOverlap(src, destPath)) {
          throw new Error("Source and destination paths overlap");
        }
      }
    }

    let useArchive = sourcePaths.length > 1;

    if (sourcePaths.length === 1) {
      const stats = await promisifySftpStat(sourceSftp, sourcePaths[0]);
      useArchive = stats.isDirectory();
    }

    if (!useArchive) {
      await transferSingleFile(
        deps,
        transferId,
        sourceSession,
        destSession,
        sourcePaths[0],
        destPath,
        move,
        reconnectMeta,
      );
    } else {
      const prepareStart = Date.now();
      await ensureDestDirectory(deps, destSession, destPath);
      updateTransfer(transferId, {
        timings: { prepareDestMs: elapsedMs(prepareStart) },
      });

      const sourceHasTar =
        sourcePlatform === "unix" &&
        (await checkTarAvailable(deps, sourceSession));
      const destHasTar =
        destPlatform === "unix" && (await checkTarAvailable(deps, destSession));

      throwIfCancelled(transferId);
      const scanSummary = await scanSourcePathsForRouting(
        sourceSftp,
        sourcePaths,
        transferId,
      );
      const archiveMethod = resolveArchiveTransferMethod(
        methodPreference,
        scanSummary,
        sourcePlatform,
        destPlatform,
        sourceHasTar,
        destHasTar,
      );

      fileLogger.info("Resolved archive transfer method", {
        operation: "host_transfer",
        transferId,
        methodPreference,
        archiveMethod,
        fileCount: scanSummary.fileCount,
        totalBytes: scanSummary.totalBytes,
        incompressibleRatio: scanSummary.incompressibleRatio,
      });

      if (archiveMethod === "tar") {
        await transferViaTar(
          deps,
          transferId,
          sourceSession,
          destSession,
          sourcePaths,
          destPath,
          move,
          reconnectMeta,
        );
      } else {
        await transferViaItemSftp(
          deps,
          transferId,
          sourceSession,
          destSession,
          sourcePaths,
          destPath,
          move,
          destPlatform,
          reconnectMeta,
        );
      }
    }

    fileLogger.success("Host transfer completed", {
      operation: "host_transfer",
      transferId,
      browseSourceSessionId,
      browseDestSessionId,
      sourcePaths,
      destPath,
      move,
      timings: {
        ...activeTransfers.get(transferId)?.timings,
        totalMs: elapsedMs(runStart),
      },
    });
    updateTransfer(transferId, {
      moveRequested: move,
      timings: {
        ...activeTransfers.get(transferId)?.timings,
        totalMs: elapsedMs(runStart),
      },
    });
  } catch (err) {
    if (err instanceof TransferCancelledError) {
      const current = activeTransfers.get(transferId);
      finalizeTransfer(
        transferId,
        cancelledProgressPatch(current, {
          status: "cancelled",
          phase: current?.phase ?? "transferring",
          message: "Transfer cancelled by user",
          method: current?.method,
          sourcePaths,
          destPath,
          bytesTransferred: current?.bytesTransferred,
          totalBytes: current?.totalBytes,
          itemsCompleted: current?.itemsCompleted,
          totalItems: current?.totalItems,
          moveRequested: move,
          sourceDeleted: false,
          timings: {
            ...current?.timings,
            totalMs: elapsedMs(runStart),
          },
        }),
      );
      fileLogger.info("Host transfer cancelled", {
        operation: "host_transfer",
        transferId,
        sourcePaths,
        destPath,
      });
      return;
    }

    const current = activeTransfers.get(transferId);
    const message = err instanceof Error ? err.message : "Transfer failed";

    if (
      sourcePaths.length === 1 &&
      current?.method === "stream" &&
      current.destPath &&
      current.totalBytes
    ) {
      try {
        const destSession = await deps.openDedicatedTransferSession(
          browseDestSessionId,
          dedicatedDestSessionId,
          userId,
          transferId,
          { allowBrowseDisconnected: true },
        );
        const finalized = await tryFinalizeStreamTransferIfDestComplete(
          deps,
          transferId,
          destSession,
          current.destPath,
          current.totalBytes,
          {
            sourcePaths,
            moveRequested: move,
            sourceDeleted: current.sourceDeleted,
          },
        );
        if (finalized) {
          fileLogger.info("Host transfer succeeded after destination verify", {
            operation: "host_transfer",
            transferId,
            sourcePaths,
            destPath,
          });
          return;
        }
      } catch {
        /* fall through to error */
      }
    }

    finalizeTransfer(
      transferId,
      failedProgressPatch(current, {
        status: "error",
        phase: current?.phase ?? "transferring",
        message,
        method: current?.method,
        sourcePaths,
        destPath,
        bytesTransferred: current?.bytesTransferred,
        totalBytes: current?.totalBytes,
        itemsCompleted: current?.itemsCompleted,
        totalItems: current?.totalItems,
        moveRequested: move,
        timings: {
          ...current?.timings,
          totalMs: elapsedMs(runStart),
        },
      }),
    );
    fileLogger.error(
      err instanceof TransferStalledError
        ? "Host transfer stalled"
        : "Host transfer failed",
      err,
      {
        operation: "host_transfer",
        transferId,
        sourcePaths,
        destPath,
      },
    );
  } finally {
    deps.closeDedicatedTransferSession(dedicatedSourceSessionId);
    deps.closeDedicatedTransferSession(dedicatedDestSessionId);
  }
}

export function getTransferStatus(
  transferId: string,
  userId: string,
): TransferProgress | null {
  checkHungTransfers();
  const progress = activeTransfers.get(transferId);
  if (!progress || progress.userId !== userId) return null;
  return progress;
}

export function listActiveTransfers(userId: string): TransferProgress[] {
  return Array.from(activeTransfers.values()).filter(
    (progress) => progress.userId === userId && progress.status === "running",
  );
}

export async function cleanupCancelledTransfer(
  deps: HostTransferDeps,
  transferId: string,
  userId: string,
): Promise<{ removedPaths: string[]; failedPaths: string[] }> {
  const progress = activeTransfers.get(transferId);
  if (!progress || progress.userId !== userId) {
    throw new Error("Transfer not found");
  }
  if (progress.status !== "cancelled") {
    throw new Error("Transfer is not cancelled");
  }
  if (progress.cleanupCompleted) {
    return { removedPaths: [], failedPaths: [] };
  }
  if (!progress.destSessionId) {
    throw new Error("Transfer has no destination session");
  }

  const pathsToRemove = buildCleanupPaths(progress);
  if (pathsToRemove.length === 0) {
    updateTransfer(transferId, { cleanupCompleted: true });
    return { removedPaths: [], failedPaths: [] };
  }

  const cleanupSessionId = `xfer:cleanup:${transferId}:dst`;
  const removedPaths: string[] = [];
  const failedPaths: string[] = [];

  try {
    const destSession = await deps.openDedicatedTransferSession(
      progress.destSessionId,
      cleanupSessionId,
      userId,
      transferId,
      { allowBrowseDisconnected: true },
    );
    const destSftp = await deps.getSessionSftp(destSession);

    for (const path of pathsToRemove) {
      try {
        await deletePathSftp(destSftp, path);
        removedPaths.push(path);
      } catch {
        failedPaths.push(path);
      }
    }
  } finally {
    deps.closeDedicatedTransferSession(cleanupSessionId);
  }

  updateTransfer(transferId, { cleanupCompleted: true });
  return { removedPaths, failedPaths };
}

export function retryHostTransfer(
  deps: HostTransferDeps,
  transferId: string,
  userId: string,
): boolean {
  const progress = activeTransfers.get(transferId);
  if (
    !progress ||
    progress.userId !== userId ||
    progress.status !== "error" ||
    !progress.retryable ||
    !progress.requestSnapshot
  ) {
    return false;
  }

  void (async () => {
    if (
      progress.method === "stream" &&
      progress.destPath &&
      progress.totalBytes &&
      progress.destSessionId
    ) {
      const destId =
        progress.dedicatedDestSessionId ?? `xfer:${transferId}:dst`;
      try {
        const destSession = await deps.openDedicatedTransferSession(
          progress.destSessionId,
          destId,
          userId,
          transferId,
          { allowBrowseDisconnected: true },
        );
        const done = await tryFinalizeStreamTransferIfDestComplete(
          deps,
          transferId,
          destSession,
          progress.destPath,
          progress.totalBytes,
          {
            sourcePaths: progress.sourcePaths,
            moveRequested: progress.moveRequested,
          },
        );
        if (done) {
          return;
        }
      } catch {
        /* destination not ready — restart transfer below */
      }
    }

    const latest = activeTransfers.get(transferId);
    if (!latest || latest.status !== "error" || !latest.requestSnapshot) {
      return;
    }

    updateTransfer(transferId, {
      status: "running",
      phase: "transferring",
      message: undefined,
      retryable: false,
      parallelSegmentCount:
        latest.requestSnapshot?.parallelSegmentCount ??
        latest.parallelSegmentCount,
    });

    await runTransfer(deps, transferId, {
      ...latest.requestSnapshot,
      userId,
      parallelSegmentCount:
        latest.requestSnapshot?.parallelSegmentCount ??
        latest.parallelSegmentCount ??
        DEFAULT_PARALLEL_SEGMENT_COUNT,
    });
  })();

  return true;
}

export async function previewArchiveTransferMethod(
  deps: HostTransferDeps,
  request: {
    sourceSessionId: string;
    destSessionId: string;
    sourcePaths: string[];
    destPath: string;
    methodPreference?: TransferMethodPreference;
    userId: string;
  },
): Promise<TransferMethodPreview> {
  const {
    sourceSessionId,
    destSessionId,
    sourcePaths,
    destPath,
    methodPreference = "auto",
    userId,
  } = request;

  const sourceSession = deps.sshSessions[sourceSessionId];
  const destSession = deps.sshSessions[destSessionId];

  if (!sourceSession?.isConnected || !destSession?.isConnected) {
    throw new Error("SSH session not connected");
  }

  if (
    !deps.verifySessionOwnership(sourceSession, userId) ||
    !deps.verifySessionOwnership(destSession, userId)
  ) {
    throw new Error("Session access denied");
  }

  const pathHints = [destPath, ...sourcePaths];
  const sourcePlatform = await detectTransferPlatform(
    deps,
    sourceSession,
    pathHints,
  );
  const destPlatform = await detectTransferPlatform(
    deps,
    destSession,
    pathHints,
  );

  const sourceSftp = await deps.getSessionSftp(sourceSession);
  const scanItems: Array<{ sourcePath: string; size: number }> = [];
  for (const sourcePath of sourcePaths) {
    const work = await collectFileWorkItems(sourceSftp, sourcePath, "/");
    scanItems.push(
      ...work.map((w) => ({ sourcePath: w.sourcePath, size: w.size })),
    );
  }
  const scanSummary = buildTransferScanSummary(scanItems);

  const sourceHasTar =
    sourcePlatform === "unix" && (await checkTarAvailable(deps, sourceSession));
  const destHasTar =
    destPlatform === "unix" && (await checkTarAvailable(deps, destSession));

  const resolvedMethod = resolveArchiveTransferMethod(
    methodPreference,
    scanSummary,
    sourcePlatform,
    destPlatform,
    sourceHasTar,
    destHasTar,
  );

  const reasonKey = getArchiveTransferReasonKey(
    methodPreference,
    resolvedMethod,
    scanSummary,
    sourcePlatform,
    destPlatform,
    sourceHasTar,
    destHasTar,
  );

  return {
    methodPreference,
    resolvedMethod,
    reasonKey,
    sourcePlatform,
    destPlatform,
    sourceHasTar,
    destHasTar,
    summary: scanSummary,
  };
}

export function startHostTransfer(
  deps: HostTransferDeps,
  request: TransferRequest,
): { transferId: string; syncResult?: TransferProgress } {
  const transferId = randomUUID();

  activeTransfers.set(transferId, {
    transferId,
    status: "running",
    phase: "transferring",
    sourcePaths: request.sourcePaths,
    destPath: request.destPath,
    userId: request.userId,
    sourceSessionId: request.sourceSessionId,
    destSessionId: request.destSessionId,
    startedAt: Date.now(),
    moveRequested: request.move ?? false,
    methodPreference: request.methodPreference ?? "auto",
    parallelSegmentCount: clampParallelSegmentCount(
      request.parallelSegmentCount,
    ),
    requestSnapshot: {
      sourceSessionId: request.sourceSessionId,
      sourcePaths: request.sourcePaths,
      destSessionId: request.destSessionId,
      destPath: request.destPath,
      move: request.move,
      methodPreference: request.methodPreference,
      parallelSegmentCount: clampParallelSegmentCount(
        request.parallelSegmentCount,
      ),
    },
  });

  const isSingleSmallFile = request.sourcePaths.length === 1 && !request.move;

  if (isSingleSmallFile) {
    const sourceSession = deps.sshSessions[request.sourceSessionId];
    if (sourceSession?.sftp || sourceSession?.isConnected) {
      void (async () => {
        try {
          const sftp = await deps.getSessionSftp(sourceSession);
          const stats = await promisifySftpStat(sftp, request.sourcePaths[0]);
          if (stats.isFile() && stats.size <= SMALL_FILE_SYNC_THRESHOLD) {
            await runTransfer(deps, transferId, request);
            return;
          }
        } catch {
          /* fall through to async */
        }
        void runTransfer(deps, transferId, request);
      })();
      return { transferId };
    }
  }

  void runTransfer(deps, transferId, request);
  return { transferId };
}

export function cleanupOldTransfers(maxAgeMs = 60 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, progress] of activeTransfers.entries()) {
    if (
      progress.status !== "running" &&
      now - (progress as TransferProgress & { _ts?: number })._ts! > maxAgeMs
    ) {
      activeTransfers.delete(id);
    }
  }
}
