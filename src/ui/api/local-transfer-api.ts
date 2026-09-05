// Local disk <-> remote SFTP transfers for the desktop app's dual-pane file
// manager. The bytes never pass through the renderer: the Electron main
// process streams them between disk and the backend's existing
// `uploadFileStream` / `downloadFileStream` routes (see
// electron/local-files.cjs), and we only orchestrate + relay progress here.

import type { LocalTransferProgress } from "@/types/electron";
import { resolveFileManagerRequestTarget } from "@/main-axios";

export interface LocalTransferProgressEvent {
  transferred: number;
  total?: number;
}

type ProgressListener = (event: LocalTransferProgressEvent) => void;

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
  const target = await resolveFileManagerRequestTarget(options.sessionId);

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
      url: `${target.baseURL}/ssh/uploadFileStream`,
      headers: target.headers,
      fields,
      localPath: options.localPath,
      fileName: options.fileName,
    });
    if (result.success !== true) {
      throw new Error(result.error || "Upload failed");
    }
  } finally {
    progressListeners.delete(transferId);
  }
}

/**
 * Streams a remote file from the SSH session straight to `destPath` on the
 * local disk.
 */
export async function downloadSessionFileToLocal(options: {
  sessionId: string;
  remotePath: string;
  destPath: string;
  expectedSize?: number;
  transferId?: string;
  onProgress?: ProgressListener;
}): Promise<void> {
  const api = requireTransferApi();
  ensureProgressSubscription();

  const transferId =
    options.transferId ?? createLocalTransferId("local-download");
  const target = await resolveFileManagerRequestTarget(options.sessionId);

  if (options.onProgress) {
    progressListeners.set(transferId, options.onProgress);
  }
  try {
    const result = await api.download({
      transferId,
      url: `${target.baseURL}/ssh/downloadFileStream`,
      headers: target.headers,
      body: { sessionId: options.sessionId, path: options.remotePath },
      destPath: options.destPath,
      expectedSize: options.expectedSize,
    });
    if (result.success !== true) {
      throw new Error(result.error || "Download failed");
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
