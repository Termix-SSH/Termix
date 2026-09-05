import { useCallback, useRef } from "react";
import { createElement } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { FileItem } from "@/types/index";
import {
  cancelLocalTransfer,
  createLocalTransferId,
  createSSHFolder,
  downloadSessionFileToLocal,
  listSSHFiles,
  uploadLocalFileToSession,
} from "@/main-axios.ts";
import {
  ensureLocalDirectory,
  getLocalHome,
  walkLocalPaths,
} from "@/lib/local-files.ts";
import {
  joinLocalPath,
  joinRemotePath,
  planRemoteDirectories,
  remoteBaseName,
  remoteDirForRelativePath,
} from "../local-transfer-utils.ts";
import {
  LocalTransferProgressToast,
  type LocalTransferBatchStatus,
} from "../components/LocalTransferProgressToast.tsx";

interface UseLocalTransfersOptions {
  sshSessionId: string | null;
  hostId?: number;
  ensureSSHConnection: () => Promise<unknown>;
  /** Called after uploads so the remote listing can refresh. */
  onRemoteChanged: (remoteDir: string) => void;
  /** Called after downloads so the local pane can refresh. */
  onLocalChanged: (localDir: string) => void;
}

interface RemoteDownloadPlanEntry {
  remotePath: string;
  /** "/"-separated, includes the dragged root's own name. */
  relativePath: string;
  size?: number;
}

class TransferCancelledError extends Error {
  constructor() {
    super("Transfer cancelled");
    this.name = "TransferCancelledError";
  }
}

function createSpeedometer() {
  let lastBytes = 0;
  let lastTime = Date.now();
  let mbPerSec: number | undefined;
  return (bytesDone: number) => {
    const now = Date.now();
    const deltaMs = now - lastTime;
    if (deltaMs >= 300) {
      const deltaBytes = bytesDone - lastBytes;
      if (deltaBytes >= 0) {
        mbPerSec = (deltaBytes / deltaMs / 1024 / 1024) * 1000;
      }
      lastBytes = bytesDone;
      lastTime = now;
    }
    return mbPerSec;
  };
}

/**
 * Orchestrates batched local<->remote transfers for the dual-pane file
 * manager: expands folders, creates directory skeletons, streams files one by
 * one through the Electron main process, and reports aggregate progress in a
 * single toast with a cancel button.
 */
