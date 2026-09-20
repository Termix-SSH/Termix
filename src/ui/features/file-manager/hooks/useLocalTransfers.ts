import { useCallback, useRef } from "react";
import { createElement } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { FileItem } from "@/types/index";
import type { LocalWalkResult } from "@/types/electron";
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
  localPathsExist,
  walkLocalPaths,
} from "@/lib/local-files.ts";
import {
  UnsafeLocalNameError,
  buildLocalDestination,
  getTransferConcurrency,
  runWithConcurrency,
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

/**
 * Asks whether existing local files may be replaced. Resolves `true` only on
 * an explicit "Replace"; dismissing, auto-close and "Skip" all mean skip, so
 * the batch can never overwrite silently.
 */
function askReplaceExisting(
  t: ReturnType<typeof useTranslation>["t"],
  count: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    toast.warning(t("fileManager.localReplaceExistingPrompt", { count }), {
      duration: 15000,
      action: {
        label: t("fileManager.localReplace"),
        onClick: () => settle(true),
      },
      cancel: {
        label: t("fileManager.localSkipExisting"),
        onClick: () => settle(false),
      },
      onDismiss: () => settle(false),
      onAutoClose: () => settle(false),
    });
  });
}

/** One line a user can act on, taken from whatever the bridge or backend said. */
function describeTransferError(error: unknown): string | undefined {
  const message =
    error instanceof Error ? error.message : String(error ?? "").trim();
  return message ? message.slice(0, 200) : undefined;
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
        /** Marks a transfer as in flight so Cancel can reach it. */
        trackTransfer: (id: string, fileName: string) => void;
        /** Progress of one in-flight transfer; bytes are summed across all. */
        progress: (id: string, transferred: number) => void;
        /** Transfer finished (success or failure); its size is now settled. */
        settleTransfer: (id: string, size: number) => void;
      }) => Promise<{ failed: string[]; reason?: string }>,
    ) => {
      batchCounter.current += 1;
      const toastId = `local-transfer-${batchCounter.current}`;
      let cancelled = false;
      let cancelling = false;
      const inFlight = new Map<
        string,
        { fileName: string; transferred: number }
      >();
      let settledBytes = 0;
      let completedFiles = 0;
      let lastFileName: string | undefined;
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
              for (const id of inFlight.keys()) void cancelLocalTransfer(id);
            },
          }),
          { id: toastId, duration: Infinity },
        );
      };
      render();

      try {
        const refresh = () => {
          let bytesDone = settledBytes;
          for (const entry of inFlight.values()) bytesDone += entry.transferred;
          status.completedFiles = completedFiles;
          status.bytesDone = bytesDone;
          status.activeFiles = inFlight.size;
          status.currentFileName =
            lastFileName ?? inFlight.values().next().value?.fileName;
          status.mbPerSec = speed(bytesDone);
          render();
        };
        const { failed, reason } = await work({
          isCancelled: () => cancelled,
          trackTransfer: (id, fileName) => {
            inFlight.set(id, { fileName, transferred: 0 });
            lastFileName = fileName;
            refresh();
          },
          progress: (id, transferred) => {
            const entry = inFlight.get(id);
            if (!entry) return;
            entry.transferred = transferred;
            lastFileName = entry.fileName;
            refresh();
          },
          settleTransfer: (id, size) => {
            inFlight.delete(id);
            settledBytes += size;
            completedFiles += 1;
            refresh();
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
          // Every file failed the same way more often than not (auth,
          // permissions, a dead session); say why instead of just "failed".
          toast.error(
            t(`fileManager.local${key}Failed`),
            reason ? { description: reason } : undefined,
          );
        } else {
          toast.warning(
            t(`fileManager.local${key}Partial`, {
              done: totalFiles - failed.length,
              failed: failed.length,
            }),
            reason ? { description: reason } : undefined,
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

      let plan: LocalWalkResult;
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
        async ({ isCancelled, trackTransfer, progress, settleTransfer }) => {
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
            // The backend tolerates existing directories (#1442), so a
            // failure here is real and should stop the batch up front.
            await createSSHFolder(sessionId, parent, name, hostId);
          }

          // Files go up several at a time (see "Simultaneous File Transfers"
          // in the profile settings); directories were created above, so
          // order between files no longer matters.
          const failed: string[] = [];
          let reason: string | undefined;
          await runWithConcurrency(
            plan.files,
            getTransferConcurrency(),
            async (file) => {
              const fileName = file.relativePath.split("/").pop()!;
              const targetDir = remoteDirForRelativePath(
                remoteDir,
                file.relativePath,
              );
              const transferId = createLocalTransferId("local-upload");
              trackTransfer(transferId, fileName);
              try {
                await uploadLocalFileToSession({
                  sessionId,
                  remoteDir: targetDir,
                  localPath: file.localPath,
                  fileName,
                  hostId,
                  transferId,
                  onProgress: ({ transferred }) =>
                    progress(transferId, transferred),
                });
              } catch (error) {
                if (!isCancelled()) {
                  failed.push(file.relativePath);
                  reason ??= describeTransferError(error);
                  console.error(`Failed to upload ${file.localPath}:`, error);
                }
              } finally {
                settleTransfer(transferId, file.size);
              }
            },
            isCancelled,
          );
          return { failed, reason };
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
      // Every remote name is validated for the local platform and the result
      // must stay inside `localDir`; anything else is reported and skipped.
      const toLocalPath = (relativePath: string) =>
        buildLocalDestination(localDir, relativePath, separator);

      // Expand directories into a flat file plan first so the toast can show
      // a real total. Listing is the only part that goes through the
      // renderer's normal API path.
      const plan: RemoteDownloadPlanEntry[] = [];
      const emptyDirs: string[] = [];

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

      // Drop anything whose remote name cannot become a safe local path
      // (separators, traversal, Windows-invalid characters). These never
      // reach the filesystem; the user is told how many were skipped.
      const unsafe: string[] = [];
      const safeDest = (relativePath: string): string | null => {
        try {
          return toLocalPath(relativePath);
        } catch (error) {
          if (error instanceof UnsafeLocalNameError) {
            unsafe.push(relativePath);
            return null;
          }
          throw error;
        }
      };
      const plannedDirs = emptyDirs
        .map((dir) => ({ dir, dest: safeDest(dir) }))
        .filter((d): d is { dir: string; dest: string } => d.dest !== null);
      const plannedFiles = plan
        .map((entry) => ({ entry, dest: safeDest(entry.relativePath) }))
        .filter(
          (p): p is { entry: RemoteDownloadPlanEntry; dest: string } =>
            p.dest !== null,
        );
      if (unsafe.length > 0) {
        toast.error(
          t("fileManager.localUnsafeNamesSkipped", { count: unsafe.length }),
          { description: unsafe.slice(0, 3).join(", ") },
        );
        console.warn("Skipped remote items with unsafe local names:", unsafe);
      }
      if (plannedFiles.length === 0 && plannedDirs.length === 0) {
        return;
      }

      // Collision policy: never replace silently. Find destinations that
      // already exist and let the user choose Replace or Skip for the batch.
      const destinations = plannedFiles.map((p) => p.dest);
      let existing: Set<string>;
      try {
        existing = new Set(await localPathsExist(destinations));
      } catch (error) {
        toast.error(
          t("fileManager.localDownloadFailed"),
          error instanceof Error ? { description: error.message } : undefined,
        );
        return;
      }
      let overwriteExisting = false;
      if (existing.size > 0) {
        overwriteExisting = await askReplaceExisting(t, existing.size);
      }
      const skipped = overwriteExisting
        ? []
        : plannedFiles.filter(({ dest }) => existing.has(dest));
      const work = overwriteExisting
        ? plannedFiles
        : plannedFiles.filter(({ dest }) => !existing.has(dest));
      if (skipped.length > 0) {
        toast.info(
          t("fileManager.localSkippedExisting", { count: skipped.length }),
        );
      }
      if (work.length === 0 && plannedDirs.length === 0) {
        onLocalChanged(localDir);
        return;
      }
      const workBytes = work.reduce((sum, w) => sum + (w.entry.size ?? 0), 0);

      await runBatch(
        "download",
        work.length,
        workBytes,
        async ({ isCancelled, trackTransfer, progress, settleTransfer }) => {
          for (const { dest } of plannedDirs) {
            if (isCancelled()) throw new TransferCancelledError();
            await ensureLocalDirectory(dest, localDir);
          }

          const failed: string[] = [];
          let reason: string | undefined;
          await runWithConcurrency(
            work,
            getTransferConcurrency(),
            async ({ entry, dest }) => {
              const fileName = entry.relativePath.split("/").pop()!;
              const transferId = createLocalTransferId("local-download");
              trackTransfer(transferId, fileName);
              try {
                await downloadSessionFileToLocal({
                  sessionId,
                  remotePath: entry.remotePath,
                  destPath: dest,
                  rootPath: localDir,
                  expectedSize: entry.size,
                  overwrite: overwriteExisting && existing.has(dest),
                  transferId,
                  onProgress: ({ transferred }) =>
                    progress(transferId, transferred),
                });
              } catch (error) {
                if (!isCancelled()) {
                  failed.push(entry.relativePath);
                  reason ??= describeTransferError(error);
                  console.error(
                    `Failed to download ${entry.remotePath}:`,
                    error,
                  );
                }
              } finally {
                settleTransfer(transferId, entry.size ?? 0);
              }
            },
            isCancelled,
          );
          return { failed, reason };
        },
      );

      onLocalChanged(localDir);
    },
    [sshSessionId, ensureSSHConnection, onLocalChanged, runBatch, t],
  );

  return { uploadLocalPaths, downloadRemoteItems };
}
