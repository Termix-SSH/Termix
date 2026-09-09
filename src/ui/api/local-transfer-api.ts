// Local disk <-> remote SFTP transfers for the desktop app's dual-pane file
// manager. The bytes never pass through the renderer: the Electron main
// process streams them between disk and the backend's existing
// `uploadFileStream` / `downloadFileStream` routes (see
// electron/local-files.cjs), and we only orchestrate + relay progress here.
//
// The renderer deliberately does not choose the URL or the auth headers. It
// names the origin that owns the SSH session ("local" embedded backend or the
// configured Remote Sync server) and the main process resolves the rest, so a
// compromised renderer cannot turn the transfer bridge into an HTTP client.

import type {
  LocalTransferOrigin,
  LocalTransferProgress,
} from "@/types/electron";
import { getSessionOrigin } from "@/main-axios";
import { getDeviceId } from "@/lib/device-id";

export interface LocalTransferProgressEvent {
  transferred: number;
  total?: number;
}

type ProgressListener = (event: LocalTransferProgressEvent) => void;

/** Error from the main process; `code` is e.g. "EEXIST" or "EBUSY". */
export class LocalTransferError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "LocalTransferError";
    this.code = code;
  }
}

const progressListeners = new Map<string, ProgressListener>();
let unsubscribeProgress: (() => void) | null = null;

function ensureProgressSubscription() {
  if (unsubscribeProgress) return;
  const api = window.electronAPI?.localTransfer;
  if (!api) return;
  unsubscribeProgress = api.onProgress((payload: LocalTransferProgress) => {
    const listener = progressListeners.get(payload.transferId);
    listener?.({ transferred: payload.transferred, total: payload.total });
  });
}

function requireTransferApi() {
  const api = window.electronAPI?.localTransfer;
  if (!api) {
    throw new Error("Local transfers are only available in the desktop app");
  }
  return api;
}

function transferOriginFor(sessionId: string): LocalTransferOrigin {
  return getSessionOrigin(sessionId);
}

export function createLocalTransferId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Streams a file from the local disk into `remoteDir` on the SSH session,
 * using the same multipart route the in-browser upload uses.
 */
export async function uploadLocalFileToSession(options: {
  sessionId: string;
  remoteDir: string;
  localPath: string;
  fileName: string;
  hostId?: number;
  transferId?: string;
  onProgress?: ProgressListener;
}): Promise<void> {
  const api = requireTransferApi();
  ensureProgressSubscription();

  const transferId =
    options.transferId ?? createLocalTransferId("local-upload");

  const fields: Record<string, string> = {
    sessionId: options.sessionId,
    path: options.remoteDir,
  };
  if (options.hostId !== undefined) fields.hostId = String(options.hostId);

  if (options.onProgress) {
    progressListeners.set(transferId, options.onProgress);
  }
  try {
    const result = await api.upload({
      transferId,
      origin: transferOriginFor(options.sessionId),
      deviceId: getDeviceId() ?? undefined,
      fields,
      localPath: options.localPath,
      fileName: options.fileName,
    });
    if (result.success !== true) {
      throw new LocalTransferError(
        result.error || "Upload failed",
        result.code,
      );
    }
  } finally {
    progressListeners.delete(transferId);
  }
}

/**
 * Streams a remote file from the SSH session straight to `destPath` on the
 * local disk. Refuses to replace an existing file (code "EEXIST") unless
 * `overwrite` is set.
 */
export async function downloadSessionFileToLocal(options: {
  sessionId: string;
  remotePath: string;
  destPath: string;
  expectedSize?: number;
  overwrite?: boolean;
  transferId?: string;
  onProgress?: ProgressListener;
}): Promise<void> {
  const api = requireTransferApi();
  ensureProgressSubscription();

  const transferId =
    options.transferId ?? createLocalTransferId("local-download");

  if (options.onProgress) {
    progressListeners.set(transferId, options.onProgress);
  }
  try {
    const result = await api.download({
      transferId,
      origin: transferOriginFor(options.sessionId),
      deviceId: getDeviceId() ?? undefined,
      body: { sessionId: options.sessionId, path: options.remotePath },
      destPath: options.destPath,
      expectedSize: options.expectedSize,
      overwrite: options.overwrite === true,
    });
    if (result.success !== true) {
      throw new LocalTransferError(
        result.error || "Download failed",
        result.code,
      );
    }
  } finally {
    progressListeners.delete(transferId);
  }
}

export async function cancelLocalTransfer(transferId: string): Promise<void> {
  const api = window.electronAPI?.localTransfer;
  if (!api) return;
  await api.cancel(transferId);
}
