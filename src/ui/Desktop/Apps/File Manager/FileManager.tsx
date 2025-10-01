import React, { useState, useEffect, useRef, useCallback } from "react";
import { FileManagerGrid } from "./FileManagerGrid";
import { FileManagerSidebar } from "./FileManagerSidebar";
import { FileManagerContextMenu } from "./FileManagerContextMenu";
import { useFileSelection } from "./hooks/useFileSelection";
import { useDragAndDrop } from "./hooks/useDragAndDrop";
import { WindowManager, useWindowManager } from "./components/WindowManager";
import { FileWindow } from "./components/FileWindow";
import { DiffWindow } from "./components/DiffWindow";
import { useDragToDesktop } from "../../../hooks/useDragToDesktop";
import { useDragToSystemDesktop } from "../../../hooks/useDragToSystemDesktop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Upload,
  FolderPlus,
  FilePlus,
  RefreshCw,
  Search,
  Grid3X3,
  List,
  Eye,
  Settings,
} from "lucide-react";
import { TerminalWindow } from "./components/TerminalWindow";
import type { SSHHost, FileItem } from "../../../types/index.js";
import {
  listSSHFiles,
  uploadSSHFile,
  downloadSSHFile,
  createSSHFile,
  createSSHFolder,
  deleteSSHItem,
  copySSHItem,
  renameSSHItem,
  moveSSHItem,
  connectSSH,
  getSSHStatus,
  keepSSHAlive,
  identifySSHSymlink,
  addRecentFile,
  addPinnedFile,
  removePinnedFile,
  removeRecentFile,
  addFolderShortcut,
  getPinnedFiles,
} from "@/ui/main-axios.ts";
import type { SidebarItem } from "./FileManagerSidebar";

interface FileManagerProps {
  initialHost?: SSHHost | null;
  onClose?: () => void;
}

interface CreateIntent {
  id: string;
  type: "file" | "directory";
  defaultName: string;
  currentName: string;
}

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "-";
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  const formattedSize =
    size < 10 && unitIndex > 0 ? size.toFixed(1) : Math.round(size).toString();
  return `${formattedSize} ${units[unitIndex]}`;
}

