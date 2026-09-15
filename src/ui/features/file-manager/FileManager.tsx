import { getErrorMessage } from "../../lib/error-message.js";
/* eslint-disable react-hooks/exhaustive-deps */
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { asHttpError } from "@/lib/http-error";
import { cn } from "@/lib/utils.ts";
import { FileManagerGrid } from "./FileManagerGrid.tsx";
import { FileManagerSidebar, type SidebarItem } from "./FileManagerSidebar.tsx";
import { FileManagerContextMenu } from "./FileManagerContextMenu.tsx";
import { useFileSelection } from "./hooks/useFileSelection.ts";
import { useDragAndDrop } from "./hooks/useDragAndDrop.ts";
import {
  WindowManager,
  useWindowManager,
} from "./components/WindowManager.tsx";
import { FileWindow } from "./components/FileWindow.tsx";
import { DownloadProgressToast } from "./components/DownloadProgressToast.tsx";
import { DiffWindow } from "./components/DiffWindow.tsx";
import { useDragToDesktop } from "@/features/file-manager/hooks/useDragToDesktop";
import { useDragToSystemDesktop } from "@/features/file-manager/hooks/useDragToSystemDesktop";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { FileManagerDialogs } from "./FileManagerDialogs.tsx";
import { PassphraseDialog } from "@/ssh/dialogs/PassphraseDialog.tsx";
import { FileManagerToolbar } from "./FileManagerToolbar.tsx";
import { LocalFilePane } from "./LocalFilePane.tsx";
import { useLocalTransfers } from "./hooks/useLocalTransfers.ts";
import { isLocalFileBrowserAvailable } from "@/lib/local-files.ts";
import { TransferToHostDialog } from "./components/TransferToHostDialog.tsx";
import { FileManagerTrashDialog } from "./FileManagerTrashDialog.tsx";
import { TerminalWindow } from "./components/TerminalWindow.tsx";
import type { SSHHost, FileItem } from "@/types/index";
import {
  ConnectionLogProvider,
  useConnectionLog,
} from "@/ssh/connection-log/ConnectionLogContext.tsx";
import { ConnectionScreen } from "@/components/connection/ConnectionScreen.tsx";
import { ConnectionLogPanel } from "@/components/connection/ConnectionLogPanel.tsx";
import { useConnectionRetry } from "@/lib/useConnectionRetry.ts";
import { copyToClipboard } from "@/lib/clipboard.ts";
import {
  listSSHFiles,
  readSSHFile,
  resolveSSHPath,
  uploadSSHFile,
  createSSHFile,
  createSSHFolder,
  deleteSSHItem,
  copySSHItem,
  renameSSHItem,
  moveSSHItem,
  connectSSH,
  verifySSHTOTP,
  verifySSHWarpgate,
  getSSHStatus,
  keepSSHAlive,
  identifySSHSymlink,
  addRecentFile,
  addPinnedFile,
  removePinnedFile,
  removeRecentFile,
  addFolderShortcut,
  getPinnedFiles,
  logActivity,
  changeSSHPermissions,
  extractSSHArchive,
  compressSSHFiles,
  setSudoPassword,
  getServerMetricsById,
  transferToHost,
  addTransferRecent,
  type TransferMethodPreference,
  type DiskFilesystem,
} from "@/main-axios.ts";
import {
  getAdaptiveResourceBudget,
  markAdaptiveResourceUsed,
  runAdaptiveBackgroundTask,
} from "@/lib/adaptive-resource-budget";
import { shouldPrefetchFileContent } from "@/lib/file-content-request-cache";
import {
  markFilePreviewUsed,
  preloadFilePreview,
} from "./file-preview-preload";
import { beginTransferProgressMonitoring } from "./transferProgressMonitor.tsx";
import { createFormatTransferMetrics } from "./transferMetricsFormat.ts";
import type {
  CreateIntent,
  FileManagerProps,
  PendingSudoOperation,
  SSHConnectionError,
} from "./file-manager-types.ts";
import { formatFileSize, runWithConcurrency } from "./file-manager-utils.ts";
import {
  invalidateCachedFileList,
  peekCachedFileList,
  updateCachedFileList,
} from "@/lib/file-list-request-cache";
import {
  addOptimisticItem,
  childPath,
  removePaths,
  renameOptimisticItem,
  restoreItems,
} from "./optimistic-file-list";

const LOCAL_PANE_OPEN_STORAGE_KEY = "termix:file-manager:local-pane:open";
const SIDEBAR_OPEN_STORAGE_KEY = "termix:file-manager:sidebar:open";
const LOCAL_PANE_WIDTH_STORAGE_KEY = "termix:file-manager:local-pane:width";
const LOCAL_PANE_MIN_WIDTH = 300;
const LOCAL_PANE_DEFAULT_WIDTH = 440;

const LARGE_FILE_WARNING_SIZE = 50 * 1024 * 1024;