export function useLocalTransfers({
  sshSessionId,
  hostId,
  ensureSSHConnection,
  onRemoteChanged,
  onLocalChanged,
}: UseLocalTransfersOptions) {
  const { t } = useTranslation();
  const batchCounter = useRef(0);

  const runBatch = useCallback(
    async (
      direction: "upload" | "download",
      totalFiles: number,
      totalBytes: number,
      work: (ctx: {
        isCancelled: () => boolean;
        setCurrentTransfer: (id: string | null) => void;
        report: (
          completedFiles: number,
          bytesDone: number,
          currentFileName?: string,
        ) => void;
      }) => Promise<{ failed: string[] }>,
    ) => {
      batchCounter.current += 1;
      const toastId = `local-transfer-${batchCounter.current}`;
      let cancelled = false;
      let cancelling = false;
      let currentTransfer: string | null = null;
      const speed = createSpeedometer();

      const status: LocalTransferBatchStatus = {
        direction,
        totalFiles,
        completedFiles: 0,
        bytesDone: 0,
        totalBytes,
      };

      const render = () => {
        toast.loading(
          createElement(LocalTransferProgressToast, {
            status: { ...status, cancelling },
            onCancel: () => {
              cancelled = true;
              cancelling = true;
              render();
              if (currentTransfer) void cancelLocalTransfer(currentTransfer);
            },
          }),
          { id: toastId, duration: Infinity },
        );
      };
      render();

      try {
        const { failed } = await work({
          isCancelled: () => cancelled,
          setCurrentTransfer: (id) => {
            currentTransfer = id;
          },
          report: (completedFiles, bytesDone, currentFileName) => {
            status.completedFiles = completedFiles;
            status.bytesDone = bytesDone;
            status.currentFileName = currentFileName;
            status.mbPerSec = speed(bytesDone);
            render();
          },
        });

        toast.dismiss(toastId);
        if (cancelled) {
          toast.info(t("fileManager.localTransferCancelled"));
          return;
        }
        const key = direction === "upload" ? "Upload" : "Download";
        if (failed.length === 0) {
          toast.success(
            t(`fileManager.local${key}Complete`, { count: totalFiles }),
          );
        } else if (failed.length === totalFiles) {
          toast.error(t(`fileManager.local${key}Failed`));
        } else {
          toast.warning(
            t(`fileManager.local${key}Partial`, {
              done: totalFiles - failed.length,
              failed: failed.length,
            }),
          );
        }
      } catch (error) {
        toast.dismiss(toastId);
        if (error instanceof TransferCancelledError || cancelled) {
          toast.info(t("fileManager.localTransferCancelled"));
          return;
        }
        const message =
          error instanceof Error ? error.message : String(error ?? "");
        toast.error(
          direction === "upload"
            ? t("fileManager.localUploadFailed")
            : t("fileManager.localDownloadFailed"),
          message ? { description: message } : undefined,
        );
        console.error(`Local ${direction} batch failed:`, error);
      }
    },
    [t],
  );

  /** Uploads local files/folders (by absolute path) into a remote directory. */
  const uploadLocalPaths = useCallback(
    async (localPaths: string[], remoteDir: string) => {
      if (!sshSessionId) {
        toast.error(t("fileManager.noSSHConnection"));
        return;
      }
      if (localPaths.length === 0) return;

      let plan;
      try {
        plan = await walkLocalPaths(localPaths);
      } catch (error) {
        toast.error(
          t("fileManager.localUploadFailed"),
          error instanceof Error ? { description: error.message } : undefined,
        );
        return;
      }
      if (plan.files.length === 0 && plan.emptyDirs.length === 0) {
        toast.info(t("fileManager.localNothingToTransfer"));
        return;
      }

      const sessionId = sshSessionId;
      await runBatch(
        "upload",
        plan.files.length,
        plan.totalBytes,
        async ({ isCancelled, setCurrentTransfer, report }) => {
          await ensureSSHConnection();

          const dirs = planRemoteDirectories(
            plan.files.map((f) => f.relativePath),
            plan.emptyDirs,
          );
          for (const dir of dirs) {
            if (isCancelled()) throw new TransferCancelledError();
            const parent = dir.includes("/")
              ? joinRemotePath(remoteDir, dir.slice(0, dir.lastIndexOf("/")))
              : remoteDir;
            const name = dir.split("/").pop()!;
            try {
              await createSSHFolder(sessionId, parent, name, hostId);
            } catch {
              // directory may already exist
            }
          }

          const failed: string[] = [];
          let bytesDone = 0;
          let completed = 0;
          for (const file of plan.files) {
            if (isCancelled()) break;
            const fileName = file.relativePath.split("/").pop()!;
            const targetDir = remoteDirForRelativePath(
              remoteDir,
              file.relativePath,
            );
            const transferId = createLocalTransferId("local-upload");
            setCurrentTransfer(transferId);
            report(completed, bytesDone, fileName);
            try {
              await uploadLocalFileToSession({
                sessionId,
                remoteDir: targetDir,
                localPath: file.localPath,
                fileName,
                hostId,
                transferId,
                onProgress: ({ transferred }) =>
                  report(completed, bytesDone + transferred, fileName),
              });
              bytesDone += file.size;
            } catch (error) {
              if (isCancelled()) break;
              failed.push(file.relativePath);
              bytesDone += file.size;
              console.error(`Failed to upload ${file.localPath}:`, error);
            } finally {
              setCurrentTransfer(null);
            }
            completed += 1;
            report(completed, bytesDone, fileName);
          }
          return { failed };
        },
      );

      onRemoteChanged(remoteDir);
    },
    [sshSessionId, hostId, ensureSSHConnection, onRemoteChanged, runBatch, t],
  );

  /** Downloads remote files/folders into a local directory. */
  const downloadRemoteItems = useCallback(
    async (items: FileItem[], localDir: string) => {
      if (!sshSessionId) {
        toast.error(t("fileManager.noSSHConnection"));
        return;
      }
      if (items.length === 0) return;
      const sessionId = sshSessionId;

      const { separator } = await getLocalHome();
      const toLocalPath = (relativePath: string) =>
        relativePath
          .split("/")
          .filter(Boolean)
          .reduce((acc, part) => joinLocalPath(acc, part, separator), localDir);

      // Expand directories into a flat file plan first so the toast can show
      // a real total. Listing is the only part that goes through the
      // renderer's normal API path.
      const plan: RemoteDownloadPlanEntry[] = [];
      const emptyDirs: string[] = [];
      let totalBytes = 0;

      const expandTaskId = `local-download-expand-${Date.now()}`;
      toast.loading(t("fileManager.localPreparingDownload"), {
        id: expandTaskId,
        duration: Infinity,
      });

      try {
        await ensureSSHConnection();

        const walkRemote = async (remotePath: string, relDir: string) => {
          const { files } = await listSSHFiles(sessionId, remotePath, {
            force: true,
          });
          if (files.length === 0) {
            emptyDirs.push(relDir);
            return;
          }
          for (const child of files) {
            const rel = `${relDir}/${child.name}`;
            if (child.type === "directory") {
              await walkRemote(child.path, rel);
            } else if (child.type === "file" || child.type === "link") {
              plan.push({
                remotePath: child.path,
                relativePath: rel,
                size: child.size,
              });
              totalBytes += child.size ?? 0;
            }
          }
        };

        for (const item of items) {
          const name = item.name || remoteBaseName(item.path);
          if (item.type === "directory") {
            await walkRemote(item.path, name);
          } else {
            plan.push({
              remotePath: item.path,
              relativePath: name,
              size: item.size,
            });
            totalBytes += item.size ?? 0;
          }
        }
      } catch (error) {
        toast.dismiss(expandTaskId);
        toast.error(
          t("fileManager.localDownloadFailed"),
          error instanceof Error ? { description: error.message } : undefined,
        );
        return;
      }
      toast.dismiss(expandTaskId);

      if (plan.length === 0 && emptyDirs.length === 0) {
        toast.info(t("fileManager.localNothingToTransfer"));
        return;
      }

      await runBatch(
        "download",
        plan.length,
        totalBytes,
        async ({ isCancelled, setCurrentTransfer, report }) => {
          for (const dir of emptyDirs) {
            if (isCancelled()) throw new TransferCancelledError();
            await ensureLocalDirectory(toLocalPath(dir));
          }

          const failed: string[] = [];
          let bytesDone = 0;
          let completed = 0;
          for (const entry of plan) {
            if (isCancelled()) break;
            const fileName = entry.relativePath.split("/").pop()!;
            const transferId = createLocalTransferId("local-download");
            setCurrentTransfer(transferId);
            report(completed, bytesDone, fileName);
            try {
              await downloadSessionFileToLocal({
                sessionId,
                remotePath: entry.remotePath,
                destPath: toLocalPath(entry.relativePath),
                expectedSize: entry.size,
                transferId,
                onProgress: ({ transferred }) =>
                  report(completed, bytesDone + transferred, fileName),
              });
              bytesDone += entry.size ?? 0;
            } catch (error) {
              if (isCancelled()) break;
              failed.push(entry.relativePath);
              bytesDone += entry.size ?? 0;
              console.error(`Failed to download ${entry.remotePath}:`, error);
            } finally {
              setCurrentTransfer(null);
            }
            completed += 1;
            report(completed, bytesDone, fileName);
          }
          return { failed };
        },
      );

      onLocalChanged(localDir);
    },
    [sshSessionId, ensureSSHConnection, onLocalChanged, runBatch, t],
  );

  return { uploadLocalPaths, downloadRemoteItems };
}
