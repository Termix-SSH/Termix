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
  Settings
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
  identifySSHSymlink,
  addRecentFile,
  addPinnedFile,
  removePinnedFile,
  addFolderShortcut,
  getPinnedFiles
} from "@/ui/main-axios.ts";


interface FileManagerModernProps {
  initialHost?: SSHHost | null;
  onClose?: () => void;
}

// 内部组件，使用窗口管理器
function FileManagerContent({ initialHost, onClose }: FileManagerModernProps) {
  const { openWindow } = useWindowManager();
  const { t } = useTranslation();

  // State
  const [currentHost, setCurrentHost] = useState<SSHHost | null>(initialHost || null);
  const [currentPath, setCurrentPath] = useState("/");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sshSessionId, setSshSessionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
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
    files: []
  });

  // 操作状态
  const [clipboard, setClipboard] = useState<{
    files: FileItem[];
    operation: 'copy' | 'cut';
  } | null>(null);

  // 撤销历史
  interface UndoAction {
    type: 'copy' | 'cut' | 'delete';
    description: string;
    data: {
      operation: 'copy' | 'cut';
      copiedFiles?: { originalPath: string; targetPath: string; targetName: string }[];
      deletedFiles?: { path: string; name: string }[];
      targetDirectory?: string;
    };
    timestamp: number;
  }

  const [undoHistory, setUndoHistory] = useState<UndoAction[]>([]);

  // 编辑状态
  const [editingFile, setEditingFile] = useState<FileItem | null>(null);
  const [isCreatingNewFile, setIsCreatingNewFile] = useState(false);

  // Hooks
  const {
    selectedFiles,
    selectFile,
    selectAll,
    clearSelection,
    setSelection
  } = useFileSelection();

  const { isDragging, dragHandlers } = useDragAndDrop({
    onFilesDropped: handleFilesDropped,
    onError: (error) => toast.error(error),
    maxFileSize: 100 // 100MB
  });

  // 拖拽到桌面功能
  const dragToDesktop = useDragToDesktop({
    sshSessionId: sshSessionId || '',
    sshHost: currentHost!
  });

  // 系统级拖拽到桌面功能（新方案）
  const systemDrag = useDragToSystemDesktop({
    sshSessionId: sshSessionId || '',
    sshHost: currentHost!
  });

  // 初始化SSH连接
  useEffect(() => {
    if (currentHost) {
      initializeSSHConnection();
    }
  }, [currentHost]);

  // 文件列表更新
  useEffect(() => {
    if (sshSessionId) {
      loadDirectory(currentPath);
    }
  }, [sshSessionId, currentPath]);

  // 文件拖拽到外部处理
  const handleFileDragStart = useCallback((files: FileItem[]) => {
    // 记录当前拖拽的文件
    systemDrag.startDragToSystem(files, {
      enableToast: true,
      onSuccess: () => {
        clearSelection();
      },
      onError: (error) => {
        console.error('拖拽失败:', error);
      }
    });
  }, [systemDrag, clearSelection]);

  const handleFileDragEnd = useCallback((e: DragEvent) => {
    // 检查是否拖拽到窗口外
    const margin = 50;
    const isOutside = (
      e.clientX < margin ||
      e.clientX > window.innerWidth - margin ||
      e.clientY < margin ||
      e.clientY > window.innerHeight - margin
    );

    if (isOutside) {
      // 延迟执行，避免与其他事件冲突
      setTimeout(() => {
        systemDrag.handleDragEnd(e);
      }, 100);
    } else {
      // 取消拖拽
      systemDrag.cancelDragToSystem();
    }
  }, [systemDrag]);

  async function initializeSSHConnection() {
    if (!currentHost) return;

    try {
      setIsLoading(true);
      console.log("Initializing SSH connection for host:", currentHost.name, "ID:", currentHost.id);

      // 使用主机ID作为会话ID
      const sessionId = currentHost.id.toString();
      console.log("Using session ID:", sessionId);

      // 调用connectSSH建立连接
      console.log("Connecting to SSH with config:", {
        hostId: currentHost.id,
        ip: currentHost.ip,
        port: currentHost.port,
        username: currentHost.username,
        authType: currentHost.authType,
        credentialId: currentHost.credentialId,
        userId: currentHost.userId
      });

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
        userId: currentHost.userId
      });

      console.log("SSH connection result:", result);
      setSshSessionId(sessionId);
      console.log("SSH session ID set to:", sessionId);
    } catch (error: any) {
      console.error("SSH connection failed:", error);
      toast.error(t("fileManager.failedToConnect") + ": " + (error.message || error));
    } finally {
      setIsLoading(false);
    }
  }

  async function loadDirectory(path: string) {
    if (!sshSessionId) {
      console.error("Cannot load directory: no SSH session ID");
      return;
    }

    try {
      setIsLoading(true);
      console.log("Loading directory:", path, "with session ID:", sshSessionId);

      // 首先检查SSH连接状态
      try {
        const status = await getSSHStatus(sshSessionId);
        console.log("SSH connection status:", status);

        if (!status.connected) {
          console.log("SSH not connected, attempting to reconnect...");
          await initializeSSHConnection();
          return; // 重连后会触发useEffect重新加载目录
        }
      } catch (statusError) {
        console.log("Failed to get SSH status, attempting to reconnect...");
        await initializeSSHConnection();
        return;
      }

      const response = await listSSHFiles(sshSessionId, path);
      console.log("Directory response from backend:", response);

      // 处理新的返回格式 { files: FileItem[], path: string }
      const files = Array.isArray(response) ? response : response?.files || [];
      console.log("Directory contents loaded:", files.length, "items");
      console.log("Files with sizes:", files.map(f => ({ name: f.name, size: f.size, type: f.type })));

      setFiles(files);
      clearSelection();
    } catch (error: any) {
      console.error("Failed to load directory:", error);

      // 如果是连接错误，尝试重连
      if (error.message?.includes("connection") || error.message?.includes("established")) {
        console.log("Connection error detected, attempting to reconnect...");
        await initializeSSHConnection();
      } else {
        toast.error(t("fileManager.failedToLoadDirectory") + ": " + (error.message || error));
      }
    } finally {
      setIsLoading(false);
    }
  }

  function handleFilesDropped(fileList: FileList) {
    if (!sshSessionId) {
      toast.error(t("fileManager.noSSHConnection"));
      return;
    }

    Array.from(fileList).forEach(file => {
      handleUploadFile(file);
    });
  }

  async function handleUploadFile(file: File) {
    if (!sshSessionId) return;

    try {
      // 确保SSH连接有效
      await ensureSSHConnection();

      const targetPath = currentPath.endsWith('/')
        ? `${currentPath}${file.name}`
        : `${currentPath}/${file.name}`;

      await uploadSSHFile(sshSessionId, targetPath, file);
      toast.success(t("fileManager.fileUploadedSuccessfully", { name: file.name }));
      loadDirectory(currentPath);
    } catch (error: any) {
      if (error.message?.includes('connection') || error.message?.includes('established')) {
        toast.error(`SSH connection failed. Please check your connection to ${currentHost?.name} (${currentHost?.ip}:${currentHost?.port})`);
      } else {
        toast.error(t("fileManager.failedToUploadFile"));
      }
      console.error("Upload failed:", error);
    }
  }

  async function handleDownloadFile(file: FileItem) {
    if (!sshSessionId) return;

    try {
      // 确保SSH连接有效
      await ensureSSHConnection();

      const response = await downloadSSHFile(sshSessionId, file.path);

      if (response?.content) {
        // 转换为blob并触发下载
        const byteCharacters = atob(response.content);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: response.mimeType || 'application/octet-stream' });

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = response.fileName || file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast.success(t("fileManager.fileDownloadedSuccessfully", { name: file.name }));
      }
    } catch (error: any) {
      if (error.message?.includes('connection') || error.message?.includes('established')) {
        toast.error(`SSH connection failed. Please check your connection to ${currentHost?.name} (${currentHost?.ip}:${currentHost?.port})`);
      } else {
        toast.error(t("fileManager.failedToDownloadFile"));
      }
      console.error("Download failed:", error);
    }
  }

  async function handleDeleteFiles(files: FileItem[]) {
    if (!sshSessionId || files.length === 0) return;

    try {
      // 确保SSH连接有效
      await ensureSSHConnection();

      for (const file of files) {
        await deleteSSHItem(
          sshSessionId,
          file.path,
          file.type === 'directory', // isDirectory
          currentHost?.id,
          currentHost?.userId?.toString()
        );
      }

      // 记录删除历史（虽然无法真正撤销）
      const deletedFiles = files.map(file => ({
        path: file.path,
        name: file.name
      }));

      const undoAction: UndoAction = {
        type: 'delete',
        description: `删除了 ${files.length} 个项目`,
        data: {
          operation: 'cut', // Placeholder
          deletedFiles,
          targetDirectory: currentPath
        },
        timestamp: Date.now()
      };
      setUndoHistory(prev => [...prev.slice(-9), undoAction]);

      toast.success(t("fileManager.itemsDeletedSuccessfully", { count: files.length }));
      loadDirectory(currentPath);
      clearSelection();
    } catch (error: any) {
      if (error.message?.includes('connection') || error.message?.includes('established')) {
        toast.error(`SSH connection failed. Please check your connection to ${currentHost?.name} (${currentHost?.ip}:${currentHost?.port})`);
      } else {
        toast.error(t("fileManager.failedToDeleteItems"));
      }
      console.error("Delete failed:", error);
    }
  }

  function handleCreateNewFolder() {
    const baseName = "NewFolder";
    const uniqueName = generateUniqueName(baseName, 'directory');
    const folderPath = currentPath.endsWith('/')
      ? `${currentPath}${uniqueName}`
      : `${currentPath}/${uniqueName}`;

    // 直接进入编辑模式，使用唯一名字
    const newFolder: FileItem = {
      name: uniqueName,
      type: 'directory',
      path: folderPath
    };

    console.log('Starting edit for new folder with unique name:', newFolder);
    setEditingFile(newFolder);
    setIsCreatingNewFile(true);
  }

  function handleCreateNewFile() {
    const baseName = "NewFile.txt";
    const uniqueName = generateUniqueName(baseName, 'file');
    const filePath = currentPath.endsWith('/')
      ? `${currentPath}${uniqueName}`
      : `${currentPath}/${uniqueName}`;

    // 直接进入编辑模式，使用唯一名字
    const newFile: FileItem = {
      name: uniqueName,
      type: 'file',
      path: filePath,
      size: 0
    };

    console.log('Starting edit for new file with unique name:', newFile);
    setEditingFile(newFile);
    setIsCreatingNewFile(true);
  }

  // Handle symlink resolution
  const handleSymlinkClick = async (file: FileItem) => {
    if (!currentHost || !sshSessionId) {
      toast.error(t("fileManager.noSSHConnection"));
      return;
    }

    try {
      // 确保SSH连接有效
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
            credentialId: currentHost.credentialId
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
        // 如果软链接指向目录，导航到它
        setCurrentPath(symlinkInfo.target);
      } else if (symlinkInfo.type === "file") {
        // 如果软链接指向文件，打开文件
        // 计算窗口位置（稍微错开）
        const windowCount = Date.now() % 10;
        const offsetX = 120 + (windowCount * 30);
        const offsetY = 120 + (windowCount * 30);

        // 创建目标文件对象
        const targetFile: FileItem = {
          ...file,
          path: symlinkInfo.target
        };

        // 创建窗口组件工厂函数
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
          component: createWindowComponent
        });
      }
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error ||
        error?.message ||
        t("fileManager.failedToResolveSymlink")
      );
    }
  };

  async function handleFileOpen(file: FileItem, editMode: boolean = false) {
    if (file.type === 'directory') {
      setCurrentPath(file.path);
    } else if (file.type === 'link') {
      // 处理软链接
      await handleSymlinkClick(file);
    } else {
      // 在新窗口中打开文件
      if (!sshSessionId) {
        toast.error(t("fileManager.noSSHConnection"));
        return;
      }

      // 计算窗口位置（稍微错开）
      const windowCount = Date.now() % 10; // 简单的偏移计算
      const offsetX = 120 + (windowCount * 30);
      const offsetY = 120 + (windowCount * 30);

      const windowTitle = file.name; // 移除模式标识，由FileViewer内部控制

      // 创建窗口组件工厂函数
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
        component: createWindowComponent
      });
    }
  }

  // 专门的文件编辑函数
  function handleFileEdit(file: FileItem) {
    handleFileOpen(file, true);
  }

  // 专门的文件查看函数（只读）
  function handleFileView(file: FileItem) {
    handleFileOpen(file, false);
  }

  function handleContextMenu(event: React.MouseEvent, file?: FileItem) {
    event.preventDefault();

    // 如果右键点击的文件已经在选中列表中，使用所有选中的文件
    // 如果右键点击的文件不在选中列表中，只使用这一个文件
    let files: FileItem[];
    if (file) {
      const isFileSelected = selectedFiles.some(f => f.path === file.path);
      files = isFileSelected ? selectedFiles : [file];
    } else {
      files = selectedFiles;
    }

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      isVisible: true,
      files
    });
  }

  function handleCopyFiles(files: FileItem[]) {
    setClipboard({ files, operation: 'copy' });
    toast.success(t("fileManager.filesCopiedToClipboard", { count: files.length }));
  }

  function handleCutFiles(files: FileItem[]) {
    setClipboard({ files, operation: 'cut' });
    toast.success(t("fileManager.filesCutToClipboard", { count: files.length }));
  }

  async function handlePasteFiles() {
    if (!clipboard || !sshSessionId) return;

    try {
      await ensureSSHConnection();

      const { files, operation } = clipboard;

      // 处理复制和剪切操作
      let successCount = 0;
      const copiedItems: string[] = [];

      for (const file of files) {
        try {
          if (operation === 'copy') {
            // 复制操作：调用复制API
            const result = await copySSHItem(
              sshSessionId,
              file.path,
              currentPath,
              currentHost?.id,
              currentHost?.userId?.toString()
            );
            copiedItems.push(result.uniqueName || file.name);
            successCount++;
          } else {
            // 剪切操作：移动文件到目标目录
            const targetPath = currentPath.endsWith('/')
              ? `${currentPath}${file.name}`
              : `${currentPath}/${file.name}`;

            // 只有当目标路径与原路径不同时才移动
            if (file.path !== targetPath) {
              // 使用专门的 moveSSHItem API 进行跨目录移动
              await moveSSHItem(
                sshSessionId,
                file.path,
                targetPath,
                currentHost?.id,
                currentHost?.userId?.toString()
              );
              successCount++;
            }
          }
        } catch (error: any) {
          console.error(`Failed to ${operation} file ${file.name}:`, error);
          toast.error(`${operation === 'copy' ? '复制' : '移动'} ${file.name} 失败: ${error.message}`);
        }
      }

      // 记录撤销历史
      if (successCount > 0) {
        if (operation === 'copy') {
          const copiedFiles = files.slice(0, successCount).map((file, index) => ({
            originalPath: file.path,
            targetPath: `${currentPath}/${copiedItems[index] || file.name}`,
            targetName: copiedItems[index] || file.name
          }));

          const undoAction: UndoAction = {
            type: 'copy',
            description: `复制了 ${successCount} 个项目`,
            data: {
              operation: 'copy',
              copiedFiles,
              targetDirectory: currentPath
            },
            timestamp: Date.now()
          };
          setUndoHistory(prev => [...prev.slice(-9), undoAction]); // 保持最多10个撤销记录
        } else if (operation === 'cut') {
          // 剪切操作：记录移动信息，撤销时可以移回原位置
          const movedFiles = files.slice(0, successCount).map(file => {
            const targetPath = currentPath.endsWith('/')
              ? `${currentPath}${file.name}`
              : `${currentPath}/${file.name}`;
            return {
              originalPath: file.path,
              targetPath: targetPath,
              targetName: file.name
            };
          });

          const undoAction: UndoAction = {
            type: 'cut',
            description: `移动了 ${successCount} 个项目`,
            data: {
              operation: 'cut',
              copiedFiles: movedFiles, // 复用copiedFiles字段存储移动信息
              targetDirectory: currentPath
            },
            timestamp: Date.now()
          };
          setUndoHistory(prev => [...prev.slice(-9), undoAction]);
        }
      }

      // 显示成功提示
      if (successCount > 0) {
        const operationText = operation === 'copy' ? '复制' : '移动';
        if (operation === 'copy' && copiedItems.length > 0) {
          // 显示复制的详细信息，包括重命名的文件
          const hasRenamed = copiedItems.some(name =>
            !files.some(file => file.name === name)
          );

          if (hasRenamed) {
            toast.success(`已${operationText} ${successCount} 个项目，部分文件已自动重命名避免冲突`);
          } else {
            toast.success(`已${operationText} ${successCount} 个项目`);
          }
        } else {
          toast.success(`已${operationText} ${successCount} 个项目`);
        }
      }

      // 刷新文件列表
      loadDirectory(currentPath);
      clearSelection();

      // 清空剪贴板（剪切操作后，复制操作保留剪贴板内容）
      if (operation === 'cut') {
        setClipboard(null);
      }

    } catch (error: any) {
      toast.error(`粘贴失败: ${error.message || 'Unknown error'}`);
    }
  }

  async function handleUndo() {
    if (undoHistory.length === 0) {
      toast.info("没有可撤销的操作");
      return;
    }

    const lastAction = undoHistory[undoHistory.length - 1];

    try {
      await ensureSSHConnection();

      // 根据不同操作类型执行撤销逻辑
      switch (lastAction.type) {
        case 'copy':
          // 复制操作的撤销：删除复制的目标文件
          if (lastAction.data.copiedFiles) {
            let successCount = 0;
            for (const copiedFile of lastAction.data.copiedFiles) {
              try {
                const isDirectory = files.find(f => f.path === copiedFile.targetPath)?.type === 'directory';
                await deleteSSHItem(
                  sshSessionId!,
                  copiedFile.targetPath,
                  isDirectory,
                  currentHost?.id,
                  currentHost?.userId?.toString()
                );
                successCount++;
              } catch (error: any) {
                console.error(`Failed to delete copied file ${copiedFile.targetName}:`, error);
                toast.error(`删除复制文件 ${copiedFile.targetName} 失败: ${error.message}`);
              }
            }

            if (successCount > 0) {
              // 移除最后一个撤销记录
              setUndoHistory(prev => prev.slice(0, -1));
              toast.success(`已撤销复制操作：删除了 ${successCount} 个复制的文件`);
            } else {
              toast.error("撤销失败：无法删除任何复制的文件");
              return;
            }
          } else {
            toast.error("撤销失败：找不到复制的文件信息");
            return;
          }
          break;

        case 'cut':
          // 剪切操作的撤销：将文件移回原位置
          if (lastAction.data.copiedFiles) {
            let successCount = 0;
            for (const movedFile of lastAction.data.copiedFiles) {
              try {
                // 将文件从当前位置移回原位置
                await moveSSHItem(
                  sshSessionId!,
                  movedFile.targetPath, // 当前位置（目标路径）
                  movedFile.originalPath, // 移回原位置
                  currentHost?.id,
                  currentHost?.userId?.toString()
                );
                successCount++;
              } catch (error: any) {
                console.error(`Failed to move back file ${movedFile.targetName}:`, error);
                toast.error(`移回文件 ${movedFile.targetName} 失败: ${error.message}`);
              }
            }

            if (successCount > 0) {
              // 移除最后一个撤销记录
              setUndoHistory(prev => prev.slice(0, -1));
              toast.success(`已撤销移动操作：移回了 ${successCount} 个文件到原位置`);
            } else {
              toast.error("撤销失败：无法移回任何文件");
              return;
            }
          } else {
            toast.error("撤销失败：找不到移动的文件信息");
            return;
          }
          break;

        case 'delete':
          // 删除操作无法真正撤销（文件已从服务器删除）
          toast.info("删除操作无法撤销：文件已从服务器永久删除");
          // 仍然移除历史记录，因为用户已经知道了这个限制
          setUndoHistory(prev => prev.slice(0, -1));
          return;

        default:
          toast.error("不支持撤销此类操作");
          return;
      }

      // 刷新文件列表
      loadDirectory(currentPath);

    } catch (error: any) {
      toast.error(`撤销操作失败: ${error.message || 'Unknown error'}`);
      console.error("Undo failed:", error);
    }
  }

  function handleRenameFile(file: FileItem) {
    setEditingFile(file);
  }

  // 确保SSH连接有效
  async function ensureSSHConnection() {
    if (!sshSessionId || !currentHost) return;

    try {
      const status = await getSSHStatus(sshSessionId);
      console.log('SSH connection status:', status);

      if (!status.connected) {
        console.log('SSH not connected, attempting to reconnect...');

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
          userId: currentHost.userId
        });

        console.log('SSH reconnection successful');
      }
    } catch (error) {
      console.log('SSH connection check/reconnect failed:', error);
      throw error;
    }
  }

  // 处理重命名/创建确认
  async function handleRenameConfirm(file: FileItem, newName: string) {
    if (!sshSessionId) return;

    try {
      // 确保SSH连接有效
      await ensureSSHConnection();

      if (isCreatingNewFile) {
        // 新建项目：直接创建最终名字
        console.log('Creating new item:', {
          type: file.type,
          name: newName,
          path: currentPath,
          hostId: currentHost?.id,
          userId: currentHost?.userId
        });

        if (file.type === 'file') {
          await createSSHFile(
            sshSessionId,
            currentPath,
            newName,
            "",
            currentHost?.id,
            currentHost?.userId?.toString()
          );
          toast.success(t("fileManager.fileCreatedSuccessfully", { name: newName }));
        } else if (file.type === 'directory') {
          await createSSHFolder(
            sshSessionId,
            currentPath,
            newName,
            currentHost?.id,
            currentHost?.userId?.toString()
          );
          toast.success(t("fileManager.folderCreatedSuccessfully", { name: newName }));
        }

        setIsCreatingNewFile(false);
      } else {
        // 现有项目：重命名
        console.log('Renaming existing item:', {
          from: file.path,
          to: newName,
          hostId: currentHost?.id,
          userId: currentHost?.userId
        });

        await renameSSHItem(
          sshSessionId,
          file.path,
          newName,
          currentHost?.id,
          currentHost?.userId?.toString()
        );
        toast.success(t("fileManager.itemRenamedSuccessfully", { name: newName }));
      }

      // 清除编辑状态
      setEditingFile(null);
      loadDirectory(currentPath);
    } catch (error: any) {
      console.error("Rename failed with error:", {
        error,
        oldPath,
        newName,
        message: error.message
      });

      if (error.message?.includes('connection') || error.message?.includes('established')) {
        toast.error(`SSH connection failed. Please check your connection to ${currentHost?.name} (${currentHost?.ip}:${currentHost?.port})`);
      } else {
        toast.error(t("fileManager.failedToRenameItem"));
      }
    }
  }

  // 开始编辑文件名
  function handleStartEdit(file: FileItem) {
    setEditingFile(file);
  }

  // 取消编辑（现在也会保留项目）
  async function handleCancelEdit() {
    if (isCreatingNewFile && editingFile) {
      // 取消时也使用默认名字创建项目
      console.log('Creating item with default name on cancel:', editingFile.name);
      await handleRenameConfirm(editingFile, editingFile.name);
    } else {
      setEditingFile(null);
    }
  }

  // 生成唯一名字（处理重名冲突）
  function generateUniqueName(baseName: string, type: 'file' | 'directory'): string {
    const existingNames = files.map(f => f.name.toLowerCase());
    let candidateName = baseName;
    let counter = 1;

    // 如果名字已存在，尝试添加数字后缀
    while (existingNames.includes(candidateName.toLowerCase())) {
      if (type === 'file' && baseName.includes('.')) {
        // 对于文件，在文件名和扩展名之间添加数字
        const lastDotIndex = baseName.lastIndexOf('.');
        const nameWithoutExt = baseName.substring(0, lastDotIndex);
        const extension = baseName.substring(lastDotIndex);
        candidateName = `${nameWithoutExt}${counter}${extension}`;
      } else {
        // 对于文件夹或没有扩展名的文件，直接添加数字
        candidateName = `${baseName}${counter}`;
      }
      counter++;
    }

    console.log(`Generated unique name: ${baseName} -> ${candidateName}`);
    return candidateName;
  }

  // 拖拽处理：文件/文件夹拖到文件夹 = 移动操作
  async function handleFileDrop(draggedFiles: FileItem[], targetFolder: FileItem) {
    if (!sshSessionId || targetFolder.type !== 'directory') return;

    try {
      await ensureSSHConnection();

      let successCount = 0;
      const movedItems: string[] = [];

      for (const file of draggedFiles) {
        try {
          const targetPath = targetFolder.path.endsWith('/')
            ? `${targetFolder.path}${file.name}`
            : `${targetFolder.path}/${file.name}`;

          // 只有当目标路径与原路径不同时才移动
          if (file.path !== targetPath) {
            await moveSSHItem(
              sshSessionId,
              file.path,
              targetPath,
              currentHost?.id,
              currentHost?.userId?.toString()
            );
            movedItems.push(file.name);
            successCount++;
          }
        } catch (error: any) {
          console.error(`Failed to move file ${file.name}:`, error);
          toast.error(`移动 ${file.name} 失败: ${error.message}`);
        }
      }

      if (successCount > 0) {
        // 记录撤销历史
        const movedFiles = draggedFiles.slice(0, successCount).map((file, index) => {
          const targetPath = targetFolder.path.endsWith('/')
            ? `${targetFolder.path}${file.name}`
            : `${targetFolder.path}/${file.name}`;
          return {
            originalPath: file.path,
            targetPath: targetPath,
            targetName: file.name
          };
        });

        const undoAction: UndoAction = {
          type: 'cut',
          description: `拖拽移动了 ${successCount} 个项目到 ${targetFolder.name}`,
          data: {
            operation: 'cut',
            copiedFiles: movedFiles,
            targetDirectory: targetFolder.path
          },
          timestamp: Date.now()
        };
        setUndoHistory(prev => [...prev.slice(-9), undoAction]);

        toast.success(`成功移动了 ${successCount} 个项目到 ${targetFolder.name}`);
        loadDirectory(currentPath);
        clearSelection(); // 清除选中状态
      }
    } catch (error: any) {
      console.error('Drag move operation failed:', error);
      toast.error(`移动操作失败: ${error.message}`);
    }
  }

  // 拖拽处理：文件拖到文件 = diff对比操作
  function handleFileDiff(file1: FileItem, file2: FileItem) {
    if (file1.type !== 'file' || file2.type !== 'file') {
      toast.error('只能对比两个文件');
      return;
    }

    if (!sshSessionId) {
      toast.error(t("fileManager.noSSHConnection"));
      return;
    }

    // 使用专用的DiffWindow进行文件对比
    console.log('Opening diff comparison:', file1.name, 'vs', file2.name);

    // 计算窗口位置
    const offsetX = 100;
    const offsetY = 80;

    // 创建diff窗口
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
      type: 'diff',
      title: `文件对比: ${file1.name} ↔ ${file2.name}`,
      isMaximized: false,
      component: createWindowComponent,
      zIndex: Date.now()
    });

    toast.success(`正在对比文件: ${file1.name} 与 ${file2.name}`);
  }

  // 拖拽到桌面处理函数
  async function handleDragToDesktop(files: FileItem[]) {
    if (!currentHost || !sshSessionId) {
      toast.error(t("fileManager.noSSHConnection"));
      return;
    }

    try {
      // 优先使用新的系统级拖拽方案
      if (systemDrag.isFileSystemAPISupported) {
        await systemDrag.handleDragToSystem(files, {
          enableToast: true,
          onSuccess: () => {
            console.log('系统级拖拽成功');
          },
          onError: (error) => {
            console.error('系统级拖拽失败:', error);
          }
        });
      } else {
        // 降级到Electron方案
        if (files.length === 1) {
          await dragToDesktop.dragFileToDesktop(files[0]);
        } else if (files.length > 1) {
          await dragToDesktop.dragFilesToDesktop(files);
        }
      }
    } catch (error: any) {
      console.error('拖拽到桌面失败:', error);
      toast.error(`拖拽失败: ${error.message || '未知错误'}`);
    }
  }

  // 打开终端处理函数
  function handleOpenTerminal(path: string) {
    if (!currentHost) {
      toast.error(t("fileManager.noHostSelected"));
      return;
    }


    // 创建终端窗口
    const windowCount = Date.now() % 10;
    const offsetX = 200 + (windowCount * 40);
    const offsetY = 150 + (windowCount * 40);

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
      title: `终端 - ${currentHost.name}:${path}`,
      x: offsetX,
      y: offsetY,
      width: 800,
      height: 500,
      isMaximized: false,
      isMinimized: false,
      component: createTerminalComponent
    });

    toast.success(t("fileManager.terminalWithPath", { host: currentHost.name, path }));
  }

  // 运行可执行文件处理函数
  function handleRunExecutable(file: FileItem) {
    if (!currentHost) {
      toast.error(t("fileManager.noHostSelected"));
      return;
    }

    if (file.type !== 'file' || !file.executable) {
      toast.error(t("fileManager.onlyRunExecutableFiles"));
      return;
    }

    // 获取文件所在目录
    const fileDir = file.path.substring(0, file.path.lastIndexOf('/'));
    const fileName = file.name;
    const executeCmd = `./${fileName}`;

    // 创建执行用的终端窗口
    const windowCount = Date.now() % 10;
    const offsetX = 250 + (windowCount * 40);
    const offsetY = 200 + (windowCount * 40);

    const createExecutionTerminal = (windowId: string) => (
      <TerminalWindow
        windowId={windowId}
        hostConfig={currentHost}
        initialPath={fileDir}
        initialX={offsetX}
        initialY={offsetY}
        executeCommand={executeCmd} // 自动执行命令
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
      component: createExecutionTerminal
    });

    toast.success(t("fileManager.runningFile", { file: file.name }));
  }

  // 加载固定文件列表
  async function loadPinnedFiles() {
    if (!currentHost?.id) return;

    try {
      const pinnedData = await getPinnedFiles(currentHost.id);
      const pinnedPaths = new Set(pinnedData.map((item: any) => item.path));
      setPinnedFiles(pinnedPaths);
    } catch (error) {
      console.error('Failed to load pinned files:', error);
    }
  }

  // PIN文件
  async function handlePinFile(file: FileItem) {
    if (!currentHost?.id) return;

    try {
      await addPinnedFile(currentHost.id, file.path, file.name);
      setPinnedFiles(prev => new Set([...prev, file.path]));
      setSidebarRefreshTrigger(prev => prev + 1); // 触发侧边栏刷新
      toast.success(`文件"${file.name}"已固定`);
    } catch (error) {
      console.error('Failed to pin file:', error);
      toast.error('固定文件失败');
    }
  }

  // UNPIN文件
  async function handleUnpinFile(file: FileItem) {
    if (!currentHost?.id) return;

    try {
      await removePinnedFile(currentHost.id, file.path);
      setPinnedFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(file.path);
        return newSet;
      });
      setSidebarRefreshTrigger(prev => prev + 1); // 触发侧边栏刷新
      toast.success(`文件"${file.name}"已取消固定`);
    } catch (error) {
      console.error('Failed to unpin file:', error);
      toast.error('取消固定失败');
    }
  }

  // 添加文件夹快捷方式
  async function handleAddShortcut(path: string) {
    if (!currentHost?.id) return;

    try {
      const folderName = path.split('/').pop() || path;
      await addFolderShortcut(currentHost.id, path, folderName);
      setSidebarRefreshTrigger(prev => prev + 1); // 触发侧边栏刷新
      toast.success(`文件夹快捷方式"${folderName}"已添加`);
    } catch (error) {
      console.error('Failed to add shortcut:', error);
      toast.error('添加快捷方式失败');
    }
  }

  // 检查文件是否已固定
  function isPinnedFile(file: FileItem): boolean {
    return pinnedFiles.has(file.path);
  }

  // 记录最近访问的文件
  async function recordRecentFile(file: FileItem) {
    if (!currentHost?.id || file.type === 'directory') return;

    try {
      await addRecentFile(currentHost.id, file.path, file.name);
      setSidebarRefreshTrigger(prev => prev + 1); // 触发侧边栏刷新
    } catch (error) {
      console.error('Failed to record recent file:', error);
    }
  }

  // 处理文件打开
  async function handleFileOpen(file: FileItem) {
    if (file.type === 'directory') {
      // 如果是目录，切换到该目录
      setCurrentPath(file.path);
    } else {
      // 如果是文件，记录到最近访问并打开文件窗口
      await recordRecentFile(file);

      // 创建文件窗口
      const windowCount = Date.now() % 10;
      const offsetX = 100 + (windowCount * 30);
      const offsetY = 100 + (windowCount * 30);

      const createFileWindow = (windowId: string) => (
        <FileWindow
          windowId={windowId}
          file={file}
          sshHost={currentHost!}
          sshSessionId={sshSessionId!}
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
        component: createFileWindow
      });
    }
  }

  // 加载固定文件列表（当主机或连接改变时）
  useEffect(() => {
    if (currentHost?.id) {
      loadPinnedFiles();
    }
  }, [currentHost?.id]);

  // 过滤文件并添加新建的临时项目
  let filteredFiles = files.filter(file =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 如果正在创建新项目，将其添加到列表中
  if (isCreatingNewFile && editingFile) {
    // 检查是否已经存在同名项目，避免重复
    const exists = filteredFiles.some(f => f.path === editingFile.path);
    if (!exists && editingFile.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      filteredFiles = [editingFile, ...filteredFiles]; // 将新项目放在前面
    }
  }

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
      {/* 工具栏 */}
      <div className="flex-shrink-0 border-b border-dark-border">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-white">
              {currentHost.name}
            </h2>
            <span className="text-sm text-muted-foreground">
              {currentHost.ip}:{currentHost.port}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* 搜索 */}
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("fileManager.searchFiles")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 w-48 h-9 bg-dark-bg-button border-dark-border"
              />
            </div>

            {/* 视图切换 */}
            <div className="flex border border-dark-border rounded-md">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('grid')}
                className="rounded-r-none h-9"
              >
                <Grid3X3 className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('list')}
                className="rounded-l-none h-9"
              >
                <List className="w-4 h-4" />
              </Button>
            </div>

            {/* 操作按钮 */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
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
              onClick={() => loadDirectory(currentPath)}
              className="h-9"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 flex" {...dragHandlers}>
        {/* 左侧边栏 */}
        <div className="w-64 flex-shrink-0">
          <FileManagerSidebar
            currentHost={currentHost}
            currentPath={currentPath}
            onPathChange={setCurrentPath}
            onLoadDirectory={loadDirectory}
            sshSessionId={sshSessionId}
            refreshTrigger={sidebarRefreshTrigger}
          />
        </div>

        {/* 右侧文件网格 */}
        <div className="flex-1 relative">
          <FileManagerGrid
          files={filteredFiles}
          selectedFiles={selectedFiles}
          onFileSelect={() => {}} // 不再需要这个回调，使用onSelectionChange
          onFileOpen={handleFileOpen}
          onSelectionChange={setSelection}
          currentPath={currentPath}
          isLoading={isLoading}
          onPathChange={setCurrentPath}
          onRefresh={() => loadDirectory(currentPath)}
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
          onFileDrop={handleFileDrop}
          onFileDiff={handleFileDiff}
          onSystemDragStart={handleFileDragStart}
          onSystemDragEnd={handleFileDragEnd}
        />

        {/* 右键菜单 */}
        <FileManagerContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          files={contextMenu.files}
          isVisible={contextMenu.isVisible}
          onClose={() => setContextMenu(prev => ({ ...prev, isVisible: false }))}
          onDownload={(files) => files.forEach(handleDownloadFile)}
          onRename={handleRenameFile}
          onCopy={handleCopyFiles}
          onCut={handleCutFiles}
          onPaste={handlePasteFiles}
          onDelete={handleDeleteFiles}
          onUpload={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.onchange = (e) => {
              const files = (e.target as HTMLInputElement).files;
              if (files) handleFilesDropped(files);
            };
            input.click();
          }}
          onNewFolder={handleCreateNewFolder}
          onNewFile={handleCreateNewFile}
          onRefresh={() => loadDirectory(currentPath)}
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

// 主要的导出组件，包装了 WindowManager
export function FileManagerModern({ initialHost, onClose }: FileManagerModernProps) {
  return (
    <WindowManager>
      <FileManagerContent initialHost={initialHost} onClose={onClose} />
    </WindowManager>
  );
}