function FileManagerContent({
  initialHost,
  initialFilePath,
  initialPath,
  onClose,
  onOpenTerminalTab,
  isVisible = true,
}: FileManagerProps) {
  const { openWindow } = useWindowManager();
  const { t } = useTranslation();
  const formatTransferMetrics = useMemo(
    () => createFormatTransferMetrics(t),
    [t],
  );
  const { confirmWithToast } = useConfirmation();
  const { addLog, clearLogs } = useConnectionLog();

  const [currentHost] = useState<SSHHost | null>(initialHost || null);
  const [currentPath, setCurrentPath] = useState(
    initialPath || initialHost?.defaultPath || "/",
  );
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  const lastSuccessfulPathRef = useRef(
    initialPath || initialHost?.defaultPath || "/",
  );
  const [navHistory, setNavHistory] = useState<string[]>([
    initialPath || initialHost?.defaultPath || "/",
  ]);
  const [navIndex, setNavIndex] = useState(0);
  const [files, setFiles] = useState<FileItem[]>([]);
  const filesRef = useRef(files);
  filesRef.current = files;
  const directoryRequestRef = useRef(0);
  const [isLoading, setIsLoading] = useState(false);
  const [sshSessionId, setSshSessionId] = useState<string | null>(null);
  const sshSessionIdRef = useRef(sshSessionId);
  sshSessionIdRef.current = sshSessionId;
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    const saved = localStorage.getItem("fileManagerViewMode");
    return saved === "grid" || saved === "list" ? saved : "grid";
  });
  const [density, setDensity] = useState<"comfortable" | "compact">(() =>
    localStorage.getItem("fileManagerDensity") === "compact"
      ? "compact"
      : "comfortable",
  );
  // Picking an interface preset seeds this key from another part of the app.
  useEffect(() => {
    const handler = () => {
      const saved = localStorage.getItem("fileManagerViewMode");
      if (saved === "grid" || saved === "list") setViewMode(saved);
    };
    window.addEventListener("fileManagerViewModeChanged", handler);
    return () =>
      window.removeEventListener("fileManagerViewModeChanged", handler);
  }, []);
  const [sortBy, setSortBy] = useState<"name" | "modified" | "size">(() => {
    const saved = localStorage.getItem("fileManagerSortBy");
    return saved === "name" || saved === "modified" || saved === "size"
      ? saved
      : "name";
  });
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => {
    const saved = localStorage.getItem("fileManagerSortOrder");
    return saved === "asc" || saved === "desc" ? saved : "asc";
  });
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpSessionId, setTotpSessionId] = useState<string | null>(null);
  const [totpPrompt, setTotpPrompt] = useState<string>("");
  const [warpgateRequired, setWarpgateRequired] = useState(false);
  const [warpgateSessionId, setWarpgateSessionId] = useState<string | null>(
    null,
  );
  const [warpgateUrl, setWarpgateUrl] = useState<string>("");
  const [warpgateSecurityKey, setWarpgateSecurityKey] = useState<string>("");
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [authDialogReason, setAuthDialogReason] = useState<
    "no_keyboard" | "auth_failed" | "timeout"
  >("no_keyboard");
  const [showPassphraseDialog, setShowPassphraseDialog] = useState(false);
  const [pinnedFiles, setPinnedFiles] = useState<Set<string>>(new Set());
  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0);
  // Desktop-only Local | Remote split view (Termius-style dual pane).
  const localPaneAvailable = isLocalFileBrowserAvailable();
  const [localPaneOpen, setLocalPaneOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LOCAL_PANE_OPEN_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [localPaneRefreshToken, setLocalPaneRefreshToken] = useState(0);
  // Desktop directories sidebar visibility (mobile uses the overlay state).
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(next));
      } catch {
        // storage unavailable
      }
      return next;
    });
  }, []);
  const [localPaneWidth, setLocalPaneWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(LOCAL_PANE_WIDTH_STORAGE_KEY));
      return Number.isFinite(saved) && saved >= LOCAL_PANE_MIN_WIDTH
        ? saved
        : LOCAL_PANE_DEFAULT_WIDTH;
    } catch {
      return LOCAL_PANE_DEFAULT_WIDTH;
    }
  });
  const panesRowRef = useRef<HTMLDivElement>(null);
  const startLocalPaneResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = localPaneWidth;
      const rowWidth = panesRowRef.current?.getBoundingClientRect().width ?? 0;
      const maxWidth = Math.max(
        LOCAL_PANE_MIN_WIDTH,
        rowWidth ? rowWidth * 0.65 : Number.POSITIVE_INFINITY,
      );
      let latest = startWidth;
      const onMove = (e: MouseEvent) => {
        latest = Math.min(
          maxWidth,
          Math.max(LOCAL_PANE_MIN_WIDTH, startWidth + (e.clientX - startX)),
        );
        setLocalPaneWidth(latest);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try {
          localStorage.setItem(LOCAL_PANE_WIDTH_STORAGE_KEY, String(latest));
        } catch {
          // storage unavailable
        }
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [localPaneWidth],
  );
  const toggleLocalPane = useCallback(() => {
    setLocalPaneOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LOCAL_PANE_OPEN_STORAGE_KEY, String(next));
      } catch {
        // storage unavailable
      }
      return next;
    });
  }, []);
  const [trashOpen, setTrashOpen] = useState(false);
  const [hasConnectionError, setHasConnectionError] = useState<boolean>(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [diskInfo, setDiskInfo] = useState<{
    usedHuman: string;
    totalHuman: string;
    percent: number;
    mount: string | null;
    filesystems: DiskFilesystem[];
  } | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    isVisible: boolean;
    files: FileItem[];
  }>({
    x: 0,
    y: 0,
    isVisible: false,
    files: [],
  });

  const [clipboard, setClipboard] = useState<{
    files: FileItem[];
    operation: "copy" | "cut";
    sourceHostId: number | null;
    sourceSessionId: string | null;
  } | null>(null);

  interface UndoAction {
    type: "copy" | "cut" | "delete";
    description: string;
    data: {
      operation: "copy" | "cut";
      copiedFiles?: {
        originalPath: string;
        targetPath: string;
        targetName: string;
      }[];
      deletedFiles?: { path: string; name: string }[];
      targetDirectory?: string;
    };
    timestamp: number;
  }

  const [undoHistory, setUndoHistory] = useState<UndoAction[]>([]);

  const [createIntent, setCreateIntent] = useState<CreateIntent | null>(null);
  const [editingFile, setEditingFile] = useState<FileItem | null>(null);
  const [permissionsDialogFile, setPermissionsDialogFile] =
    useState<FileItem | null>(null);
  const [compressDialogFiles, setCompressDialogFiles] = useState<FileItem[]>(
    [],
  );
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferFiles, setTransferFiles] = useState<FileItem[]>([]);
  const [transferMove, setTransferMove] = useState(false);

  const [sudoDialogOpen, setSudoDialogOpen] = useState(false);
  const [pendingSudoOperation, setPendingSudoOperation] =
    useState<PendingSudoOperation | null>(null);

  const { selectedFiles, clearSelection, setSelection } = useFileSelection();

  const commitFilesForPath = useCallback(
    (sessionId: string, path: string, next: FileItem[]) => {
      updateCachedFileList(sessionId, path, next);
      if (
        sshSessionIdRef.current !== sessionId ||
        currentPathRef.current !== path
      ) {
        return;
      }
      directoryRequestRef.current += 1;
      filesRef.current = next;
      setFiles(next);
    },
    [],
  );

  const filesForPath = useCallback((sessionId: string, path: string) => {
    if (
      sshSessionIdRef.current === sessionId &&
      currentPathRef.current === path
    ) {
      return filesRef.current;
    }
    return peekCachedFileList(sessionId, path)?.files ?? [];
  }, []);

  const { dragHandlers } = useDragAndDrop({
    onFilesDropped: handleFilesDropped,
    onItemsDropped: handleItemsDropped,
    onError: (error) => toast.error(error),
    maxFileSize: 5120,
  });

  const dragToDesktop = useDragToDesktop({
    sshSessionId: sshSessionId || "",
    sshHost: currentHost!,
  });

  const systemDrag = useDragToSystemDesktop({
    sshSessionId: sshSessionId || "",
    sshHost: currentHost!,
  });

  const startKeepalive = useCallback(() => {
    if (!sshSessionId) return;

    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
    }

    keepaliveTimerRef.current = setInterval(async () => {
      if (sshSessionId) {
        try {
          await keepSSHAlive(sshSessionId);
        } catch (error) {
          console.error("SSH keepalive failed:", error);
        }
      }
    }, 30 * 1000);
  }, [sshSessionId]);

  const stopKeepalive = useCallback(() => {
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }
  }, []);

  const handleCloseWithError = useCallback(
    (errorMessage: string) => {
      setHasConnectionError(true);
      addLog({
        type: "error",
        stage: "connection",
        message: errorMessage,
      });
      connectRetryRef.current?.markFailed();
    },
    [addLog],
  );

  const connectRetry = useConnectionRetry({
    connect: () => {
      void initializeSSHConnection();
    },
    enabled:
      !!currentHost &&
      !sshSessionId &&
      !totpRequired &&
      !warpgateRequired &&
      !showAuthDialog &&
      !showPassphraseDialog,
    autoStart: false,
  });
  const connectRetryRef = useRef(connectRetry);
  connectRetryRef.current = connectRetry;

  useEffect(() => {
    if (currentHost) {
      connectRetryRef.current.reset();
      connectRetryRef.current.retryNow();
    }
  }, [currentHost]);

  useEffect(() => {
    if (sshSessionId && isVisible) {
      startKeepalive();
    } else {
      stopKeepalive();
    }

    return () => {
      stopKeepalive();
    };
  }, [sshSessionId, isVisible, startKeepalive, stopKeepalive]);

  const initialFileOpenedRef = useRef(false);
  useEffect(() => {
    if (!sshSessionId || !initialFilePath || initialFileOpenedRef.current)
      return;
    initialFileOpenedRef.current = true;

    const fileName = initialFilePath.split("/").pop() || initialFilePath;
    const fileDir =
      initialFilePath.lastIndexOf("/") > 0
        ? initialFilePath.substring(0, initialFilePath.lastIndexOf("/"))
        : "/";

    setCurrentPath(fileDir);

    const file: FileItem = {
      name: fileName,
      path: initialFilePath,
      type: "file",
    };

    const windowCount = Date.now() % 10;
    const offsetX = Math.min(
      120 + windowCount * 30,
      Math.max(0, window.innerWidth - 820),
    );
    const offsetY = Math.min(
      120 + windowCount * 30,
      Math.max(0, window.innerHeight - 620),
    );

    const createWindowComponent = (windowId: string) => (
      <FileWindow
        windowId={windowId}
        file={file}
        sshSessionId={sshSessionId}
        sshHost={currentHost}
        initialX={offsetX}
        initialY={offsetY}
        onFileNotFound={handleFileNotFound}
      />
    );

    openWindow({
      title: fileName,
      x: offsetX,
      y: offsetY,
      width: 800,
      height: 600,
      isMaximized: false,
      isMinimized: false,
      component: createWindowComponent,
    });
  }, [sshSessionId, initialFilePath]);

  const initialLoadDoneRef = useRef(false);
  const lastPathChangeRef = useRef<string>("");
  const pathChangeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentLoadingPathRef = useRef<string>("");
  const keepaliveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activityLoggedRef = useRef(false);
  const activityLoggingRef = useRef(false);

  const logFileManagerActivity = useCallback(async () => {
    if (
      !currentHost?.id ||
      activityLoggedRef.current ||
      activityLoggingRef.current
    ) {
      return;
    }

    activityLoggingRef.current = true;
    activityLoggedRef.current = true;

    try {
      const hostName =
        currentHost.name || `${currentHost.username}@${currentHost.ip}`;
      await logActivity("file_manager", currentHost.id, hostName);
    } catch (err) {
      console.warn("Failed to log file manager activity:", err);
      activityLoggedRef.current = false;
    } finally {
      activityLoggingRef.current = false;
    }
  }, [currentHost]);

  const handleFileDragStart = useCallback(
    (files: FileItem[]) => {
      systemDrag.startDragToSystem(files, {
        enableToast: true,
        onSuccess: () => {
          clearSelection();
        },
        onError: (error) => {
          console.error("Drag failed:", error);
        },
      });
    },
    [systemDrag, clearSelection],
  );

  const handleFileDragEnd = useCallback(
    (e: DragEvent, draggedFiles: FileItem[]) => {
      const isOutside =
        e.clientX < 0 ||
        e.clientX > window.innerWidth ||
        e.clientY < 0 ||
        e.clientY > window.innerHeight;

      if (isOutside) {
        if (draggedFiles.length === 0) {
          console.error("No files to drag - this should not happen");
          return;
        }

        systemDrag.startDragToSystem(draggedFiles, {
          enableToast: true,
          onSuccess: () => {
            clearSelection();
          },
          onError: (error) => {
            console.error("Drag failed:", error);
          },
        });
        systemDrag.handleDragEnd(e);
      } else {
        systemDrag.cancelDragToSystem();
      }
    },
    [systemDrag, clearSelection],
  );

  const isConnectingRef = useRef(false);

  async function initializeSSHConnection() {
    if (!currentHost || isConnectingRef.current) return;

    if (currentHost.enableSsh === false) {
      setHasConnectionError(true);
      addLog({
        type: "error",
        stage: "error",
        message: t("fileManager.sshRequiredForFileManager"),
      });
      setIsLoading(false);
      return;
    }

    isConnectingRef.current = true;

    try {
      setIsLoading(true);
      initialLoadDoneRef.current = false;
      setHasConnectionError(false);
      clearLogs();

      const sessionId = currentHost.id.toString();

      const result = await connectSSH(sessionId, {
        hostId: currentHost.id,
        ip: currentHost.ip,
        port: currentHost.port,
        username: currentHost.username,
        password: currentHost.password,
        sshKey: currentHost.key,
        keyPassword: currentHost.keyPassword,
        authType: currentHost.authType,
        credentialId: currentHost.credentialId,
        userId: currentHost.userId,
        forceKeyboardInteractive: currentHost.forceKeyboardInteractive,
        jumpHosts: currentHost.jumpHosts,
        useSocks5: currentHost.useSocks5,
        socks5Host: currentHost.socks5Host,
        socks5Port: currentHost.socks5Port,
        socks5Username: currentHost.socks5Username,
        socks5Password: currentHost.socks5Password,
        socks5ProxyChain: currentHost.socks5ProxyChain,
      });

      if (result?.requires_warpgate) {
        setWarpgateRequired(true);
        setWarpgateSessionId(sessionId);
        setWarpgateUrl(result.url || "");
        setWarpgateSecurityKey(result.securityKey || "N/A");
        setIsLoading(false);
        return;
      }

      if (result?.requires_totp) {
        setTotpRequired(true);
        setTotpSessionId(sessionId);
        setTotpPrompt(result.prompt || t("fileManager.verificationCodePrompt"));
        setIsLoading(false);
        return;
      }

      if (result?.status === "auth_required") {
        setAuthDialogReason(result.reason || "no_keyboard");
        setShowAuthDialog(true);
        setIsLoading(false);
        return;
      }

      if (result?.status === "passphrase_required") {
        setShowPassphraseDialog(true);
        setIsLoading(false);
        return;
      }

      setSshSessionId(sessionId);
      connectRetryRef.current.markConnected();

      try {
        const response = await listSSHFiles(sessionId, currentPath);
        const files = Array.isArray(response)
          ? response
          : response?.files || [];
        setFiles(files);
        lastSuccessfulPathRef.current = currentPath;
        clearSelection();
        initialLoadDoneRef.current = true;

        if (!result?.requires_totp) {
          logFileManagerActivity();
        }
      } catch (dirError: unknown) {
        console.error("Failed to load initial directory:", dirError);
      }
    } catch (error: unknown) {
      const sshError = error as SSHConnectionError;
      console.error("SSH connection failed:", error);

      if (sshError.connectionLogs) {
        sshError.connectionLogs.forEach((log) => {
          addLog({
            type: log.type,
            stage: log.stage,
            message: log.message,
            details: log.details,
          });
        });
        if (sshError.requires_totp) {
          setTotpRequired(true);
          setTotpSessionId(sshError.sessionId || currentHost.id.toString());
          setTotpPrompt(
            sshError.prompt || t("fileManager.verificationCodePrompt"),
          );
          setIsLoading(false);
          return;
        }
        if (sshError.requires_warpgate) {
          setWarpgateRequired(true);
          setWarpgateSessionId(sshError.sessionId || currentHost.id.toString());
          setWarpgateUrl(sshError.url || "");
          setWarpgateSecurityKey(sshError.securityKey || "N/A");
          setIsLoading(false);
          return;
        }
        if (sshError.status === "auth_required") {
          setAuthDialogReason(sshError.reason || "no_keyboard");
          setShowAuthDialog(true);
          setIsLoading(false);
          return;
        }
      } else {
        addLog({
          type: "error",
          stage: "connection",
          message:
            error instanceof Error
              ? error.message
              : t("fileManager.failedToConnect"),
        });
      }

      handleCloseWithError(
        t("fileManager.failedToConnect") +
          ": " +
          getErrorMessage(error, String(error)),
      );
    } finally {
      setIsLoading(false);
      isConnectingRef.current = false;
    }
  }

  const loadDirectory = useCallback(
    async (path: string, conflictAttempt = 0): Promise<boolean> => {
      if (!sshSessionId) {
        console.error("Cannot load directory: no SSH session ID");
        return false;
      }
      const requestId = ++directoryRequestRef.current;

      let resolvedPath = path;
      if (path.includes("$") || path.startsWith("~")) {
        resolvedPath = await resolveSSHPath(sshSessionId, path);
        if (resolvedPath !== path) {
          setCurrentPath(resolvedPath);
          lastPathChangeRef.current = resolvedPath;
        }
      }

      currentLoadingPathRef.current = resolvedPath;
      const cached = peekCachedFileList(sshSessionId, resolvedPath);
      if (cached) {
        setFiles(cached.files);
        clearSelection();
      }
      setIsLoading(!cached);

      try {
        const response = await listSSHFiles(sshSessionId, resolvedPath, {
          force: cached !== null,
        });

        if (directoryRequestRef.current !== requestId) {
          return false;
        }

        const files = Array.isArray(response)
          ? response
          : response?.files || [];

        setFiles(files);
        lastSuccessfulPathRef.current = resolvedPath;
        clearSelection();
        return true;
      } catch (error: unknown) {
        if (directoryRequestRef.current === requestId) {
          // ApiError has .status directly; raw axios errors have .response.status
          const apiError = error as {
            status?: number;
            code?: string;
            response?: {
              status?: number;
              data?: {
                needsSudo?: boolean;
                error?: string;
                sudoFailed?: boolean;
                disconnected?: boolean;
              };
            };
            message?: string;
          };

          const httpStatus = apiError.status ?? apiError.response?.status;

          // The sidebar may be listing the same path to populate its tree.
          // Retry instead of leaving the breadcrumb and visible files out of sync.
          if (httpStatus === 409) {
            if (conflictAttempt < 3) {
              await new Promise((resolve) => setTimeout(resolve, 250));
              return loadDirectory(resolvedPath, conflictAttempt + 1);
            }
            const previousPath = lastSuccessfulPathRef.current;
            lastPathChangeRef.current = previousPath;
            setCurrentPath((current) =>
              current === resolvedPath ? previousPath : current,
            );
            return false;
          }

          if (apiError.response?.data?.needsSudo) {
            const previousPath = lastSuccessfulPathRef.current;
            lastPathChangeRef.current = previousPath;
            setCurrentPath((current) =>
              current === resolvedPath ? previousPath : current,
            );
            if (!sudoDialogOpen) {
              setPendingSudoOperation({ type: "navigate", path: resolvedPath });
              setSudoDialogOpen(true);
            }

            if (apiError.response.data.sudoFailed) {
              toast.error(t("fileManager.sudoAuthFailed"));
            } else {
              toast.error(t("fileManager.permissionDenied"));
            }
            return false;
          }

          console.error("Failed to load directory:", error);

          const errorMessage =
            apiError.response?.data?.error || apiError.message || String(error);

          const isConnectionError =
            // 500s from the file manager are SSH channel/session errors
            httpStatus === 500 ||
            httpStatus === 503 ||
            apiError.response?.data?.disconnected === true ||
            errorMessage?.includes("channel open failure") ||
            errorMessage?.includes("open failed") ||
            errorMessage?.includes("SSH connection not established") ||
            errorMessage?.includes("SSH session") ||
            errorMessage?.toLowerCase().includes("not connected");

          if (isConnectionError && sshSessionId && currentHost) {
            setIsReconnecting(true);
            setIsLoading(false);
            setFiles([]);
            currentLoadingPathRef.current = "";

            void (async () => {
              const delays = [1000, 2000, 3000, 5000, 5000];
              for (let attempt = 0; attempt < delays.length; attempt++) {
                await new Promise((r) => setTimeout(r, delays[attempt]));
                try {
                  await ensureSSHConnection();
                  setIsReconnecting(false);
                  loadDirectory(resolvedPath);
                  return;
                } catch {
                  // keep retrying
                }
              }
              setIsReconnecting(false);
              handleCloseWithError(
                t("fileManager.failedToLoadDirectory") + ": " + errorMessage,
              );
            })();

            return false;
          } else if (initialLoadDoneRef.current) {
            const isPermissionDenied =
              httpStatus === 403 ||
              errorMessage?.toLowerCase().includes("permission denied") ||
              errorMessage?.toLowerCase().includes("eacces");
            if (isPermissionDenied) {
              toast.error(t("fileManager.permissionDenied"));
            } else {
              toast.error(
                t("fileManager.failedToLoadDirectory") + ": " + errorMessage,
              );
            }
          }
        }
        return false;
      } finally {
        if (directoryRequestRef.current === requestId) {
          setIsLoading(false);
          currentLoadingPathRef.current = "";
        }
      }
    },
    [sshSessionId, clearSelection, t, sudoDialogOpen, currentHost],
  );

  const debouncedLoadDirectory = useCallback(
    (path: string, force?: boolean) => {
      if (pathChangeTimerRef.current) {
        clearTimeout(pathChangeTimerRef.current);
      }

      pathChangeTimerRef.current = setTimeout(() => {
        if ((force || path !== lastPathChangeRef.current) && sshSessionId) {
          lastPathChangeRef.current = path;
          loadDirectory(path);
        }
      }, 150);
    },
    [sshSessionId, loadDirectory],
  );

  const navigateTo = useCallback(
    (path: string) => {
      directoryRequestRef.current += 1;
      const cached = sshSessionId
        ? peekCachedFileList(sshSessionId, path)
        : null;
      if (cached) setFiles(cached.files);
      setIsLoading(!!sshSessionId && !cached);
      setCurrentPath(path);
      setNavHistory((prev) => {
        const next = [...prev.slice(0, navIndex + 1), path];
        setNavIndex(next.length - 1);
        return next;
      });
    },
    [navIndex, sshSessionId],
  );

  const goBack = useCallback(() => {
    if (navIndex > 0) {
      directoryRequestRef.current += 1;
      const newIndex = navIndex - 1;
      const path = navHistory[newIndex];
      const cached = sshSessionId
        ? peekCachedFileList(sshSessionId, path)
        : null;
      if (cached) setFiles(cached.files);
      setIsLoading(!!sshSessionId && !cached);
      setNavIndex(newIndex);
      setCurrentPath(path);
    }
  }, [navIndex, navHistory, sshSessionId]);

  const goForward = useCallback(() => {
    if (navIndex < navHistory.length - 1) {
      directoryRequestRef.current += 1;
      const newIndex = navIndex + 1;
      const path = navHistory[newIndex];
      const cached = sshSessionId
        ? peekCachedFileList(sshSessionId, path)
        : null;
      if (cached) setFiles(cached.files);
      setIsLoading(!!sshSessionId && !cached);
      setNavIndex(newIndex);
      setCurrentPath(path);
    }
  }, [navIndex, navHistory, sshSessionId]);

  useEffect(() => {
    const handleMouseNavigation = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      if (event.button === 3) goBack();
      else goForward();
    };
    const preventBrowserMouseNavigation = (event: MouseEvent) => {
      if (event.button === 3 || event.button === 4) event.preventDefault();
    };

    window.addEventListener("mouseup", handleMouseNavigation);
    window.addEventListener("auxclick", preventBrowserMouseNavigation);
    return () => {
      window.removeEventListener("mouseup", handleMouseNavigation);
      window.removeEventListener("auxclick", preventBrowserMouseNavigation);
    };
  }, [goBack, goForward]);

  const goUp = useCallback(() => {
    if (currentPath === "/") return;
    const parent =
      currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
    navigateTo(parent);
  }, [currentPath, navigateTo]);

  useEffect(() => {
    if (sshSessionId && currentPath) {
      if (!initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true;
        lastPathChangeRef.current = currentPath;
        return;
      }

      debouncedLoadDirectory(currentPath);
    }

    return () => {
      if (pathChangeTimerRef.current) {
        clearTimeout(pathChangeTimerRef.current);
      }
    };
  }, [sshSessionId, currentPath, debouncedLoadDirectory]);

  const handleRefreshDirectory = useCallback(() => {
    const now = Date.now();
    const DEBOUNCE_MS = 500;

    if (now - lastRefreshTime < DEBOUNCE_MS) {
      return;
    }

    setLastRefreshTime(now);
    if (sshSessionId) invalidateCachedFileList(sshSessionId, currentPath);
    // Force reset loading state to ensure refresh is not blocked
    setIsLoading(false);
    currentLoadingPathRef.current = "";
    loadDirectory(currentPath);
  }, [currentPath, lastRefreshTime, loadDirectory, sshSessionId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ hostId: number; path: string }>)
        .detail;
      if (!detail || !currentHost?.id) return;
      if (detail.hostId === currentHost.id) {
        handleRefreshDirectory();
      }
    };
    window.addEventListener("file-manager:refresh", handler);
    return () => window.removeEventListener("file-manager:refresh", handler);
  }, [currentHost?.id, handleRefreshDirectory]);

  const localTransfers = useLocalTransfers({
    sshSessionId,
    hostId: currentHost?.id,
    ensureSSHConnection,
    onRemoteChanged: (remoteDir) => {
      if (sshSessionId) invalidateCachedFileList(sshSessionId, remoteDir);
      handleRefreshDirectory();
      setSidebarRefreshTrigger((prev) => prev + 1);
    },
    onLocalChanged: () => setLocalPaneRefreshToken((prev) => prev + 1),
  });

  // Entries dragged from the local pane onto the remote grid (or onto one of
  // its folders) upload into that folder, preserving directory structure.
  const handleLocalFilesDrop = useCallback(
    (localPaths: string[], targetDir?: FileItem) => {
      const remoteDir = targetDir?.path ?? currentPathRef.current;
      void localTransfers.uploadLocalPaths(localPaths, remoteDir);
    },
    [localTransfers],
  );

  // Remote rows dragged onto the local pane download into the folder shown
  // there (or the folder row they were dropped on).
  const handleRemoteItemsDroppedToLocal = useCallback(
    (remotePaths: string[], localDir: string) => {
      const known = new Map(files.map((f) => [f.path, f]));
      const items: FileItem[] = remotePaths.map(
        (p) =>
          known.get(p) ?? {
            name: p.split("/").filter(Boolean).pop() || p,
            path: p,
            type: "file",
          },
      );
      void localTransfers.downloadRemoteItems(items, localDir);
    },
    [files, localTransfers],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          files: FileItem[];
          operation: "copy" | "cut";
          sourceHostId: number | null;
          sourceSessionId: string | null;
        }>
      ).detail;
      if (!detail) return;
      setClipboard(detail);
    };
    window.addEventListener("file-manager:clipboard", handler);
    return () => window.removeEventListener("file-manager:clipboard", handler);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement;
      if (
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          (activeElement as HTMLElement).contentEditable === "true")
      ) {
        return;
      }

      if (event.key === "T" && event.ctrlKey && event.shiftKey) {
        event.preventDefault();
        handleOpenTerminal(currentPath);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [currentPath]);

  async function handleItemsDropped(entries: FileSystemEntry[]) {
    if (!sshSessionId) {
      toast.error(t("fileManager.noSSHConnection"));
      return;
    }

    const files: { file: File; relativePath: string }[] = [];
    const emptyDirs: string[] = [];

    async function readEntry(
      entry: FileSystemEntry,
      path: string,
    ): Promise<void> {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        );
        files.push({ file, relativePath: path });
        return;
      }

      if (!entry.isDirectory) return;

      // readEntries only hands back a page at a time and signals the end with an
      // empty batch, so drain it fully before walking into the children.
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const children: FileSystemEntry[] = [];
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (batch.length === 0) break;
        children.push(...batch);
      }

      if (children.length === 0) {
        emptyDirs.push(path);
        return;
      }

      for (const child of children) {
        await readEntry(child, `${path}/${child.name}`);
      }
    }

    try {
      for (const entry of entries) {
        await readEntry(entry, entry.name);
      }
    } catch (error) {
      toast.error(t("fileManager.failedToUploadFile"));
      console.error("Failed to read dropped folder:", error);
      return;
    }

    if (files.length === 0 && emptyDirs.length === 0) return;

    const progressToast = toast.loading(
      t("fileManager.uploadingFolderFiles", { count: files.length }),
      { duration: Infinity },
    );

    const failed: string[] = [];

    try {
      await ensureSSHConnection();

      const base = currentPath.endsWith("/") ? currentPath : currentPath + "/";

      const dirs = new Set<string>();
      for (const relativePath of [
        ...files.map((f) => f.relativePath),
        ...emptyDirs.map((d) => `${d}/`),
      ]) {
        const parts = relativePath.split("/");
        for (let i = 1; i < parts.length; i++) {
          dirs.add(parts.slice(0, i).join("/"));
        }
      }

      // Shallowest first so each parent exists before its children.
      const sortedDirs = Array.from(dirs).sort(
        (a, b) =>
          a.split("/").length - b.split("/").length || a.localeCompare(b),
      );
      for (const dir of sortedDirs) {
        const parentDir = dir.split("/").slice(0, -1).join("/");
        const targetPath = parentDir ? `${base}${parentDir}/` : base;
        const folderName = dir.split("/").pop()!;
        try {
          await createSSHFolder(
            sshSessionId,
            targetPath,
            folderName,
            currentHost?.id,
          );
        } catch {
          // directory may already exist
        }
      }

      for (const { file, relativePath } of files) {
        const dirPart = relativePath.includes("/")
          ? relativePath.substring(0, relativePath.lastIndexOf("/"))
          : "";
        const uploadPath = dirPart ? `${base}${dirPart}/` : currentPath;

        try {
          await uploadSSHFile(
            sshSessionId,
            uploadPath,
            file.name,
            file,
            currentHost?.id,
          );
        } catch (error) {
          failed.push(relativePath);
          console.error(`Failed to upload ${relativePath}:`, error);
        }
      }

      toast.dismiss(progressToast);
      if (failed.length === 0) {
        toast.success(
          t("fileManager.uploadedFolderFiles", { count: files.length }),
        );
      } else if (failed.length === files.length) {
        toast.error(t("fileManager.failedToUploadFile"));
      } else {
        toast.warning(
          t("fileManager.uploadedFolderPartial", {
            uploaded: files.length - failed.length,
            failed: failed.length,
          }),
        );
      }
      handleRefreshDirectory();
    } catch (error) {
      toast.dismiss(progressToast);
      toast.error(t("fileManager.failedToUploadFile"));
      console.error("Folder upload failed:", error);
    }
  }

  async function handleFilesDropped(fileList: FileList) {
    if (!sshSessionId) {
      toast.error(t("fileManager.noSSHConnection"));
      return;
    }

    await runWithConcurrency(Array.from(fileList), 3, handleUploadFile);
  }

  async function handleUploadFile(file: File) {
    if (!sshSessionId) return;

    const progressToast = toast.loading(
      t("fileManager.uploadingFile", {
        name: file.name,
        size: formatFileSize(file.size),
      }),
      { duration: Infinity },
    );

    const updateProgress = (p: {
      chunkIndex: number;
      totalChunks: number;
      bytesSent: number;
      totalBytes: number;
    }) => {
      const percent = Math.min(
        100,
        Math.round((p.bytesSent / p.totalBytes) * 100),
      );
      toast.loading(
        `Uploading ${file.name} — ${percent}% (chunk ${p.chunkIndex + 1}/${p.totalChunks})`,
        { id: progressToast, duration: Infinity },
      );
    };

    try {
      await ensureSSHConnection();

      await uploadSSHFile(
        sshSessionId,
        currentPath,
        file.name,
        file,
        currentHost?.id,
        undefined,
        updateProgress,
      );

      toast.dismiss(progressToast);

      toast.success(
        t("fileManager.fileUploadedSuccessfully", { name: file.name }),
      );
      handleRefreshDirectory();
    } catch (error: unknown) {
      toast.dismiss(progressToast);
      const uploadErr = error instanceof Error ? error : null;
      if (
        uploadErr?.message?.includes("connection") ||
        uploadErr?.message?.includes("established")
      ) {
        toast.error(
          t("fileManager.sshConnectionFailed", {
            name: currentHost?.name,
            ip: currentHost?.ip,
            port: currentHost?.port,
          }),
        );
      } else {
        toast.error(t("fileManager.failedToUploadFile"));
      }
      console.error("Upload failed:", error);
    }
  }

  async function handleDownloadFile(file: FileItem) {
    if (!sshSessionId) return;

    const toastId = `download-${file.path}-${Date.now()}`;
    let lastLoaded = 0;
    let lastTime = Date.now();
    let mbPerSec: number | undefined;

    try {
      await ensureSSHConnection();

      const { downloadSSHFileStream } = await import("@/main-axios.ts");

      toast.loading(<DownloadProgressToast fileName={file.name} loaded={0} />, {
        id: toastId,
        duration: Infinity,
      });

      await downloadSSHFileStream(
        sshSessionId,
        file.path,
        ({ loaded, total }) => {
          const now = Date.now();
          const deltaMs = now - lastTime;
          if (deltaMs > 200) {
            const deltaBytes = loaded - lastLoaded;
            if (deltaBytes >= 0) {
              mbPerSec = (deltaBytes / deltaMs / 1024 / 1024) * 1000;
            }
            lastLoaded = loaded;
            lastTime = now;
          }

          toast.loading(
            <DownloadProgressToast
              fileName={file.name}
              loaded={loaded}
              total={total}
              mbPerSec={mbPerSec}
            />,
            { id: toastId, duration: Infinity },
          );
        },
      );

      toast.success(
        t("fileManager.fileDownloadedSuccessfully", { name: file.name }),
        { id: toastId, duration: undefined },
      );
    } catch (error: unknown) {
      const err = error instanceof Error ? error : null;
      if (
        err?.message?.includes("connection") ||
        err?.message?.includes("established")
      ) {
        toast.error(
          t("fileManager.sshConnectionFailed", {
            name: currentHost?.name,
            ip: currentHost?.ip,
            port: currentHost?.port,
          }),
          { id: toastId, duration: undefined },
        );
      } else {
        toast.error(t("fileManager.failedToDownloadFile"), {
          id: toastId,
          duration: undefined,
        });
      }
      console.error("Download failed:", error);
    }
  }

  async function handleDeleteFiles(files: FileItem[]) {
    if (!sshSessionId || files.length === 0) return;

    let confirmMessage: string;
    if (files.length === 1) {
      const file = files[0];
      if (file.type === "directory") {
        confirmMessage = t("fileManager.confirmDeleteFolder", {
          name: file.name,
        });
      } else {
        confirmMessage = t("fileManager.confirmDeleteSingleItem", {
          name: file.name,
        });
      }
    } else {
      const hasDirectory = files.some((file) => file.type === "directory");
      const translationKey = hasDirectory
        ? "fileManager.confirmDeleteMultipleItemsWithFolders"
        : "fileManager.confirmDeleteMultipleItems";

      confirmMessage = t(translationKey, {
        count: files.length,
      });
    }

    const fullMessage = `${confirmMessage}\n\n${t("fileManager.moveToTrashWarning")}`;

    confirmWithToast(
      fullMessage,
      async () => {
        const operationPath = currentPath;
        const operationSession = sshSessionId;
        const deletedPaths = new Set(files.map((file) => file.path));
        commitFilesForPath(
          operationSession,
          operationPath,
          removePaths(
            filesForPath(operationSession, operationPath),
            deletedPaths,
          ),
        );
        clearSelection();
        let completed = 0;
        try {
          await ensureSSHConnection();

          for (const file of files) {
            await deleteSSHItem(
              sshSessionId,
              file.path,
              file.type === "directory",
              currentHost?.id,
              currentHost?.userId?.toString(),
            );
            completed += 1;
          }

          toast.success(
            t("fileManager.itemsMovedToTrash", { count: files.length }),
          );
          if (
            sshSessionIdRef.current === operationSession &&
            currentPathRef.current === operationPath
          ) {
            handleRefreshDirectory();
          } else {
            invalidateCachedFileList(operationSession, operationPath);
          }
        } catch (error: unknown) {
          commitFilesForPath(
            operationSession,
            operationPath,
            restoreItems(
              filesForPath(operationSession, operationPath),
              files.slice(completed),
            ),
          );
          const axiosError = error as {
            response?: {
              data?: { needsSudo?: boolean; error?: string };
              status?: number;
            };
            message?: string;
          };
          if (axiosError.response?.data?.needsSudo) {
            setPendingSudoOperation({
              type: "delete",
              files: files.slice(completed),
            });
            setSudoDialogOpen(true);
            return;
          }
          if (
            (axiosError.response?.data as { trashUnavailable?: boolean })
              ?.trashUnavailable &&
            window.confirm(t("fileManager.trashUnavailableConfirm"))
          ) {
            for (const file of files.slice(completed)) {
              await deleteSSHItem(
                sshSessionId,
                file.path,
                file.type === "directory",
                currentHost?.id,
                currentHost?.userId?.toString(),
                true,
              );
            }
            toast.success(
              t("fileManager.itemsDeletedSuccessfully", {
                count: files.length - completed,
              }),
            );
            handleRefreshDirectory();
            return;
          }
          if (
            axiosError.response?.status === 403 ||
            axiosError.response?.data?.error
              ?.toLowerCase()
              .includes("permission denied")
          ) {
            toast.error(t("fileManager.permissionDenied"));
          } else if (
            axiosError.message?.includes("connection") ||
            axiosError.message?.includes("established")
          ) {
            toast.error(
              t("fileManager.sshConnectionFailed", {
                name: currentHost?.name,
                ip: currentHost?.ip,
                port: currentHost?.port,
              }),
            );
          } else {
            toast.error(t("fileManager.failedToDeleteItems"));
          }
          console.error("Delete failed:", error);
        }
      },
      "destructive",
    );
  }

  async function handleSudoPasswordSubmit(password: string) {
    if (!sshSessionId || !pendingSudoOperation) return;

    try {
      await setSudoPassword(sshSessionId, password);
      setSudoDialogOpen(false);

      if (pendingSudoOperation.type === "delete") {
        for (const file of pendingSudoOperation.files) {
          await deleteSSHItem(
            sshSessionId,
            file.path,
            file.type === "directory",
            currentHost?.id,
            currentHost?.userId?.toString(),
          );
        }
        toast.success(
          t("fileManager.itemsDeletedSuccessfully", {
            count: pendingSudoOperation.files.length,
          }),
        );
        handleRefreshDirectory();
        clearSelection();
      } else if (pendingSudoOperation.type === "navigate") {
        const success = await loadDirectory(pendingSudoOperation.path);
        if (success) {
          setCurrentPath(pendingSudoOperation.path);
          setPendingSudoOperation(null);
        }
        return;
      }

      setPendingSudoOperation(null);
    } catch (error: unknown) {
      const axiosError = error as {
        response?: { data?: { needsSudo?: boolean; sudoFailed?: boolean } };
        message?: string;
      };

      if (axiosError.response?.data?.sudoFailed) {
        toast.error(t("fileManager.sudoAuthFailed"));
        setSudoDialogOpen(true);
        return;
      }

      toast.error(axiosError.message || t("fileManager.sudoOperationFailed"));
      setPendingSudoOperation(null);
    }
  }

  function handleCreateNewFolder() {
    const defaultName = generateUniqueName(
      t("fileManager.newFolderDefault"),
      "directory",
    );
    setCreateIntent({
      id: Date.now().toString(),
      type: "directory" as const,
      defaultName,
      currentName: defaultName,
    });
  }

  function handleCreateNewFile() {
    const defaultName = generateUniqueName(
      t("fileManager.newFileDefault"),
      "file",
    );
    setCreateIntent({
      id: Date.now().toString(),
      type: "file" as const,
      defaultName,
      currentName: defaultName,
    });
  }

  const handleSymlinkClick = async (file: FileItem) => {
    if (!currentHost || !sshSessionId) {
      toast.error(t("fileManager.noSSHConnection"));
      return;
    }

    try {
      const currentSessionId = sshSessionId;
      const status = await getSSHStatus(currentSessionId);
      if (!status.connected) {
        const result = await connectSSH(currentSessionId, {
          hostId: currentHost.id,
          ip: currentHost.ip,
          port: currentHost.port,
          username: currentHost.username,
          authType: currentHost.authType,
          password: currentHost.password,
          sshKey: currentHost.key,
          keyPassword: currentHost.keyPassword,
          credentialId: currentHost.credentialId,
          jumpHosts: currentHost.jumpHosts,
          useSocks5: currentHost.useSocks5,
          socks5Host: currentHost.socks5Host,
          socks5Port: currentHost.socks5Port,
          socks5Username: currentHost.socks5Username,
          socks5Password: currentHost.socks5Password,
          socks5ProxyChain: currentHost.socks5ProxyChain,
        });

        if (!result.success) {
          throw new Error(t("fileManager.failedToReconnectSSH"));
        }
      }

      const symlinkInfo = await identifySSHSymlink(currentSessionId, file.path);

      if (symlinkInfo.type === "directory") {
        setCurrentPath(symlinkInfo.target);
      } else if (symlinkInfo.type === "file") {
        const windowCount = Date.now() % 10;
        const offsetX = 120 + windowCount * 30;
        const offsetY = 120 + windowCount * 30;

        const targetFile: FileItem = {
          ...file,
          path: symlinkInfo.target,
        };

        const createWindowComponent = (windowId: string) => (
          <FileWindow
            windowId={windowId}
            file={targetFile}
            sshSessionId={currentSessionId}
            sshHost={currentHost}
            initialX={offsetX}
            initialY={offsetY}
          />
        );

        openWindow({
          title: file.name,
          x: offsetX,
          y: offsetY,
          width: 800,
          height: 600,
          isMaximized: false,
          isMinimized: false,
          component: createWindowComponent,
        });
      }
    } catch (error: unknown) {
      const httpError = asHttpError(error);
      toast.error(
        httpError.response?.data?.error ||
          httpError.message ||
          t("fileManager.failedToResolveSymlink"),
      );
    }
  };

  function openFileWindow(file: FileItem, sessionId: string) {
    const windowCount = Date.now() % 10;
    const baseOffsetX = 120 + windowCount * 30;
    const baseOffsetY = 120 + windowCount * 30;

    const maxOffsetX = Math.max(0, window.innerWidth - 800 - 100);
    const maxOffsetY = Math.max(0, window.innerHeight - 600 - 100);

    const offsetX = Math.min(baseOffsetX, maxOffsetX);
    const offsetY = Math.min(baseOffsetY, maxOffsetY);

    const createWindowComponent = (windowId: string) => (
      <FileWindow
        windowId={windowId}
        file={file}
        sshSessionId={sessionId}
        sshHost={currentHost}
        initialX={offsetX}
        initialY={offsetY}
        onFileNotFound={handleFileNotFound}
      />
    );

    openWindow({
      title: file.name,
      x: offsetX,
      y: offsetY,
      width: 800,
      height: 600,
      isMaximized: false,
      isMinimized: false,
      component: createWindowComponent,
    });
  }

  async function confirmLargeFileOpen(file: FileItem) {
    if (!file.size || file.size <= LARGE_FILE_WARNING_SIZE) return true;

    return confirmWithToast(
      {
        title: t("fileManager.largeFileWarning"),
        description: t("fileManager.largeFileWarningDesc", {
          size: formatFileSize(file.size),
        }),
        confirmText: t("fileManager.confirm"),
        cancelText: t("common.cancel"),
      },
      undefined,
      "default",
      t("common.cancel"),
      { duration: 12000 },
    );
  }

  async function handleFileOpen(file: FileItem) {
    if (file.type === "directory") {
      markAdaptiveResourceUsed("network", "directory-list");
      directoryRequestRef.current += 1;
      const cached = sshSessionId
        ? peekCachedFileList(sshSessionId, file.path)
        : null;
      if (cached) setFiles(cached.files);
      setIsLoading(!!sshSessionId && !cached);
      setCurrentPath(file.path);
      return;
    }

    if (file.type === "link") {
      await handleSymlinkClick(file);
      return;
    }

    if (!sshSessionId) {
      toast.error(t("fileManager.noSSHConnection"));
      return;
    }

    if (!(await confirmLargeFileOpen(file))) return;

    markFilePreviewUsed(file.name);
    markAdaptiveResourceUsed(
      "network",
      file.size && file.size > 128 * 1024
        ? "file-content:medium"
        : "file-content:small",
    );
    await recordRecentFile(file);
    openFileWindow(file, sshSessionId);
  }

  const prefetchFileIntent = useCallback(
    (file: FileItem) => {
      if (!sshSessionId) return;
      if (file.type === "directory") {
        runAdaptiveBackgroundTask("network", "directory-list", () =>
          listSSHFiles(sshSessionId, file.path),
        );
        return;
      }
      const budget = getAdaptiveResourceBudget("network");
      if (shouldPrefetchFileContent(file, budget.maxPrefetchBytes)) {
        preloadFilePreview(file.name);
        runAdaptiveBackgroundTask(
          "network",
          file.size && file.size > 128 * 1024
            ? "file-content:medium"
            : "file-content:small",
          () => readSSHFile(sshSessionId, file.path),
          { estimatedBytes: file.size },
        );
      }
    },
    [sshSessionId],
  );

  function handleContextMenu(event: React.MouseEvent, file?: FileItem) {
    event.preventDefault();

    let files: FileItem[];
    if (file) {
      const isFileSelected = selectedFiles.some((f) => f.path === file.path);
      files = isFileSelected ? selectedFiles : [file];
    } else {
      files = selectedFiles;
    }

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      isVisible: true,
      files,
    });
  }

  function handleSidebarItemContextMenu(
    event: React.MouseEvent,
    item: SidebarItem,
  ) {
    const file: FileItem = {
      name: item.name,
      path: item.path,
      type:
        item.type === "recent" || item.type === "pinned" ? "file" : "directory",
    };
    handleContextMenu(event, file);
  }

  function handleCopyFiles(files: FileItem[]) {
    const entry = {
      files,
      operation: "copy" as const,
      sourceHostId: currentHost?.id ?? null,
      sourceSessionId: sshSessionId,
    };
    setClipboard(entry);
    window.dispatchEvent(
      new CustomEvent("file-manager:clipboard", { detail: entry }),
    );
    toast.success(
      t("fileManager.filesCopiedToClipboard", { count: files.length }),
    );
  }

  function handleCutFiles(files: FileItem[]) {
    const entry = {
      files,
      operation: "cut" as const,
      sourceHostId: currentHost?.id ?? null,
      sourceSessionId: sshSessionId,
    };
    setClipboard(entry);
    window.dispatchEvent(
      new CustomEvent("file-manager:clipboard", { detail: entry }),
    );
    toast.success(
      t("fileManager.filesCutToClipboard", { count: files.length }),
    );
  }

  function handleCopyPath(files: FileItem[]) {
    if (files.length === 0) return;

    const paths = files.map((file) => file.path).join("\n");

    copyToClipboard(paths).then((ok) => {
      if (ok) {
        toast.success(
          files.length === 1
            ? t("fileManager.pathCopiedToClipboard")
            : t("fileManager.pathsCopiedToClipboard", { count: files.length }),
        );
      } else {
        toast.error(t("fileManager.failedToCopyPath"));
      }
    });
  }

  function handleCopyFolderLink(path: string) {
    if (!currentHost?.id) return;
    const params = new URLSearchParams({
      view: "file-manager",
      hostId: String(currentHost.id),
      path,
    });
    const url = `${window.location.origin}?${params.toString()}`;
    copyToClipboard(url).then((ok) => {
      if (ok) {
        toast.success(t("fileManager.folderLinkCopied"));
      } else {
        toast.error(t("fileManager.failedToCopyFolderLink"));
      }
    });
  }

  async function handleCrossHostPaste() {
    if (!clipboard || !sshSessionId || !currentHost) return;

    const { files, operation, sourceSessionId } = clipboard;
    if (!sourceSessionId) return;

    const sourcePaths = files.map((f) => f.path);

    try {
      const { transferId } = await transferToHost(
        sourceSessionId,
        sourcePaths,
        sshSessionId,
        currentPath,
        operation === "cut",
        "auto",
        2,
      );

      const monitorHandle = beginTransferProgressMonitoring(transferId, t, {
        formatTransferMetrics,
      });
      if (!monitorHandle) return;

      const finalStatus = await monitorHandle.waitForCompletion;

      if (
        finalStatus.status !== "success" &&
        finalStatus.status !== "partial"
      ) {
        return;
      }

      if (operation === "cut") {
        setClipboard(null);
      }

      handleRefreshDirectory();
      clearSelection();
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(
        `${t("transfer.transferError")}: ${err.message || t("fileManager.unknownError")}`,
      );
    }
  }

  async function handlePasteFiles() {
    if (!clipboard || !sshSessionId) return;

    if (
      clipboard.sourceHostId !== null &&
      clipboard.sourceHostId !== currentHost?.id
    ) {
      await handleCrossHostPaste();
      return;
    }

    try {
      await ensureSSHConnection();

      const { files, operation } = clipboard;

      let successCount = 0;
      const copiedItems: string[] = [];

      for (const file of files) {
        try {
          if (operation === "copy") {
            const result = await copySSHItem(
              sshSessionId,
              file.path,
              currentPath,
              currentHost?.id,
              currentHost?.userId?.toString(),
            );
            copiedItems.push(result.uniqueName || file.name);
            successCount++;
          } else {
            const targetPath = currentPath.endsWith("/")
              ? `${currentPath}${file.name}`
              : `${currentPath}/${file.name}`;

            if (file.path !== targetPath) {
              await moveSSHItem(
                sshSessionId,
                file.path,
                targetPath,
                currentHost?.id,
                currentHost?.userId?.toString(),
              );
              successCount++;
            }
          }
        } catch (error: unknown) {
          console.error(`Failed to ${operation} file ${file.name}:`, error);
          const axiosError = error as {
            response?: { status?: number; data?: { error?: string } };
          };
          if (
            axiosError.response?.status === 403 ||
            axiosError.response?.data?.error
              ?.toLowerCase()
              .includes("permission denied")
          ) {
            toast.error(t("fileManager.permissionDenied"));
          } else {
            toast.error(
              t("fileManager.operationFailed", {
                operation:
                  operation === "copy"
                    ? t("fileManager.copy")
                    : t("fileManager.move"),
                name: file.name,
                error: getErrorMessage(error, String(error)),
              }),
            );
          }
        }
      }

      if (successCount > 0) {
        if (operation === "copy") {
          const copiedFiles = files
            .slice(0, successCount)
            .map((file, index) => ({
              originalPath: file.path,
              targetPath: `${currentPath}/${copiedItems[index] || file.name}`,
              targetName: copiedItems[index] || file.name,
            }));

          const undoAction: UndoAction = {
            type: "copy",
            description: t("fileManager.copiedItems", { count: successCount }),
            data: {
              operation: "copy",
              copiedFiles,
              targetDirectory: currentPath,
            },
            timestamp: Date.now(),
          };
          setUndoHistory((prev) => [...prev.slice(-9), undoAction]);
        } else if (operation === "cut") {
          const movedFiles = files.slice(0, successCount).map((file) => {
            const targetPath = currentPath.endsWith("/")
              ? `${currentPath}${file.name}`
              : `${currentPath}/${file.name}`;
            return {
              originalPath: file.path,
              targetPath: targetPath,
              targetName: file.name,
            };
          });

          const undoAction: UndoAction = {
            type: "cut",
            description: t("fileManager.movedItems", { count: successCount }),
            data: {
              operation: "cut",
              copiedFiles: movedFiles,
              targetDirectory: currentPath,
            },
            timestamp: Date.now(),
          };
          setUndoHistory((prev) => [...prev.slice(-9), undoAction]);
        }
      }

      if (successCount > 0) {
        const operationText =
          operation === "copy" ? t("fileManager.copy") : t("fileManager.move");
        if (operation === "copy" && copiedItems.length > 0) {
          const hasRenamed = copiedItems.some(
            (name) => !files.some((file) => file.name === name),
          );

          if (hasRenamed) {
            toast.success(
              t("fileManager.operationCompletedSuccessfully", {
                operation: operationText,
                count: successCount,
              }),
            );
          } else {
            toast.success(
              t("fileManager.operationCompleted", {
                operation: operationText,
                count: successCount,
              }),
            );
          }
        } else {
          toast.success(
            t("fileManager.operationCompleted", {
              operation: operationText,
              count: successCount,
            }),
          );
        }
      }

      handleRefreshDirectory();
      clearSelection();

      if (operation === "cut") {
        setClipboard(null);
      }
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error, String(error));
      toast.error(`${t("fileManager.pasteFailed")}: ${errorMessage}`);
    }
  }

  async function handleExtractArchive(file: FileItem) {
    if (!sshSessionId) return;

    try {
      await ensureSSHConnection();

      toast.info(t("fileManager.extractingArchive", { name: file.name }));

      await extractSSHArchive(
        sshSessionId,
        file.path,
        undefined,
        currentHost?.id,
        currentHost?.userId?.toString(),
      );

      toast.success(
        t("fileManager.archiveExtractedSuccessfully", { name: file.name }),
      );
      handleRefreshDirectory();
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error, String(error));
      toast.error(`${t("fileManager.extractFailed")}: ${errorMessage}`);
    }
  }

  function handleOpenCompressDialog(files: FileItem[]) {
    setCompressDialogFiles(files);
  }

  async function handleCompress(archiveName: string, format: string) {
    if (!sshSessionId || compressDialogFiles.length === 0) return;

    try {
      await ensureSSHConnection();

      const paths = compressDialogFiles.map((f) => f.path);
      const fileNames = compressDialogFiles.map((f) => f.name);

      toast.info(
        t("fileManager.compressingFiles", {
          count: fileNames.length,
          name: archiveName,
        }),
      );

      await compressSSHFiles(
        sshSessionId,
        paths,
        archiveName,
        format,
        currentHost?.id,
        currentHost?.userId?.toString(),
      );

      toast.success(
        t("fileManager.filesCompressedSuccessfully", {
          name: archiveName,
        }),
      );
      handleRefreshDirectory();
      clearSelection();
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error, String(error));
      toast.error(`${t("fileManager.compressFailed")}: ${errorMessage}`);
    }
  }

  function handleOpenTransferDialog(files: FileItem[], move: boolean) {
    setTransferFiles(files);
    setTransferMove(move);
    setTransferDialogOpen(true);
  }

  async function handleTransferConfirm(
    destSessionId: string,
    destHostId: number,
    destPath: string,
    destPathLabel: string,
    methodPreference: TransferMethodPreference,
    parallelSegmentCount?: number,
  ) {
    if (!sshSessionId || !currentHost?.id || transferFiles.length === 0) return;

    const sourcePaths = transferFiles.map((f) => f.path);

    try {
      await ensureSSHConnection();

      const { transferId } = await transferToHost(
        sshSessionId,
        sourcePaths,
        destSessionId,
        destPath,
        transferMove,
        methodPreference,
        parallelSegmentCount,
      );

      const monitorHandle = beginTransferProgressMonitoring(transferId, t, {
        formatTransferMetrics,
      });
      if (!monitorHandle) return;

      const finalStatus = await monitorHandle.waitForCompletion;

      if (
        finalStatus.status !== "success" &&
        finalStatus.status !== "partial"
      ) {
        return;
      }

      void addTransferRecent(
        currentHost.id,
        destHostId,
        destPathLabel,
        destPathLabel,
      );

      window.dispatchEvent(
        new CustomEvent("file-manager:refresh", {
          detail: { hostId: destHostId, path: destPathLabel },
        }),
      );

      if (transferMove) {
        handleRefreshDirectory();
        clearSelection();
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(
        `${t("transfer.transferError")}: ${err.message || t("fileManager.unknownError")}`,
      );
    }
  }

  async function handleUndo() {
    if (undoHistory.length === 0) {
      toast.info(t("fileManager.noUndoableActions"));
      return;
    }

    const lastAction = undoHistory[undoHistory.length - 1];

    try {
      await ensureSSHConnection();

      switch (lastAction.type) {
        case "copy":
          if (lastAction.data.copiedFiles) {
            let successCount = 0;
            for (const copiedFile of lastAction.data.copiedFiles) {
              try {
                const isDirectory =
                  files.find((f) => f.path === copiedFile.targetPath)?.type ===
                  "directory";
                await deleteSSHItem(
                  sshSessionId!,
                  copiedFile.targetPath,
                  isDirectory,
                  currentHost?.id,
                  currentHost?.userId?.toString(),
                );
                successCount++;
              } catch (error: unknown) {
                console.error(
                  `Failed to delete copied file ${copiedFile.targetName}:`,
                  error,
                );
                toast.error(
                  t("fileManager.deleteCopiedFileFailed", {
                    name: copiedFile.targetName,
                    error: getErrorMessage(error, String(error)),
                  }),
                );
              }
            }

            if (successCount > 0) {
              setUndoHistory((prev) => prev.slice(0, -1));
              toast.success(
                t("fileManager.undoCopySuccess", { count: successCount }),
              );
            } else {
              toast.error(t("fileManager.undoCopyFailedDelete"));
              return;
            }
          } else {
            toast.error(t("fileManager.undoCopyFailedNoInfo"));
            return;
          }
          break;

        case "cut":
          if (lastAction.data.copiedFiles) {
            let successCount = 0;
            for (const movedFile of lastAction.data.copiedFiles) {
              try {
                await moveSSHItem(
                  sshSessionId!,
                  movedFile.targetPath,
                  movedFile.originalPath,
                  currentHost?.id,
                  currentHost?.userId?.toString(),
                );
                successCount++;
              } catch (error: unknown) {
                console.error(
                  `Failed to move back file ${movedFile.targetName}:`,
                  error,
                );
                toast.error(
                  t("fileManager.moveBackFileFailed", {
                    name: movedFile.targetName,
                    error: getErrorMessage(error, String(error)),
                  }),
                );
              }
            }

            if (successCount > 0) {
              setUndoHistory((prev) => prev.slice(0, -1));
              toast.success(
                t("fileManager.undoMoveSuccess", { count: successCount }),
              );
            } else {
              toast.error(t("fileManager.undoMoveFailedMove"));
              return;
            }
          } else {
            toast.error(t("fileManager.undoMoveFailedNoInfo"));
            return;
          }
          break;

        case "delete":
          toast.info(t("fileManager.undoDeleteNotSupported"));
          setUndoHistory((prev) => prev.slice(0, -1));
          return;

        default:
          toast.error(t("fileManager.undoTypeNotSupported"));
          return;
      }

      handleRefreshDirectory();
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error, String(error));
      toast.error(`${t("fileManager.undoOperationFailed")}: ${errorMessage}`);
      console.error("Undo failed:", error);
    }
  }

  function handleRenameFile(file: FileItem) {
    setEditingFile(file);
  }

  function handleOpenPermissionsDialog(file: FileItem) {
    setPermissionsDialogFile(file);
  }

  async function handleSavePermissions(file: FileItem, permissions: string) {
    if (!sshSessionId) {
      toast.error(t("fileManager.noSSHConnection"));
      return;
    }

    try {
      await changeSSHPermissions(
        sshSessionId,
        file.path,
        permissions,
        currentHost?.id,
        currentHost?.userId?.toString(),
      );

      toast.success(t("fileManager.permissionsChangedSuccessfully"));
      await handleRefreshDirectory();
    } catch (error: unknown) {
      console.error("Failed to change permissions:", error);
      toast.error(t("fileManager.failedToChangePermissions"));
      throw error;
    }
  }

  async function ensureSSHConnection() {
    if (!sshSessionId || !currentHost) return;

    const status = await getSSHStatus(sshSessionId);

    if (!status.connected) {
      await connectSSH(sshSessionId, {
        hostId: currentHost.id,
        ip: currentHost.ip,
        port: currentHost.port,
        username: currentHost.username,
        password: currentHost.password,
        sshKey: currentHost.key,
        keyPassword: currentHost.keyPassword,
        authType: currentHost.authType,
        credentialId: currentHost.credentialId,
        userId: currentHost.userId,
        jumpHosts: currentHost.jumpHosts,
        useSocks5: currentHost.useSocks5,
        socks5Host: currentHost.socks5Host,
        socks5Port: currentHost.socks5Port,
        socks5Username: currentHost.socks5Username,
        socks5Password: currentHost.socks5Password,
        socks5ProxyChain: currentHost.socks5ProxyChain,
      });
    }
  }

  async function handleConfirmCreate(name: string) {
    if (!createIntent || !sshSessionId) return;

    const operationPath = currentPath;
    const operationSession = sshSessionId;
    const optimisticPath = childPath(operationPath, name);
    const previousFiles = filesForPath(operationSession, operationPath);
    const optimisticFiles = addOptimisticItem(
      previousFiles,
      operationPath,
      name,
      createIntent.type,
    );
    const didAddOptimistically = optimisticFiles !== previousFiles;
    commitFilesForPath(operationSession, operationPath, optimisticFiles);
    const createdType = createIntent.type;
    setCreateIntent(null);

    try {
      await ensureSSHConnection();

      if (createdType === "file") {
        await createSSHFile(
          sshSessionId,
          currentPath,
          name,
          "",
          currentHost?.id,
          currentHost?.userId?.toString(),
        );
        toast.success(t("fileManager.fileCreatedSuccessfully", { name }));
      } else {
        await createSSHFolder(
          sshSessionId,
          currentPath,
          name,
          currentHost?.id,
          currentHost?.userId?.toString(),
        );
        toast.success(t("fileManager.folderCreatedSuccessfully", { name }));
      }

      if (
        sshSessionIdRef.current === operationSession &&
        currentPathRef.current === operationPath
      ) {
        handleRefreshDirectory();
      } else {
        invalidateCachedFileList(operationSession, operationPath);
      }
    } catch (error: unknown) {
      if (didAddOptimistically) {
        commitFilesForPath(
          operationSession,
          operationPath,
          removePaths(
            filesForPath(operationSession, operationPath),
            new Set([optimisticPath]),
          ),
        );
      }
      const axiosError = error as {
        response?: { status?: number; data?: { error?: string } };
      };
      if (
        axiosError.response?.status === 403 ||
        axiosError.response?.data?.error
          ?.toLowerCase()
          .includes("permission denied")
      ) {
        toast.error(t("fileManager.permissionDenied"));
      } else {
        toast.error(t("fileManager.failedToCreateItem"));
      }
      console.error("Create failed:", error);
    }
  }

  function handleCancelCreate() {
    setCreateIntent(null);
  }

  async function handleRenameConfirm(file: FileItem, newName: string) {
    if (!sshSessionId) return;

    const operationPath = currentPath;
    const operationSession = sshSessionId;
    const renamedPath = childPath(
      file.path.slice(0, Math.max(1, file.path.lastIndexOf("/"))),
      newName,
    );
    const operationFiles = filesForPath(operationSession, operationPath);
    const didRenameOptimistically = !operationFiles.some(
      (entry) => entry.path === renamedPath && entry.path !== file.path,
    );
    if (didRenameOptimistically) {
      commitFilesForPath(
        operationSession,
        operationPath,
        renameOptimisticItem(operationFiles, file.path, newName),
      );
    }
    setEditingFile(null);

    try {
      await ensureSSHConnection();

      await renameSSHItem(
        sshSessionId,
        file.path,
        newName,
        currentHost?.id,
        currentHost?.userId?.toString(),
      );

      toast.success(
        t("fileManager.itemRenamedSuccessfully", { name: newName }),
      );
      if (
        sshSessionIdRef.current === operationSession &&
        currentPathRef.current === operationPath
      ) {
        handleRefreshDirectory();
      } else {
        invalidateCachedFileList(operationSession, operationPath);
      }
    } catch (error: unknown) {
      if (didRenameOptimistically) {
        commitFilesForPath(
          operationSession,
          operationPath,
          renameOptimisticItem(
            filesForPath(operationSession, operationPath),
            renamedPath,
            file.name,
          ),
        );
      }
      const axiosError = error as {
        response?: { status?: number; data?: { error?: string } };
      };
      if (
        axiosError.response?.status === 403 ||
        axiosError.response?.data?.error
          ?.toLowerCase()
          .includes("permission denied")
      ) {
        toast.error(t("fileManager.permissionDenied"));
      } else {
        toast.error(t("fileManager.failedToRenameItem"));
      }
      console.error("Rename failed:", error);
    }
  }

  function handleStartEdit(file: FileItem) {
    setEditingFile(file);
  }

  function handleCancelEdit() {
    setEditingFile(null);
  }

  async function handleTotpSubmit(code: string) {
    if (!totpSessionId || !code) return;

    try {
      setIsLoading(true);
      const result = await verifySSHTOTP(totpSessionId, code);

      if (result?.status === "success") {
        setTotpRequired(false);
        setTotpPrompt("");
        setSshSessionId(totpSessionId);
        setTotpSessionId(null);
        connectRetryRef.current.markConnected();

        try {
          const response = await listSSHFiles(totpSessionId, currentPath);
          const files = Array.isArray(response)
            ? response
            : response?.files || [];
          setFiles(files);
          clearSelection();
          initialLoadDoneRef.current = true;
          toast.success(t("fileManager.connectedSuccessfully"));

          logFileManagerActivity();
        } catch (dirError: unknown) {
          console.error("Failed to load initial directory:", dirError);
        }
      }
    } catch (error: unknown) {
      console.error("TOTP verification failed:", error);
      toast.error(t("fileManager.totpVerificationFailed"));
    } finally {
      setIsLoading(false);
    }
  }

  function handleTotpCancel() {
    setTotpRequired(false);
    setTotpPrompt("");
    setTotpSessionId(null);
    if (onClose) onClose();
  }

  async function handleWarpgateContinue() {
    if (!warpgateSessionId) return;

    try {
      setIsLoading(true);
      const result = await verifySSHWarpgate(warpgateSessionId);

      if (result?.status === "success") {
        setWarpgateRequired(false);
        setWarpgateUrl("");
        setWarpgateSecurityKey("");
        setSshSessionId(warpgateSessionId);
        setWarpgateSessionId(null);
        connectRetryRef.current.markConnected();

        try {
          const response = await listSSHFiles(warpgateSessionId, currentPath);
          const files = Array.isArray(response)
            ? response
            : response?.files || [];
          setFiles(files);
          clearSelection();
          initialLoadDoneRef.current = true;
          toast.success(t("fileManager.connectedSuccessfully"));

          logFileManagerActivity();
        } catch (dirError: unknown) {
          console.error("Failed to load initial directory:", dirError);
        }
      }
    } catch (error: unknown) {
      console.error("Warpgate verification failed:", error);
      toast.error(t("fileManager.warpgateVerificationFailed"));
    } finally {
      setIsLoading(false);
    }
  }

  function handleWarpgateCancel() {
    setWarpgateRequired(false);
    setWarpgateUrl("");
    setWarpgateSecurityKey("");
    setWarpgateSessionId(null);
    if (onClose) onClose();
  }

  function handleWarpgateOpenUrl() {
    if (warpgateUrl) {
      window.open(warpgateUrl, "_blank", "noopener,noreferrer");
    }
  }

  async function handleAuthDialogSubmit(credentials: {
    password?: string;
    sshKey?: string;
    keyPassword?: string;
  }) {
    if (!currentHost) return;

    try {
      setIsLoading(true);
      setShowAuthDialog(false);

      const sessionId = currentHost.id.toString();

      const result = await connectSSH(sessionId, {
        hostId: currentHost.id,
        ip: currentHost.ip,
        port: currentHost.port,
        username: currentHost.username,
        password: credentials.password,
        sshKey: credentials.sshKey,
        keyPassword: credentials.keyPassword,
        authType: credentials.password ? "password" : "key",
        credentialId: currentHost.credentialId,
        userId: currentHost.userId,
        jumpHosts: currentHost.jumpHosts,
        useSocks5: currentHost.useSocks5,
        socks5Host: currentHost.socks5Host,
        socks5Port: currentHost.socks5Port,
        socks5Username: currentHost.socks5Username,
        socks5Password: currentHost.socks5Password,
        socks5ProxyChain: currentHost.socks5ProxyChain,
      });

      if (result?.requires_warpgate) {
        setWarpgateRequired(true);
        setWarpgateSessionId(sessionId);
        setWarpgateUrl(result.url || "");
        setWarpgateSecurityKey(result.securityKey || "N/A");
        setIsLoading(false);
        return;
      }

      if (result?.requires_totp) {
        setTotpRequired(true);
        setTotpSessionId(sessionId);
        setTotpPrompt(result.prompt || t("fileManager.verificationCodePrompt"));
        setIsLoading(false);
        return;
      }

      if (result?.status === "auth_required") {
        setAuthDialogReason(result.reason || "auth_failed");
        setShowAuthDialog(true);
        setIsLoading(false);
        toast.error(t("fileManager.authenticationFailed"));
        return;
      }

      setSshSessionId(sessionId);
      connectRetryRef.current.markConnected();

      try {
        const response = await listSSHFiles(sessionId, currentPath);
        const files = Array.isArray(response)
          ? response
          : response?.files || [];
        setFiles(files);
        clearSelection();
        initialLoadDoneRef.current = true;
        toast.success(t("fileManager.connectedSuccessfully"));
        logFileManagerActivity();
      } catch (dirError: unknown) {
        console.error("Failed to load initial directory:", dirError);
      }
    } catch (error: unknown) {
      console.error("SSH connection with credentials failed:", error);
      setAuthDialogReason("auth_failed");
      setShowAuthDialog(true);
      toast.error(
        t("fileManager.failedToConnect") +
          ": " +
          getErrorMessage(error, String(error)),
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleAuthDialogCancel() {
    setShowAuthDialog(false);
    if (onClose) onClose();
  }

  async function handlePassphraseSubmit(passphrase: string) {
    if (!currentHost) return;

    try {
      setIsLoading(true);
      setShowPassphraseDialog(false);

      const sessionId = currentHost.id.toString();

      const result = await connectSSH(sessionId, {
        hostId: currentHost.id,
        ip: currentHost.ip,
        port: currentHost.port,
        username: currentHost.username,
        sshKey: currentHost.key,
        keyPassword: passphrase,
        authType: "key",
        credentialId: currentHost.credentialId,
        userId: currentHost.userId,
        jumpHosts: currentHost.jumpHosts,
        useSocks5: currentHost.useSocks5,
        socks5Host: currentHost.socks5Host,
        socks5Port: currentHost.socks5Port,
        socks5Username: currentHost.socks5Username,
        socks5Password: currentHost.socks5Password,
        socks5ProxyChain: currentHost.socks5ProxyChain,
      });

      if (result?.status === "passphrase_required") {
        setShowPassphraseDialog(true);
        setIsLoading(false);
        toast.error(t("fileManager.incorrectPassphrase"));
        return;
      }

      if (result?.requires_totp) {
        setTotpRequired(true);
        setTotpSessionId(sessionId);
        setTotpPrompt(result.prompt || t("fileManager.verificationCodePrompt"));
        setIsLoading(false);
        return;
      }

      if (result?.status === "auth_required") {
        setAuthDialogReason(result.reason || "auth_failed");
        setShowAuthDialog(true);
        setIsLoading(false);
        return;
      }

      setSshSessionId(sessionId);
      connectRetryRef.current.markConnected();

      try {
        const response = await listSSHFiles(sessionId, currentPath);
        const files = Array.isArray(response)
          ? response
          : response?.files || [];
        setFiles(files);
        clearSelection();
        initialLoadDoneRef.current = true;
        toast.success(t("fileManager.connectedSuccessfully"));
        logFileManagerActivity();
      } catch (dirError: unknown) {
        console.error("Failed to load initial directory:", dirError);
      }
    } catch (error: unknown) {
      console.error("SSH connection with passphrase failed:", error);
      setShowPassphraseDialog(true);
      toast.error(t("fileManager.incorrectPassphrase"));
    } finally {
      setIsLoading(false);
    }
  }

  function handlePassphraseCancel() {
    setShowPassphraseDialog(false);
    if (onClose) onClose();
  }

  function generateUniqueName(
    baseName: string,
    type: "file" | "directory",
  ): string {
    const existingNames = files.map((f) => f.name.toLowerCase());
    let candidateName = baseName;
    let counter = 1;

    while (existingNames.includes(candidateName.toLowerCase())) {
      if (type === "file" && baseName.includes(".")) {
        const lastDotIndex = baseName.lastIndexOf(".");
        const nameWithoutExt = baseName.substring(0, lastDotIndex);
        const extension = baseName.substring(lastDotIndex);
        candidateName = `${nameWithoutExt}${counter}${extension}`;
      } else {
        candidateName = `${baseName}${counter}`;
      }
      counter++;
    }

    return candidateName;
  }

  async function handleFileDrop(
    draggedFiles: FileItem[],
    targetFolder: FileItem,
  ) {
    if (!sshSessionId || targetFolder.type !== "directory") return;

    try {
      await ensureSSHConnection();

      let successCount = 0;
      const movedItems: string[] = [];

      for (const file of draggedFiles) {
        try {
          const targetPath = targetFolder.path.endsWith("/")
            ? `${targetFolder.path}${file.name}`
            : `${targetFolder.path}/${file.name}`;

          if (file.path !== targetPath) {
            await moveSSHItem(
              sshSessionId,
              file.path,
              targetPath,
              currentHost?.id,
              currentHost?.userId?.toString(),
            );
            movedItems.push(file.name);
            successCount++;
          }
        } catch (error: unknown) {
          console.error(`Failed to move file ${file.name}:`, error);
          toast.error(
            t("fileManager.moveFileFailed", { name: file.name }) +
              ": " +
              getErrorMessage(error, String(error)),
          );
        }
      }

      if (successCount > 0) {
        const movedFiles = draggedFiles.slice(0, successCount).map((file) => {
          const targetPath = targetFolder.path.endsWith("/")
            ? `${targetFolder.path}${file.name}`
            : `${targetFolder.path}/${file.name}`;
          return {
            originalPath: file.path,
            targetPath: targetPath,
            targetName: file.name,
          };
        });

        const undoAction: UndoAction = {
          type: "cut",
          description: t("fileManager.dragMovedItems", {
            count: successCount,
            target: targetFolder.name,
          }),
          data: {
            operation: "cut",
            copiedFiles: movedFiles,
            targetDirectory: targetFolder.path,
          },
          timestamp: Date.now(),
        };
        setUndoHistory((prev) => [...prev.slice(-9), undoAction]);

        toast.success(
          t("fileManager.successfullyMovedItems", {
            count: successCount,
            target: targetFolder.name,
          }),
        );
        handleRefreshDirectory();
        clearSelection();
      }
    } catch (error: unknown) {
      console.error("Drag move operation failed:", error);
      toast.error(
        t("fileManager.moveOperationFailed") +
          ": " +
          getErrorMessage(error, String(error)),
      );
    }
  }

  function handleFileDiff(file1: FileItem, file2: FileItem) {
    if (file1.type !== "file" || file2.type !== "file") {
      toast.error(t("fileManager.canOnlyCompareFiles"));
      return;
    }

    if (!sshSessionId) {
      toast.error(t("fileManager.noSSHConnection"));
      return;
    }

    const offsetX = 100;
    const offsetY = 80;

    const windowId = `diff-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const createWindowComponent = (windowId: string) => (
      <DiffWindow
        windowId={windowId}
        file1={file1}
        file2={file2}
        sshSessionId={sshSessionId}
        sshHost={currentHost}
        initialX={offsetX}
        initialY={offsetY}
      />
    );

    openWindow({
      title: t("fileManager.fileComparison", {
        file1: file1.name,
        file2: file2.name,
      }),
      x: offsetX,
      y: offsetY,
      width: 800,
      height: 600,
      isMaximized: false,
      isMinimized: false,
      component: createWindowComponent,
    });

    toast.success(
      t("fileManager.comparingFiles", { file1: file1.name, file2: file2.name }),
    );
  }

  async function handleDragToDesktop(files: FileItem[]) {
    if (!currentHost || !sshSessionId) {
      toast.error(t("fileManager.noSSHConnection"));
      return;
    }

    try {
      if (systemDrag.isFileSystemAPISupported) {
        await systemDrag.handleDragToSystem(files, {
          enableToast: true,
          onError: (error) => {
            console.error("System-level drag failed:", error);
          },
        });
      } else {
        if (files.length === 1) {
          await dragToDesktop.dragFileToDesktop(files[0]);
        } else if (files.length > 1) {
          await dragToDesktop.dragFilesToDesktop(files);
        }
      }
    } catch (error: unknown) {
      console.error("Drag to desktop failed:", error);
      toast.error(
        t("fileManager.dragFailed") +
          ": " +
          getErrorMessage(error, String(error)),
      );
    }
  }

  function handleOpenTerminal(path: string) {
    if (!currentHost) {
      toast.error(t("fileManager.noHostSelected"));
      return;
    }

    const windowCount = Date.now() % 10;
    const offsetX = 200 + windowCount * 40;
    const offsetY = 150 + windowCount * 40;

    const createTerminalComponent = (windowId: string) => (
      <TerminalWindow
        windowId={windowId}
        hostConfig={currentHost}
        initialPath={path}
        initialX={offsetX}
        initialY={offsetY}
        onPromoteToTab={onOpenTerminalTab}
      />
    );

    openWindow({
      title: t("fileManager.terminal", { host: currentHost.name, path }),
      x: offsetX,
      y: offsetY,
      width: 800,
      height: 500,
      isMaximized: false,
      isMinimized: false,
      component: createTerminalComponent,
    });

    toast.success(
      t("terminal.terminalWithPath", { host: currentHost.name, path }),
    );
  }

  function handleRunExecutable(file: FileItem) {
    if (!currentHost) {
      toast.error(t("fileManager.noHostSelected"));
      return;
    }

    if (file.type !== "file" || !file.executable) {
      toast.error(t("fileManager.onlyRunExecutableFiles"));
      return;
    }

    const fileDir = file.path.substring(0, file.path.lastIndexOf("/"));
    const fileName = file.name;
    const executeCmd = `./${fileName}`;

    const windowCount = Date.now() % 10;
    const offsetX = 250 + windowCount * 40;
    const offsetY = 200 + windowCount * 40;

    const createExecutionTerminal = (windowId: string) => (
      <TerminalWindow
        windowId={windowId}
        hostConfig={currentHost}
        initialPath={fileDir}
        initialX={offsetX}
        initialY={offsetY}
        executeCommand={executeCmd}
        onPromoteToTab={onOpenTerminalTab}
      />
    );

    openWindow({
      title: t("fileManager.runningFile", { file: file.name }),
      x: offsetX,
      y: offsetY,
      width: 800,
      height: 500,
      isMaximized: false,
      isMinimized: false,
      component: createExecutionTerminal,
    });

    toast.success(t("fileManager.runningFile", { file: file.name }));
  }

  async function loadPinnedFiles() {
    if (!currentHost?.id) return;

    try {
      const pinnedData = await getPinnedFiles(currentHost.id);
      const pinnedPaths = new Set(pinnedData.map((item) => item.path));
      setPinnedFiles(pinnedPaths);
    } catch (error) {
      console.error("Failed to load pinned files:", error);
    }
  }

  async function handlePinFile(file: FileItem) {
    if (!currentHost?.id) return;

    try {
      await addPinnedFile(currentHost.id, file.path, file.name);
      setPinnedFiles((prev) => new Set([...prev, file.path]));
      setSidebarRefreshTrigger((prev) => prev + 1);
      toast.success(
        t("fileManager.filePinnedSuccessfully", { name: file.name }),
      );
    } catch (error) {
      console.error("Failed to pin file:", error);
      toast.error(t("fileManager.pinFileFailed"));
    }
  }

  async function handleUnpinFile(file: FileItem) {
    if (!currentHost?.id) return;

    try {
      await removePinnedFile(currentHost.id, file.path);
      setPinnedFiles((prev) => {
        const newSet = new Set(prev);
        newSet.delete(file.path);
        return newSet;
      });
      setSidebarRefreshTrigger((prev) => prev + 1);
      toast.success(
        t("fileManager.fileUnpinnedSuccessfully", { name: file.name }),
      );
    } catch (error) {
      console.error("Failed to unpin file:", error);
      toast.error(t("fileManager.unpinFileFailed"));
    }
  }

  async function handleAddShortcut(path: string) {
    if (!currentHost?.id) return;

    try {
      const folderName = path.split("/").pop() || path;
      await addFolderShortcut(currentHost.id, path, folderName);
      setSidebarRefreshTrigger((prev) => prev + 1);
      toast.success(
        t("fileManager.shortcutAddedSuccessfully", { name: folderName }),
      );
    } catch (error) {
      console.error("Failed to add shortcut:", error);
      toast.error(t("fileManager.addShortcutFailed"));
    }
  }

  function isPinnedFile(file: FileItem): boolean {
    return pinnedFiles.has(file.path);
  }

  async function recordRecentFile(file: FileItem) {
    if (!currentHost?.id || file.type === "directory") return;

    try {
      await addRecentFile(currentHost.id, file.path, file.name);
      setSidebarRefreshTrigger((prev) => prev + 1);
    } catch (error) {
      console.error("Failed to record recent file:", error);
    }
  }

  async function handleSidebarFileOpen(sidebarItem: SidebarItem) {
    const file: FileItem = {
      name: sidebarItem.name,
      path: sidebarItem.path,
      type: "file",
    };

    await handleFileOpen(file);
  }

  async function handleFileNotFound(file: FileItem) {
    if (!currentHost) return;

    try {
      await removeRecentFile(currentHost.id, file.path);

      await removePinnedFile(currentHost.id, file.path);

      setSidebarRefreshTrigger((prev) => prev + 1);
    } catch (error) {
      console.error("Failed to cleanup missing file:", error);
    }
  }

  useEffect(() => {
    setCreateIntent(null);
  }, [currentPath]);

  useEffect(() => {
    if (currentHost?.id) {
      loadPinnedFiles();
      getServerMetricsById(currentHost.id)
        .then((metrics) => {
          if (
            metrics?.disk?.percent != null &&
            metrics.disk.usedHuman &&
            metrics.disk.totalHuman
          ) {
            setDiskInfo({
              usedHuman: metrics.disk.usedHuman,
              totalHuman: metrics.disk.totalHuman,
              percent: metrics.disk.percent,
              mount: metrics.disk.mount ?? null,
              filesystems: metrics.disk.filesystems ?? [],
            });
          }
        })
        .catch(() => {});
    }
  }, [currentHost?.id]);

  useEffect(() => {
    localStorage.setItem("fileManagerViewMode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem("fileManagerDensity", density);
  }, [density]);

  useEffect(() => {
    localStorage.setItem("fileManagerSortBy", sortBy);
    localStorage.setItem("fileManagerSortOrder", sortOrder);
  }, [sortBy, sortOrder]);

  const filteredFiles = useMemo(
    () =>
      files
        .filter((file) =>
          file.name.toLowerCase().includes(searchQuery.toLowerCase()),
        )
        .sort((a, b) => {
          if (a.type === "directory" && b.type !== "directory") return -1;
          if (a.type !== "directory" && b.type === "directory") return 1;

          let result = 0;
          switch (sortBy) {
            case "name":
              result = a.name.localeCompare(b.name, undefined, {
                numeric: true,
                sensitivity: "base",
              });
              break;
            case "modified":
              result = (a.modifiedTimestamp || 0) - (b.modifiedTimestamp || 0);
              break;
            case "size":
              result = (a.size || 0) - (b.size || 0);
              break;
          }
          return sortOrder === "desc" ? -result : result;
        }),
    [files, searchQuery, sortBy, sortOrder],
  );

  if (!currentHost) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-muted-foreground mb-4">
            {t("fileManager.selectHostToStart")}
          </p>
        </div>
      </div>
    );
  }

  if ((isLoading || isReconnecting) && !sshSessionId) {
    return (
      <div className="h-full w-full flex flex-col bg-background relative">
        <ConnectionScreen
          status={isReconnecting ? "connecting" : connectRetry.status}
          message={t("fileManager.connecting")}
          attempt={connectRetry.attempt}
          maxAttempts={connectRetry.maxAttempts}
          nextRetryInMs={connectRetry.nextRetryInMs}
          onManualRetry={connectRetry.retryNow}
          logPosition={hasConnectionError ? "top" : "bottom"}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background relative overflow-hidden isolate">
      <div className="h-full w-full flex flex-col min-h-0">
        <FileManagerToolbar
          t={t}
          currentPath={currentPath}
          navIndex={navIndex}
          navHistoryLength={navHistory.length}
          isLoading={isLoading}
          sshSessionId={sshSessionId}
          selectedFiles={selectedFiles}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          viewMode={viewMode}
          setViewMode={setViewMode}
          density={density}
          setDensity={setDensity}
          sortBy={sortBy}
          setSortBy={setSortBy}
          sortOrder={sortOrder}
          setSortOrder={setSortOrder}
          setMobileSidebarOpen={setMobileSidebarOpen}
          goBack={goBack}
          goForward={goForward}
          goUp={goUp}
          navigateTo={navigateTo}
          handleRefreshDirectory={handleRefreshDirectory}
          handleDeleteFiles={handleDeleteFiles}
          handleCopyFiles={handleCopyFiles}
          handleFilesDropped={handleFilesDropped}
          handleCreateNewFolder={handleCreateNewFolder}
          handleCreateNewFile={handleCreateNewFile}
          showLocalPaneToggle={localPaneAvailable}
          localPaneOpen={localPaneAvailable && localPaneOpen}
          onToggleLocalPane={toggleLocalPane}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
        />

        <div
          ref={panesRowRef}
          className="flex-1 flex px-3 pb-3 pt-2 gap-3 min-h-0 relative"
          {...dragHandlers}
        >
          {/* Mobile sidebar backdrop */}
          {mobileSidebarOpen && (
            <div
              className="fixed inset-0 z-20 bg-black/40 md:hidden"
              onClick={() => setMobileSidebarOpen(false)}
            />
          )}

          {/* Sidebar — fixed overlay on mobile, static on desktop */}
          <div
            className={cn(
              "w-56 flex-shrink-0 h-full flex flex-col",
              mobileSidebarOpen
                ? "fixed left-0 top-0 bottom-0 w-64 z-30 flex"
                : sidebarOpen
                  ? "hidden md:flex"
                  : "hidden",
            )}
          >
            <div className="flex-1 flex flex-col overflow-hidden min-h-0 border border-border bg-card">
              <FileManagerSidebar
                currentHost={currentHost}
                currentPath={currentPath}
                onPathChange={navigateTo}
                onFileOpen={handleSidebarFileOpen}
                onItemContextMenu={handleSidebarItemContextMenu}
                sshSessionId={sshSessionId}
                refreshTrigger={sidebarRefreshTrigger}
                onOpenTrash={() => setTrashOpen(true)}
                diskInfo={diskInfo ?? undefined}
              />
            </div>
          </div>

          {localPaneAvailable && localPaneOpen && (
            <>
              <div
                className="hidden md:flex flex-shrink-0 relative overflow-hidden min-h-0 flex-col border border-border bg-card"
                style={{
                  width: localPaneWidth,
                  minWidth: LOCAL_PANE_MIN_WIDTH,
                  maxWidth: "65%",
                }}
              >
                <LocalFilePane
                  refreshToken={localPaneRefreshToken}
                  onClose={toggleLocalPane}
                  onRemoteItemsDropped={handleRemoteItemsDroppedToLocal}
                  onUploadToRemote={handleLocalFilesDrop}
                />
              </div>
              {/* Drag handle between the local and remote panes */}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t("fileManager.localFiles")}
                onMouseDown={startLocalPaneResize}
                className="hidden md:block -mx-3 w-3 shrink-0 cursor-col-resize group relative z-10"
              >
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent group-hover:bg-accent-brand/60 transition-colors" />
              </div>
            </>
          )}

          <div className="flex-1 basis-0 relative overflow-hidden min-h-0 flex flex-col border border-border bg-card">
            <div className="flex-1 relative min-h-0 h-full">
              <FileManagerGrid
                files={filteredFiles}
                selectedFiles={selectedFiles}
                onFileOpen={handleFileOpen}
                onFileIntent={prefetchFileIntent}
                onSelectionChange={setSelection}
                onRefresh={handleRefreshDirectory}
                onUpload={handleFilesDropped}
                onUploadItems={handleItemsDropped}
                onLocalFilesDrop={
                  localPaneAvailable ? handleLocalFilesDrop : undefined
                }
                parentPath={
                  currentPath === "/"
                    ? null
                    : currentPath.substring(0, currentPath.lastIndexOf("/")) ||
                      "/"
                }
                onNavigateUp={goUp}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSortChange={(field) => {
                  if (field === sortBy) {
                    setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                  } else {
                    setSortBy(field);
                    setSortOrder("asc");
                  }
                }}
                onDownload={(files) =>
                  files
                    .filter((f) => f.type === "file")
                    .forEach(handleDownloadFile)
                }
                onContextMenu={handleContextMenu}
                viewMode={viewMode}
                density={density}
                onRename={handleRenameConfirm}
                editingFile={editingFile}
                onStartEdit={handleStartEdit}
                onCancelEdit={handleCancelEdit}
                onDelete={handleDeleteFiles}
                onCopy={handleCopyFiles}
                onCut={handleCutFiles}
                onPaste={handlePasteFiles}
                onUndo={handleUndo}
                hasClipboard={!!clipboard}
                onFileDrop={handleFileDrop}
                onFileDiff={handleFileDiff}
                onSystemDragStart={handleFileDragStart}
                onSystemDragEnd={handleFileDragEnd}
                createIntent={createIntent}
                onConfirmCreate={handleConfirmCreate}
                onCancelCreate={handleCancelCreate}
                onNewFile={handleCreateNewFile}
                onNewFolder={handleCreateNewFolder}
              />

              <FileManagerContextMenu
                x={contextMenu.x}
                y={contextMenu.y}
                files={contextMenu.files}
                isVisible={contextMenu.isVisible}
                onClose={() =>
                  setContextMenu((prev) => ({ ...prev, isVisible: false }))
                }
                onDownload={(files) =>
                  files
                    .filter((f) => f.type === "file")
                    .forEach(handleDownloadFile)
                }
                onPreview={handleFileOpen}
                onRename={handleRenameFile}
                onCopy={handleCopyFiles}
                onCut={handleCutFiles}
                onPaste={handlePasteFiles}
                onDelete={handleDeleteFiles}
                onUpload={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.multiple = true;
                  input.onchange = (e) => {
                    const files = (e.target as HTMLInputElement).files;
                    if (files) handleFilesDropped(files);
                  };
                  input.click();
                }}
                onNewFolder={handleCreateNewFolder}
                onNewFile={handleCreateNewFile}
                onRefresh={handleRefreshDirectory}
                hasClipboard={!!clipboard}
                onDragToDesktop={() => handleDragToDesktop(contextMenu.files)}
                onOpenTerminal={(path) => handleOpenTerminal(path)}
                onRunExecutable={(file) => handleRunExecutable(file)}
                onPinFile={handlePinFile}
                onUnpinFile={handleUnpinFile}
                onAddShortcut={handleAddShortcut}
                isPinned={isPinnedFile}
                currentPath={currentPath}
                onProperties={handleOpenPermissionsDialog}
                onExtractArchive={handleExtractArchive}
                onCompress={handleOpenCompressDialog}
                onCopyPath={handleCopyPath}
                onCopyFolderLink={handleCopyFolderLink}
                onTransferToHost={handleOpenTransferDialog}
              />
            </div>
          </div>
        </div>

        <FileManagerTrashDialog
          open={trashOpen}
          onOpenChange={setTrashOpen}
          sessionId={sshSessionId}
          onChanged={() => {
            if (sshSessionId)
              invalidateCachedFileList(sshSessionId, currentPath);
            void handleRefreshDirectory();
          }}
        />
      </div>

      {currentHost && (
        <TransferToHostDialog
          open={transferDialogOpen}
          onOpenChange={setTransferDialogOpen}
          files={transferFiles}
          move={transferMove}
          sourceHost={currentHost}
          sourceSessionId={sshSessionId}
          onConfirm={handleTransferConfirm}
        />
      )}

      {currentHost && (
        <PassphraseDialog
          isOpen={showPassphraseDialog}
          onSubmit={handlePassphraseSubmit}
          onCancel={handlePassphraseCancel}
          hostInfo={{
            ip: currentHost.ip,
            port: currentHost.port,
            username: currentHost.username,
            name: currentHost.name,
          }}
          backgroundColor="var(--bg-canvas)"
        />
      )}

      <FileManagerDialogs
        compressDialogFiles={compressDialogFiles}
        setCompressDialogFiles={setCompressDialogFiles}
        handleCompress={handleCompress}
        totpRequired={totpRequired}
        totpPrompt={totpPrompt}
        handleTotpSubmit={handleTotpSubmit}
        handleTotpCancel={handleTotpCancel}
        warpgateRequired={warpgateRequired}
        warpgateUrl={warpgateUrl}
        warpgateSecurityKey={warpgateSecurityKey}
        handleWarpgateContinue={handleWarpgateContinue}
        handleWarpgateCancel={handleWarpgateCancel}
        handleWarpgateOpenUrl={handleWarpgateOpenUrl}
        currentHost={currentHost}
        showAuthDialog={showAuthDialog}
        authDialogReason={authDialogReason}
        handleAuthDialogSubmit={handleAuthDialogSubmit}
        handleAuthDialogCancel={handleAuthDialogCancel}
        permissionsDialogFile={permissionsDialogFile}
        setPermissionsDialogFile={setPermissionsDialogFile}
        handleSavePermissions={handleSavePermissions}
        sudoDialogOpen={sudoDialogOpen}
        setSudoDialogOpen={setSudoDialogOpen}
        setPendingSudoOperation={setPendingSudoOperation}
        handleSudoPasswordSubmit={handleSudoPasswordSubmit}
      />
      <ConnectionLogPanel
        isConnecting={isReconnecting || isLoading}
        isConnected={!!sshSessionId && !isReconnecting}
        hasConnectionError={hasConnectionError}
        position={hasConnectionError ? "top" : "bottom"}
      />
    </div>
  );
}

function FileManagerInner({
  initialHost,
  initialFilePath,
  initialPath,
  onClose,
  onOpenTerminalTab,
  isVisible = true,
}: FileManagerProps) {
  return (
    <WindowManager>
      <FileManagerContent
        initialHost={initialHost}
        initialFilePath={initialFilePath}
        initialPath={initialPath}
        onClose={onClose}
        onOpenTerminalTab={onOpenTerminalTab}
        isVisible={isVisible}
      />
    </WindowManager>
  );
}

export function FileManager(props: FileManagerProps) {
  return (
    <ConnectionLogProvider>
      <FileManagerInner {...props} />
    </ConnectionLogProvider>
  );
}
