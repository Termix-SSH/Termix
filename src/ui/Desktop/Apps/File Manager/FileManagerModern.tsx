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
  addFolderShortcut,
  getPinnedFiles,
} from "@/ui/main-axios.ts";
import type { SidebarItem } from "./FileManagerSidebar";

interface FileManagerModernProps {
  initialHost?: SSHHost | null;
  onClose?: () => void;
}

// Linus-style data structure: creation intent completely separated from actual files
interface CreateIntent {
  id: string;
  type: 'file' | 'directory';
  defaultName: string;
  currentName: string;
}

// Internal component, uses window manager
function FileManagerContent({ initialHost, onClose }: FileManagerModernProps) {
  const { openWindow } = useWindowManager();
  const { t } = useTranslation();

  // State
  const [currentHost, setCurrentHost] = useState<SSHHost | null>(
    initialHost || null,
  );
  const [currentPath, setCurrentPath] = useState("/");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sshSessionId, setSshSessionId] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [pinnedFiles, setPinnedFiles] = useState<Set<string>>(new Set());
  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0);

  // Context menu state
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

  // Operation state
  const [clipboard, setClipboard] = useState<{
    files: FileItem[];
    operation: "copy" | "cut";
  } | null>(null);

  // Undo history
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

  // Linus-style state: creation intent separated from file editing
  const [createIntent, setCreateIntent] = useState<CreateIntent | null>(null);
  const [editingFile, setEditingFile] = useState<FileItem | null>(null);

  // Hooks
  const { selectedFiles, selectFile, selectAll, clearSelection, setSelection } =
    useFileSelection();

  const { isDragging, dragHandlers } = useDragAndDrop({
    onFilesDropped: handleFilesDropped,
    onError: (error) => toast.error(error),
    maxFileSize: 5120, // 5GB - support large files like SSH tools should
  });

  // Drag to desktop functionality
  const dragToDesktop = useDragToDesktop({
    sshSessionId: sshSessionId || "",
    sshHost: currentHost!,
  });

  // System-level drag to desktop functionality (new approach)
  const systemDrag = useDragToSystemDesktop({
    sshSessionId: sshSessionId || "",
    sshHost: currentHost!,
  });

  // SSH keepalive function
  const startKeepalive = useCallback(() => {
    if (!sshSessionId) return;

    // Clear existing timer
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
    }

    // Send keepalive every 5 minutes (300000ms)
    keepaliveTimerRef.current = setInterval(async () => {
      if (sshSessionId) {
        try {
          await keepSSHAlive(sshSessionId);
          console.log("SSH keepalive sent successfully");
        } catch (error) {
          console.error("SSH keepalive failed:", error);
          // If keepalive fails, session might be dead - could trigger reconnect here
        }
      }
    }, 5 * 60 * 1000); // 5 minutes
  }, [sshSessionId]);

  const stopKeepalive = useCallback(() => {
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }
  }, []);

  // Initialize SSH connection
  useEffect(() => {
    if (currentHost) {
      initializeSSHConnection();
    }
  }, [currentHost]);

  // Start/stop keepalive based on SSH session
  useEffect(() => {
    if (sshSessionId) {
      startKeepalive();
    } else {
      stopKeepalive();
    }

    // Cleanup on unmount
    return () => {
      stopKeepalive();
    };
  }, [sshSessionId, startKeepalive, stopKeepalive]);

  // Track if initial directory load is done to prevent duplicate loading
  const initialLoadDoneRef = useRef(false);
  // Track last path change to prevent rapid navigation issues
  const lastPathChangeRef = useRef<string>("");
  const pathChangeTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Track current loading request to handle cancellation
  const currentLoadingPathRef = useRef<string>("");
  // SSH keepalive timer
  const keepaliveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Handle file drag to external
  const handleFileDragStart = useCallback(
    (files: FileItem[]) => {
      // Record currently dragged files
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
    (e: DragEvent) => {
      // Check if dragged outside window
      const margin = 50;
      const isOutside =
        e.clientX < margin ||
        e.clientX > window.innerWidth - margin ||
        e.clientY < margin ||
        e.clientY > window.innerHeight - margin;

      if (isOutside) {
        // Execute immediately to preserve user gesture context
        systemDrag.handleDragEnd(e);
      } else {
        // Cancel drag
        systemDrag.cancelDragToSystem();
      }
    },
    [systemDrag],
  );

  async function initializeSSHConnection() {
    if (!currentHost) return;

    try {
      setIsLoading(true);
      // Reset initial load flag for new connections
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

      // Load initial directory immediately after connection to prevent jarring transition
      try {
        console.log("Loading initial directory:", currentPath);
        const response = await listSSHFiles(sessionId, currentPath);
        const files = Array.isArray(response) ? response : response?.files || [];
        console.log("Initial directory loaded successfully:", files.length, "items");
        setFiles(files);
        clearSelection();
        // Mark initial load as completed
        initialLoadDoneRef.current = true;
      } catch (dirError: any) {
        console.error("Failed to load initial directory:", dirError);
        // Don't show error toast here as it will be handled by the useEffect retry
      }
    } catch (error: any) {
      console.error("SSH connection failed:", error);
      toast.error(
        t("fileManager.failedToConnect") + ": " + (error.message || error),
      );
    } finally {
      setIsLoading(false);
    }
  }

  const loadDirectory = useCallback(async (path: string) => {
    if (!sshSessionId) {
      console.error("Cannot load directory: no SSH session ID");
      return;
    }

    // Prevent concurrent loading requests
    if (isLoading && currentLoadingPathRef.current !== path) {
      console.log("Directory loading already in progress, skipping:", path);
      return;
    }

    // Set current loading path for tracking
    currentLoadingPathRef.current = path;
    setIsLoading(true);

    // Clear createIntent when changing directories
    setCreateIntent(null);

    try {
      console.log("Loading directory:", path);

      const response = await listSSHFiles(sshSessionId, path);

      // Check if this is still the current request (avoid race conditions)
      if (currentLoadingPathRef.current !== path) {
        console.log("Directory load canceled, newer request in progress:", path);
        return;
      }

      console.log("Directory response received:", response);

      const files = Array.isArray(response) ? response : response?.files || [];

      console.log("Directory loaded successfully:", files.length, "items");

      setFiles(files);
      clearSelection();
    } catch (error: any) {
      // Only show error if this is still the current request
      if (currentLoadingPathRef.current === path) {
        console.error("Failed to load directory:", error);
        toast.error(
          t("fileManager.failedToLoadDirectory") + ": " + (error.message || error)
        );
      }
    } finally {
      // Only clear loading if this is still the current request
      if (currentLoadingPathRef.current === path) {
        setIsLoading(false);
        currentLoadingPathRef.current = "";
      }
    }
  }, [sshSessionId, isLoading, clearSelection, t]);

  // Debounced directory loading for path changes
  const debouncedLoadDirectory = useCallback((path: string) => {
    // Clear any existing timer
    if (pathChangeTimerRef.current) {
      clearTimeout(pathChangeTimerRef.current);
    }

    // Set new timer for debounced loading
    pathChangeTimerRef.current = setTimeout(() => {
      if (path !== lastPathChangeRef.current && sshSessionId) {
        console.log("Loading directory after path change:", path);
        lastPathChangeRef.current = path;
        loadDirectory(path);
      }
    }, 150); // 150ms debounce for path changes
  }, [sshSessionId, loadDirectory]);

  // File list update - only reload when path changes, not on initial connection
  useEffect(() => {
    if (sshSessionId && currentPath) {
      // Skip the first load since it's handled in initializeSSHConnection
      if (!initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true;
        lastPathChangeRef.current = currentPath;
        return;
      }

      // Use debounced loading for path changes to prevent rapid clicking issues
      debouncedLoadDirectory(currentPath);
    }

    // Cleanup timer on unmount or dependency change
    return () => {
      if (pathChangeTimerRef.current) {
        clearTimeout(pathChangeTimerRef.current);
      }
    };
  }, [sshSessionId, currentPath, debouncedLoadDirectory]);

  // Debounced refresh function - prevent excessive clicking
  const handleRefreshDirectory = useCallback(() => {
    const now = Date.now();
    const DEBOUNCE_MS = 500; // 500ms debounce

    if (now - lastRefreshTime < DEBOUNCE_MS) {
      console.log("Refresh ignored - too frequent");
      return;
    }

    setLastRefreshTime(now);
    loadDirectory(currentPath);
  }, [currentPath, lastRefreshTime, loadDirectory]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if input box or editable element has focus, skip if so
      const activeElement = document.activeElement;
      if (
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          activeElement.contentEditable === "true")
      ) {
        return;
      }

      // Handle Ctrl+Shift+T for opening terminal
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

    try {
      // Ensure SSH connection is valid
      await ensureSSHConnection();

      // Read file content
      const fileContent = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);

        // Check file type to determine reading method
        const isTextFile =
          file.type.startsWith("text/") ||
          file.type === "application/json" ||
          file.type === "application/javascript" ||
          file.type === "application/xml" ||
          file.name.match(
            /\.(txt|json|js|ts|jsx|tsx|css|html|htm|xml|yaml|yml|md|py|java|c|cpp|h|sh|bat|ps1)$/i,
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
        undefined, // userId - will be handled by backend
      );
      toast.success(
        t("fileManager.fileUploadedSuccessfully", { name: file.name }),
      );
      handleRefreshDirectory();
    } catch (error: any) {
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
      // Ensure SSH connection is valid
      await ensureSSHConnection();

      const response = await downloadSSHFile(sshSessionId, file.path);

      if (response?.content) {
        // Convert to blob and trigger download
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
      // Ensure SSH connection is valid
      await ensureSSHConnection();

      for (const file of files) {
        await deleteSSHItem(
          sshSessionId,
          file.path,
          file.type === "directory", // isDirectory
          currentHost?.id,
          currentHost?.userId?.toString(),
        );
      }

      // Record deletion history (although cannot truly undo)
      const deletedFiles = files.map((file) => ({
        path: file.path,
        name: file.name,
      }));

      const undoAction: UndoAction = {
        type: "delete",
        description: t("fileManager.deletedItems", { count: files.length }),
        data: {
          operation: "cut", // Placeholder
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

  // Linus-style creation: pure intent, no side effects
  function handleCreateNewFolder() {
    const defaultName = generateUniqueName("NewFolder", "directory");
    const newCreateIntent = {
      id: Date.now().toString(),
      type: 'directory' as const,
      defaultName,
      currentName: defaultName
    };


    setCreateIntent(newCreateIntent);
  }

  function handleCreateNewFile() {
    const defaultName = generateUniqueName("NewFile.txt", "file");
    const newCreateIntent = {
      id: Date.now().toString(),
      type: 'file' as const,
      defaultName,
      currentName: defaultName
    };
    setCreateIntent(newCreateIntent);
  }

  // Handle symlink resolution
  const handleSymlinkClick = async (file: FileItem) => {
    if (!currentHost || !sshSessionId) {
      toast.error(t("fileManager.noSSHConnection"));
      return;
    }

    try {
      // Ensure SSH connection is valid
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
        // If symlink points to directory, navigate to it
        setCurrentPath(symlinkInfo.target);
      } else if (symlinkInfo.type === "file") {
        // If symlink points to file, open file
        // Calculate window position (slightly offset)
        const windowCount = Date.now() % 10;
        const offsetX = 120 + windowCount * 30;
        const offsetY = 120 + windowCount * 30;

        // Create target file object
        const targetFile: FileItem = {
          ...file,
          path: symlinkInfo.target,
        };

        // Create window component factory function
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
      // Handle symlinks
      await handleSymlinkClick(file);
    } else {
      // Open file in new window
      if (!sshSessionId) {
        toast.error(t("fileManager.noSSHConnection"));
        return;
      }

      // Record to recent access for regular files
      await recordRecentFile(file);

      // Calculate window position (slightly offset)
      const windowCount = Date.now() % 10; // Simple offset calculation
      const offsetX = 120 + windowCount * 30;
      const offsetY = 120 + windowCount * 30;

      const windowTitle = file.name; // Remove mode identifier, controlled internally by FileViewer

      // Create window component factory function
      const createWindowComponent = (windowId: string) => (
        <FileWindow
          windowId={windowId}
          file={file}
          sshSessionId={sshSessionId}
          sshHost={currentHost}
          initialX={offsetX}
          initialY={offsetY}
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

  // Dedicated file editing function
  function handleFileEdit(file: FileItem) {
    handleFileOpen(file, true);
  }

  // Dedicated file viewing function (read-only)
  function handleFileView(file: FileItem) {
    handleFileOpen(file, false);
  }

  function handleContextMenu(event: React.MouseEvent, file?: FileItem) {
    event.preventDefault();

    // If right-clicked file is already in selection list, use all selected files
    // If right-clicked file is not in selection list, use only this file
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

      // Handle copy and cut operations
      let successCount = 0;
      const copiedItems: string[] = [];

      for (const file of files) {
        try {
          if (operation === "copy") {
            // Copy operation: call copy API
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
            // Cut operation: move files to target directory
            const targetPath = currentPath.endsWith("/")
              ? `${currentPath}${file.name}`
              : `${currentPath}/${file.name}`;

            // Only move when target path differs from original path
            if (file.path !== targetPath) {
              // Use dedicated moveSSHItem API for cross-directory movement
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
            t("fileManager.operationFailed", { operation: operation === "copy" ? t("fileManager.copy") : t("fileManager.move"), name: file.name, error: error.message }),
          );
        }
      }

      // Record undo history
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
          setUndoHistory((prev) => [...prev.slice(-9), undoAction]); // Keep max 10 undo records
        } else if (operation === "cut") {
          // Cut operation: record move info, can be moved back to original position on undo
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
              copiedFiles: movedFiles, // Reuse copiedFiles field to store move info
              targetDirectory: currentPath,
            },
            timestamp: Date.now(),
          };
          setUndoHistory((prev) => [...prev.slice(-9), undoAction]);
        }
      }

      // Show success message
      if (successCount > 0) {
        const operationText = operation === "copy" ? t("fileManager.copy") : t("fileManager.move");
        if (operation === "copy" && copiedItems.length > 0) {
          // Show detailed copy info, including renamed files
          const hasRenamed = copiedItems.some(
            (name) => !files.some((file) => file.name === name),
          );

          if (hasRenamed) {
            toast.success(
              t("fileManager.operationCompletedSuccessfully", { operation: operationText, count: successCount }),
            );
          } else {
            toast.success(t("fileManager.operationCompleted", { operation: operationText, count: successCount }));
          }
        } else {
          toast.success(t("fileManager.operationCompleted", { operation: operationText, count: successCount }));
        }
      }

      // Refresh file list
      handleRefreshDirectory();
      clearSelection();

      // Clear clipboard (after cut operation, copy operation retains clipboard content)
      if (operation === "cut") {
        setClipboard(null);
      }
    } catch (error: any) {
      toast.error(`${t("fileManager.pasteFailed")}: ${error.message || t("fileManager.unknownError")}`);
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

      // Execute undo logic based on different operation types
      switch (lastAction.type) {
        case "copy":
          // Undo copy operation: delete copied target files
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
                  t("fileManager.deleteCopiedFileFailed", { name: copiedFile.targetName, error: error.message }),
                );
              }
            }

            if (successCount > 0) {
              // Remove last undo record
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
          // Undo cut operation: move files back to original position
          if (lastAction.data.copiedFiles) {
            let successCount = 0;
            for (const movedFile of lastAction.data.copiedFiles) {
              try {
                // Move file from current position back to original position
                await moveSSHItem(
                  sshSessionId!,
                  movedFile.targetPath, // Current position (target path)
                  movedFile.originalPath, // Move back to original position
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
                  t("fileManager.moveBackFileFailed", { name: movedFile.targetName, error: error.message }),
                );
              }
            }

            if (successCount > 0) {
              // Remove last undo record
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
          // Delete operation cannot be truly undone (file already deleted from server)
          toast.info(t("fileManager.undoDeleteNotSupported"));
          // Still remove history record as user already knows this limitation
          setUndoHistory((prev) => prev.slice(0, -1));
          return;

        default:
          toast.error(t("fileManager.undoTypeNotSupported"));
          return;
      }

      // Refresh file list
      handleRefreshDirectory();
    } catch (error: any) {
      toast.error(`${t("fileManager.undoOperationFailed")}: ${error.message || t("fileManager.unknownError")}`);
      console.error("Undo failed:", error);
    }
  }

  function handleRenameFile(file: FileItem) {
    setEditingFile(file);
  }

  // Ensure SSH connection is valid - simplified version, prevent concurrent reconnection
  async function ensureSSHConnection() {
    if (!sshSessionId || !currentHost || isReconnecting) return;

    try {
      const status = await getSSHStatus(sshSessionId);

      if (!status.connected && !isReconnecting) {
        setIsReconnecting(true);
        console.log("SSH disconnected, reconnecting...");

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

        console.log("SSH reconnection successful");
      }
    } catch (error) {
      console.log("SSH reconnection failed:", error);
      throw error;
    } finally {
      setIsReconnecting(false);
    }
  }

  // Linus-style creation confirmation: pure creation, no mixed logic
  async function handleConfirmCreate(name: string) {
    if (!createIntent || !sshSessionId) return;

    try {
      await ensureSSHConnection();

      console.log(`Creating ${createIntent.type}:`, name);

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

      setCreateIntent(null);  // Clear intent
      handleRefreshDirectory();
    } catch (error: any) {
      console.error("Create failed:", error);
      toast.error(t("fileManager.failedToCreateItem"));
    }
  }

  // Linus-style cancel: zero side effects
  function handleCancelCreate() {
    setCreateIntent(null);  // Just that simple!
    console.log("Create cancelled - no side effects");
  }

  // Pure rename confirmation: only handle real files
  async function handleRenameConfirm(file: FileItem, newName: string) {
    if (!sshSessionId) return;

    try {
      await ensureSSHConnection();

      console.log("Renaming existing item:", {
        from: file.path,
        to: newName,
      });

      await renameSSHItem(
        sshSessionId,
        file.path,
        newName,
        currentHost?.id,
        currentHost?.userId?.toString(),
      );

      toast.success(t("fileManager.itemRenamedSuccessfully", { name: newName }));
      setEditingFile(null);
      handleRefreshDirectory();
    } catch (error: any) {
      console.error("Rename failed:", error);
      toast.error(t("fileManager.failedToRenameItem"));
    }
  }

  // Start editing file name
  function handleStartEdit(file: FileItem) {
    setEditingFile(file);
  }

  // Linus-style cancel edit: pure cancel, no side effects
  function handleCancelEdit() {
    setEditingFile(null);  // Simple and elegant
    console.log("Edit cancelled - no side effects");
  }

  // Generate unique name (handle name conflicts)
  function generateUniqueName(
    baseName: string,
    type: "file" | "directory",
  ): string {
    const existingNames = files.map((f) => f.name.toLowerCase());
    let candidateName = baseName;
    let counter = 1;

    // If name already exists, try adding number suffix
    while (existingNames.includes(candidateName.toLowerCase())) {
      if (type === "file" && baseName.includes(".")) {
        // For files, add number between filename and extension
        const lastDotIndex = baseName.lastIndexOf(".");
        const nameWithoutExt = baseName.substring(0, lastDotIndex);
        const extension = baseName.substring(lastDotIndex);
        candidateName = `${nameWithoutExt}${counter}${extension}`;
      } else {
        // For folders or files without extension, add number directly
        candidateName = `${baseName}${counter}`;
      }
      counter++;
    }

    console.log(`Generated unique name: ${baseName} -> ${candidateName}`);
    return candidateName;
  }

  // Drag handling: file/folder drag to folder = move operation
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

          // Only move when target path differs from original path
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
          toast.error(t("fileManager.moveFileFailed", { name: file.name }) + ": " + error.message);
        }
      }

      if (successCount > 0) {
        // Record undo history
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
          description: t("fileManager.dragMovedItems", { count: successCount, target: targetFolder.name }),
          data: {
            operation: "cut",
            copiedFiles: movedFiles,
            targetDirectory: targetFolder.path,
          },
          timestamp: Date.now(),
        };
        setUndoHistory((prev) => [...prev.slice(-9), undoAction]);

        toast.success(
          t("fileManager.successfullyMovedItems", { count: successCount, target: targetFolder.name }),
        );
        handleRefreshDirectory();
        clearSelection(); // Clear selection state
      }
    } catch (error: any) {
      console.error("Drag move operation failed:", error);
      toast.error(t("fileManager.moveOperationFailed") + ": " + error.message);
    }
  }

  // Drag handling: file drag to file = diff comparison operation
  function handleFileDiff(file1: FileItem, file2: FileItem) {
    if (file1.type !== "file" || file2.type !== "file") {
      toast.error(t("fileManager.canOnlyCompareFiles"));
      return;
    }

    if (!sshSessionId) {
      toast.error(t("fileManager.noSSHConnection"));
      return;
    }

    // Use dedicated DiffWindow for file comparison
    console.log("Opening diff comparison:", file1.name, "vs", file2.name);

    // Calculate window position
    const offsetX = 100;
    const offsetY = 80;

    // Create diff window
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
      title: t("fileManager.fileComparison", { file1: file1.name, file2: file2.name }),
      isMaximized: false,
      component: createWindowComponent,
      zIndex: Date.now(),
    });

    toast.success(t("fileManager.comparingFiles", { file1: file1.name, file2: file2.name }));
  }

  // Drag to desktop handler function
  async function handleDragToDesktop(files: FileItem[]) {
    if (!currentHost || !sshSessionId) {
      toast.error(t("fileManager.noSSHConnection"));
      return;
    }

    try {
      // Prefer new system-level drag approach
      if (systemDrag.isFileSystemAPISupported) {
        await systemDrag.handleDragToSystem(files, {
          enableToast: true,
          onSuccess: () => {
            console.log("System-level drag successful");
          },
          onError: (error) => {
            console.error("System-level drag failed:", error);
          },
        });
      } else {
        // Fallback to Electron approach
        if (files.length === 1) {
          await dragToDesktop.dragFileToDesktop(files[0]);
        } else if (files.length > 1) {
          await dragToDesktop.dragFilesToDesktop(files);
        }
      }
    } catch (error: any) {
      console.error("Drag to desktop failed:", error);
      toast.error(t("fileManager.dragFailed") + ": " + (error.message || t("fileManager.unknownError")));
    }
  }

  // Open terminal handler function
  function handleOpenTerminal(path: string) {
    if (!currentHost) {
      toast.error(t("fileManager.noHostSelected"));
      return;
    }

    // Create terminal window
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

  // Run executable file handler function
  function handleRunExecutable(file: FileItem) {
    if (!currentHost) {
      toast.error(t("fileManager.noHostSelected"));
      return;
    }

    if (file.type !== "file" || !file.executable) {
      toast.error(t("fileManager.onlyRunExecutableFiles"));
      return;
    }

    // Get file directory
    const fileDir = file.path.substring(0, file.path.lastIndexOf("/"));
    const fileName = file.name;
    const executeCmd = `./${fileName}`;

    // Create terminal window for execution
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
        executeCommand={executeCmd} // Auto-execute command
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

  // Load pinned files list
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

  // PIN file
  async function handlePinFile(file: FileItem) {
    if (!currentHost?.id) return;

    try {
      await addPinnedFile(currentHost.id, file.path, file.name);
      setPinnedFiles((prev) => new Set([...prev, file.path]));
      setSidebarRefreshTrigger((prev) => prev + 1); // Trigger sidebar refresh
      toast.success(t("fileManager.filePinnedSuccessfully", { name: file.name }));
    } catch (error) {
      console.error("Failed to pin file:", error);
      toast.error(t("fileManager.pinFileFailed"));
    }
  }

  // UNPIN file
  async function handleUnpinFile(file: FileItem) {
    if (!currentHost?.id) return;

    try {
      await removePinnedFile(currentHost.id, file.path);
      setPinnedFiles((prev) => {
        const newSet = new Set(prev);
        newSet.delete(file.path);
        return newSet;
      });
      setSidebarRefreshTrigger((prev) => prev + 1); // Trigger sidebar refresh
      toast.success(t("fileManager.fileUnpinnedSuccessfully", { name: file.name }));
    } catch (error) {
      console.error("Failed to unpin file:", error);
      toast.error(t("fileManager.unpinFileFailed"));
    }
  }

  // Add folder shortcut
  async function handleAddShortcut(path: string) {
    if (!currentHost?.id) return;

    try {
      const folderName = path.split("/").pop() || path;
      await addFolderShortcut(currentHost.id, path, folderName);
      setSidebarRefreshTrigger((prev) => prev + 1); // Trigger sidebar refresh
      toast.success(t("fileManager.shortcutAddedSuccessfully", { name: folderName }));
    } catch (error) {
      console.error("Failed to add shortcut:", error);
      toast.error(t("fileManager.addShortcutFailed"));
    }
  }

  // Check if file is pinned
  function isPinnedFile(file: FileItem): boolean {
    return pinnedFiles.has(file.path);
  }

  // Record recently accessed file
  async function recordRecentFile(file: FileItem) {
    if (!currentHost?.id || file.type === "directory") return;

    try {
      await addRecentFile(currentHost.id, file.path, file.name);
      setSidebarRefreshTrigger((prev) => prev + 1); // Trigger sidebar refresh
    } catch (error) {
      console.error("Failed to record recent file:", error);
    }
  }

  // Handle sidebar file opening
  async function handleSidebarFileOpen(sidebarItem: SidebarItem) {
    // Convert SidebarItem to FileItem format
    const file: FileItem = {
      name: sidebarItem.name,
      path: sidebarItem.path,
      type: "file", // Both recent and pinned are file types
    };

    // Call regular file opening handler
    await handleFileOpen(file);
  }


  // Clear createIntent when path changes
  useEffect(() => {
    setCreateIntent(null);
  }, [currentPath]);

  // Load pinned files list (when host or connection changes)
  useEffect(() => {
    if (currentHost?.id) {
      loadPinnedFiles();
    }
  }, [currentHost?.id]);

  // Linus-style data separation: only filter real files
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
      {/* Toolbar */}
      <div className="flex-shrink-0 border-b border-dark-border">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-white">{currentHost.name}</h2>
            <span className="text-sm text-muted-foreground">
              {currentHost.ip}:{currentHost.port}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("fileManager.searchFiles")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 w-48 h-9 bg-dark-bg-button border-dark-border"
              />
            </div>

            {/* View toggle */}
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

            {/* Action buttons */}
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

      {/* Main content area */}
      <div className="flex-1 flex" {...dragHandlers}>
        {/* Left sidebar */}
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

        {/* Right file grid */}
        <div className="flex-1 relative">
          <FileManagerGrid
            files={filteredFiles}
            selectedFiles={selectedFiles}
            onFileSelect={() => {}} // No longer need this callback, use onSelectionChange
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

          {/* Right-click menu */}
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

// Main export component, wrapped with WindowManager
export function FileManagerModern({
  initialHost,
  onClose,
}: FileManagerModernProps) {
  return (
    <WindowManager>
      <FileManagerContent initialHost={initialHost} onClose={onClose} />
    </WindowManager>
  );
}