function FileManagerContent({ initialHost, onClose }: FileManagerProps) {
  const { openWindow } = useWindowManager();
  const { t } = useTranslation();

  const [currentHost, setCurrentHost] = useState<SSHHost | null>(
    initialHost || null,
  );
  const [currentPath, setCurrentPath] = useState(
    initialHost?.defaultPath || "/",
  );
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sshSessionId, setSshSessionId] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [pinnedFiles, setPinnedFiles] = useState<Set<string>>(new Set());
  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0);
  const [isClosing, setIsClosing] = useState<boolean>(false);

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

  const { selectedFiles, selectFile, selectAll, clearSelection, setSelection } =
    useFileSelection();

  const { isDragging, dragHandlers } = useDragAndDrop({
    onFilesDropped: handleFilesDropped,
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
      if (isClosing) return;
      setIsClosing(true);
      toast.error(errorMessage);
      if (onClose) {
        onClose();
      }
    },
    [isClosing, onClose],
  );

  useEffect(() => {
    if (currentHost) {
      initializeSSHConnection();
    }
  }, [currentHost]);

  useEffect(() => {
    if (sshSessionId) {
      startKeepalive();
    } else {
      stopKeepalive();
    }

    return () => {
      stopKeepalive();
    };
  }, [sshSessionId, startKeepalive, stopKeepalive]);

  const initialLoadDoneRef = useRef(false);
  const lastPathChangeRef = useRef<string>("");
  const pathChangeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentLoadingPathRef = useRef<string>("");
  const keepaliveTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  async function initializeSSHConnection() {
    if (!currentHost) return;

    try {
      setIsLoading(true);
      initialLoadDoneRef.current = false;

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
      });

      setSshSessionId(sessionId);

      try {
        const response = await listSSHFiles(sessionId, currentPath);
        const files = Array.isArray(response)
          ? response
          : response?.files || [];
        setFiles(files);
        clearSelection();
        initialLoadDoneRef.current = true;
      } catch (dirError: any) {
        console.error("Failed to load initial directory:", dirError);
      }
    } catch (error: any) {
      console.error("SSH connection failed:", error);
      handleCloseWithError(
        t("fileManager.failedToConnect") + ": " + (error.message || error),
      );
    } finally {
      setIsLoading(false);
    }
  }

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!sshSessionId) {
        console.error("Cannot load directory: no SSH session ID");
        return;
      }

      if (isLoading && currentLoadingPathRef.current !== path) {
        return;
      }

      currentLoadingPathRef.current = path;
      setIsLoading(true);

      setCreateIntent(null);

      try {
        const response = await listSSHFiles(sshSessionId, path);

        if (currentLoadingPathRef.current !== path) {
          return;
        }

        const files = Array.isArray(response)
          ? response
          : response?.files || [];

        setFiles(files);
        clearSelection();
      } catch (error: any) {
        if (currentLoadingPathRef.current === path) {
          console.error("Failed to load directory:", error);

          if (initialLoadDoneRef.current) {
            toast.error(
              t("fileManager.failedToLoadDirectory") +
                ": " +
                (error.message || error),
            );
          }

          if (
            error.message?.includes("connection") ||
            error.message?.includes("SSH")
          ) {
            handleCloseWithError(
              t("fileManager.failedToLoadDirectory") +
                ": " +
                (error.message || error),
            );
          }
        }
      } finally {
        if (currentLoadingPathRef.current === path) {
          setIsLoading(false);
          currentLoadingPathRef.current = "";
        }
      }
    },
    [sshSessionId, isLoading, clearSelection, t],
  );

  const debouncedLoadDirectory = useCallback(
    (path: string) => {
      if (pathChangeTimerRef.current) {
        clearTimeout(pathChangeTimerRef.current);
      }

      pathChangeTimerRef.current = setTimeout(() => {
        if (path !== lastPathChangeRef.current && sshSessionId) {
          lastPathChangeRef.current = path;
          loadDirectory(path);
        }
      }, 150);
    },
    [sshSessionId, loadDirectory],
  );

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
    loadDirectory(currentPath);
  }, [currentPath, lastRefreshTime, loadDirectory]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement;
      if (
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          activeElement.contentEditable === "true")
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

  function handleFilesDropped(fileList: FileList) {
    if (!sshSessionId) {
      toast.error(t("fileManager.noSSHConnection"));
      return;
    }

    Array.from(fileList).forEach((file) => {
      handleUploadFile(file);
    });
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

    try {
      await ensureSSHConnection();

      const fileContent = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);

        const isTextFile =
          file.type.startsWith("text/") ||
          file.type === "application/json" ||
          file.type === "application/javascript" ||
          file.type === "application/xml" ||
          file.type === "image/svg+xml" ||
          file.name.match(
            /\.(txt|json|js|ts|jsx|tsx|css|scss|less|html|htm|xml|svg|yaml|yml|md|markdown|mdown|mkdn|mdx|py|java|c|cpp|h|sh|bash|zsh|bat|ps1|toml|ini|conf|config|sql|vue|svelte)$/i,
          );

        if (isTextFile) {
          reader.onload = () => {
            if (reader.result) {
              resolve(reader.result as string);
            } else {
              reject(new Error("Failed to read text file content"));
            }
          };
          reader.readAsText(file);
        } else {
          reader.onload = () => {
            if (reader.result instanceof ArrayBuffer) {
              const bytes = new Uint8Array(reader.result);
              let binary = "";
              for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              const base64 = btoa(binary);
              resolve(base64);
            } else {
              reject(new Error("Failed to read binary file"));
            }
          };
          reader.readAsArrayBuffer(file);
        }
      });

      await uploadSSHFile(
        sshSessionId,
        currentPath,
        file.name,
        fileContent,
        currentHost?.id,
        undefined,
      );

      toast.dismiss(progressToast);

      toast.success(
        t("fileManager.fileUploadedSuccessfully", { name: file.name }),
      );
      handleRefreshDirectory();
    } catch (error: any) {
      toast.dismiss(progressToast);

      if (
        error.message?.includes("connection") ||
        error.message?.includes("established")
      ) {
        toast.error(
          `SSH connection failed. Please check your connection to ${currentHost?.name} (${currentHost?.ip}:${currentHost?.port})`,
        );
      } else {
        toast.error(t("fileManager.failedToUploadFile"));
      }
      console.error("Upload failed:", error);
    }
  }

  async function handleDownloadFile(file: FileItem) {
    if (!sshSessionId) return;

    try {
      await ensureSSHConnection();

      const response = await downloadSSHFile(sshSessionId, file.path);

      if (response?.content) {
        const byteCharacters = atob(response.content);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], {
          type: response.mimeType || "application/octet-stream",
        });

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = response.fileName || file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast.success(
          t("fileManager.fileDownloadedSuccessfully", { name: file.name }),
        );
      }
    } catch (error: any) {
      if (
        error.message?.includes("connection") ||
        error.message?.includes("established")
      ) {
        toast.error(
          `SSH connection failed. Please check your connection to ${currentHost?.name} (${currentHost?.ip}:${currentHost?.port})`,
        );
      } else {
        toast.error(t("fileManager.failedToDownloadFile"));
      }
      console.error("Download failed:", error);
    }
  }

  async function handleDeleteFiles(files: FileItem[]) {
    if (!sshSessionId || files.length === 0) return;

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
      }

      const deletedFiles = files.map((file) => ({
        path: file.path,
        name: file.name,
      }));

      const undoAction: UndoAction = {
        type: "delete",
        description: t("fileManager.deletedItems", { count: files.length }),
        data: {
          operation: "cut",
          deletedFiles,
          targetDirectory: currentPath,
        },
        timestamp: Date.now(),
      };
      setUndoHistory((prev) => [...prev.slice(-9), undoAction]);

      toast.success(
        t("fileManager.itemsDeletedSuccessfully", { count: files.length }),
      );
      handleRefreshDirectory();
      clearSelection();
    } catch (error: any) {
      if (
        error.message?.includes("connection") ||
        error.message?.includes("established")
      ) {
        toast.error(
          `SSH connection failed. Please check your connection to ${currentHost?.name} (${currentHost?.ip}:${currentHost?.port})`,
        );
      } else {
        toast.error(t("fileManager.failedToDeleteItems"));
      }
      console.error("Delete failed:", error);
    }
  }

  function handleCreateNewFolder() {
    const defaultName = generateUniqueName(
      t("fileManager.newFolderDefault"),
      "directory",
    );
    const newCreateIntent = {
      id: Date.now().toString(),
      type: "directory" as const,
      defaultName,
      currentName: defaultName,
    };

    setCreateIntent(newCreateIntent);
  }

  function handleCreateNewFile() {
    const defaultName = generateUniqueName(
      t("fileManager.newFileDefault"),
      "file",
    );
    const newCreateIntent = {
      id: Date.now().toString(),
      type: "file" as const,
      defaultName,
      currentName: defaultName,
    };
    setCreateIntent(newCreateIntent);
  }

  const handleSymlinkClick = async (file: FileItem) => {
    if (!currentHost || !sshSessionId) {
      toast.error(t("fileManager.noSSHConnection"));
      return;
    }

    try {
      let currentSessionId = sshSessionId;
      try {
        const status = await getSSHStatus(currentSessionId);
        if (!status.connected) {
          const result = await connectSSH(currentSessionId, {
            hostId: currentHost.id,
            host: currentHost.ip,
            port: currentHost.port,
            username: currentHost.username,
            authType: currentHost.authType,
            password: currentHost.password,
            key: currentHost.key,
            keyPassword: currentHost.keyPassword,
            credentialId: currentHost.credentialId,
          });

          if (!result.success) {
            throw new Error(t("fileManager.failedToReconnectSSH"));
          }
        }
      } catch (sessionErr) {
        throw sessionErr;
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
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error ||
          error?.message ||
          t("fileManager.failedToResolveSymlink"),
      );
    }
  };

  async function handleFileOpen(file: FileItem, editMode: boolean = false) {
    if (file.type === "directory") {
      setCurrentPath(file.path);
    } else if (file.type === "link") {
      await handleSymlinkClick(file);
    } else {
      if (!sshSessionId) {
        toast.error(t("fileManager.noSSHConnection"));
        return;
      }

      await recordRecentFile(file);

      const windowCount = Date.now() % 10;
      const baseOffsetX = 120 + windowCount * 30;
      const baseOffsetY = 120 + windowCount * 30;

      const maxOffsetX = Math.max(0, window.innerWidth - 800 - 100);
      const maxOffsetY = Math.max(0, window.innerHeight - 600 - 100);

      const offsetX = Math.min(baseOffsetX, maxOffsetX);
      const offsetY = Math.min(baseOffsetY, maxOffsetY);

      const windowTitle = file.name;

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
        title: windowTitle,
        x: offsetX,
        y: offsetY,
        width: 800,
        height: 600,
        isMaximized: false,
        isMinimized: false,
        component: createWindowComponent,
      });
    }
  }

  function handleFileEdit(file: FileItem) {
    handleFileOpen(file, true);
  }

  function handleFileView(file: FileItem) {
    handleFileOpen(file, false);
  }

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

  function handleCopyFiles(files: FileItem[]) {
    setClipboard({ files, operation: "copy" });
    toast.success(
      t("fileManager.filesCopiedToClipboard", { count: files.length }),
    );
  }

  function handleCutFiles(files: FileItem[]) {
    setClipboard({ files, operation: "cut" });
    toast.success(
      t("fileManager.filesCutToClipboard", { count: files.length }),
    );
  }

  async function handlePasteFiles() {
    if (!clipboard || !sshSessionId) return;

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
        } catch (error: any) {
          console.error(`Failed to ${operation} file ${file.name}:`, error);
          toast.error(
            t("fileManager.operationFailed", {
              operation:
                operation === "copy"
                  ? t("fileManager.copy")
                  : t("fileManager.move"),
              name: file.name,
              error: error.message,
            }),
          );
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
    } catch (error: any) {
      toast.error(
        `${t("fileManager.pasteFailed")}: ${error.message || t("fileManager.unknownError")}`,
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
              } catch (error: any) {
                console.error(
                  `Failed to delete copied file ${copiedFile.targetName}:`,
                  error,
                );
                toast.error(
                  t("fileManager.deleteCopiedFileFailed", {
                    name: copiedFile.targetName,
                    error: error.message,
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
              } catch (error: any) {
                console.error(
                  `Failed to move back file ${movedFile.targetName}:`,
                  error,
                );
                toast.error(
                  t("fileManager.moveBackFileFailed", {
                    name: movedFile.targetName,
                    error: error.message,
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
    } catch (error: any) {
      toast.error(
        `${t("fileManager.undoOperationFailed")}: ${error.message || t("fileManager.unknownError")}`,
      );
      console.error("Undo failed:", error);
    }
  }

  function handleRenameFile(file: FileItem) {
    setEditingFile(file);
  }

  async function ensureSSHConnection() {
    if (!sshSessionId || !currentHost || isReconnecting) return;

    try {
      const status = await getSSHStatus(sshSessionId);

      if (!status.connected && !isReconnecting) {
        setIsReconnecting(true);
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
        });
      }
    } catch (error) {
      handleCloseWithError(
        `SSH connection failed. Please check your connection to ${currentHost?.name} (${currentHost?.ip}:${currentHost?.port})`,
      );
      throw error;
    } finally {
      setIsReconnecting(false);
    }
  }

  async function handleConfirmCreate(name: string) {
    if (!createIntent || !sshSessionId) return;

    try {
      await ensureSSHConnection();

      if (createIntent.type === "file") {
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

      setCreateIntent(null);
      handleRefreshDirectory();
    } catch (error: any) {
      console.error("Create failed:", error);
      toast.error(t("fileManager.failedToCreateItem"));
    }
  }

  function handleCancelCreate() {
    setCreateIntent(null);
  }

  async function handleRenameConfirm(file: FileItem, newName: string) {
    if (!sshSessionId) return;

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
      setEditingFile(null);
      handleRefreshDirectory();
    } catch (error: any) {
      console.error("Rename failed:", error);
      toast.error(t("fileManager.failedToRenameItem"));
    }
  }

  function handleStartEdit(file: FileItem) {
    setEditingFile(file);
  }

  function handleCancelEdit() {
    setEditingFile(null);
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
        } catch (error: any) {
          console.error(`Failed to move file ${file.name}:`, error);
          toast.error(
            t("fileManager.moveFileFailed", { name: file.name }) +
              ": " +
              error.message,
          );
        }
      }

      if (successCount > 0) {
        const movedFiles = draggedFiles
          .slice(0, successCount)
          .map((file, index) => {
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
    } catch (error: any) {
      console.error("Drag move operation failed:", error);
      toast.error(t("fileManager.moveOperationFailed") + ": " + error.message);
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
      id: windowId,
      type: "diff",
      title: t("fileManager.fileComparison", {
        file1: file1.name,
        file2: file2.name,
      }),
      isMaximized: false,
      component: createWindowComponent,
      zIndex: Date.now(),
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
    } catch (error: any) {
      console.error("Drag to desktop failed:", error);
      toast.error(
        t("fileManager.dragFailed") +
          ": " +
          (error.message || t("fileManager.unknownError")),
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
      const pinnedPaths = new Set(pinnedData.map((item: any) => item.path));
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
    }
  }, [currentHost?.id]);

  const filteredFiles = files.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase()),
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

  return (
    <div className="h-full flex flex-col bg-dark-bg">
      <div className="flex-shrink-0 border-b border-dark-border">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-white">{currentHost.name}</h2>
            <span className="text-sm text-muted-foreground">
              {currentHost.ip}:{currentHost.port}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("fileManager.searchFiles")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 w-48 h-9 bg-dark-bg-button border-dark-border"
              />
            </div>

            <div className="flex border border-dark-border rounded-md">
              <Button
                variant={viewMode === "grid" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("grid")}
                className="rounded-r-none h-9"
              >
                <Grid3X3 className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("list")}
                className="rounded-l-none h-9"
              >
                <List className="w-4 h-4" />
              </Button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.multiple = true;
                input.onchange = (e) => {
                  const files = (e.target as HTMLInputElement).files;
                  if (files) handleFilesDropped(files);
                };
                input.click();
              }}
              className="h-9"
            >
              <Upload className="w-4 h-4 mr-2" />
              {t("fileManager.upload")}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleCreateNewFolder}
              className="h-9"
            >
              <FolderPlus className="w-4 h-4 mr-2" />
              {t("fileManager.newFolder")}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleCreateNewFile}
              className="h-9"
            >
              <FilePlus className="w-4 h-4 mr-2" />
              {t("fileManager.newFile")}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshDirectory}
              className="h-9"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex" {...dragHandlers}>
        <div className="w-64 flex-shrink-0 h-full">
          <FileManagerSidebar
            currentHost={currentHost}
            currentPath={currentPath}
            onPathChange={setCurrentPath}
            onLoadDirectory={loadDirectory}
            onFileOpen={handleSidebarFileOpen}
            sshSessionId={sshSessionId}
            refreshTrigger={sidebarRefreshTrigger}
          />
        </div>

        <div className="flex-1 relative">
          <FileManagerGrid
            files={filteredFiles}
            selectedFiles={selectedFiles}
            onFileSelect={() => {}}
            onFileOpen={handleFileOpen}
            onSelectionChange={setSelection}
            currentPath={currentPath}
            isLoading={isLoading}
            onPathChange={setCurrentPath}
            onRefresh={handleRefreshDirectory}
            onUpload={handleFilesDropped}
            onDownload={(files) => files.forEach(handleDownloadFile)}
            onContextMenu={handleContextMenu}
            viewMode={viewMode}
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
          />

          <FileManagerContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            files={contextMenu.files}
            isVisible={contextMenu.isVisible}
            onClose={() =>
              setContextMenu((prev) => ({ ...prev, isVisible: false }))
            }
            onDownload={(files) => files.forEach(handleDownloadFile)}
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
          />
        </div>
      </div>
    </div>
  );
}

export function FileManager({ initialHost, onClose }: FileManagerProps) {
  return (
    <WindowManager>
      <FileManagerContent initialHost={initialHost} onClose={onClose} />
    </WindowManager>
  );
}
