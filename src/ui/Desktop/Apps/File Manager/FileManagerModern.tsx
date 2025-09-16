import React, { useState, useEffect, useRef } from "react";
import { FileManagerGrid } from "./FileManagerGrid";
import { FileManagerContextMenu } from "./FileManagerContextMenu";
import { useFileSelection } from "./hooks/useFileSelection";
import { useDragAndDrop } from "./hooks/useDragAndDrop";
import { WindowManager, useWindowManager } from "./components/WindowManager";
import { FileWindow } from "./components/FileWindow";
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
import type { SSHHost } from "../../../types/index.js";
import {
  listSSHFiles,
  uploadSSHFile,
  downloadSSHFile,
  createSSHFile,
  createSSHFolder,
  deleteSSHItem,
  renameSSHItem,
  connectSSH,
  getSSHStatus
} from "@/ui/main-axios.ts";

interface FileItem {
  name: string;
  type: "file" | "directory" | "link";
  path: string;
  size?: number;
  modified?: string;
  permissions?: string;
  owner?: string;
  group?: string;
}

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

      const contents = await listSSHFiles(sshSessionId, path);
      console.log("Directory contents loaded:", contents?.length || 0, "items");
      console.log("Raw file data from backend:", contents);

      // 为文件添加完整路径
      const filesWithPath = (contents || []).map(file => ({
        ...file,
        path: path + (path.endsWith("/") ? "" : "/") + file.name
      }));

      console.log("Files with constructed paths:", filesWithPath.map(f => ({ name: f.name, path: f.path })));

      setFiles(filesWithPath);
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
      const targetPath = currentPath.endsWith('/')
        ? `${currentPath}${file.name}`
        : `${currentPath}/${file.name}`;

      await uploadSSHFile(sshSessionId, targetPath, file);
      toast.success(t("fileManager.fileUploadedSuccessfully", { name: file.name }));
      loadDirectory(currentPath);
    } catch (error: any) {
      toast.error(t("fileManager.failedToUploadFile"));
      console.error("Upload failed:", error);
    }
  }

  async function handleDownloadFile(file: FileItem) {
    if (!sshSessionId) return;

    try {
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
      toast.error(t("fileManager.failedToDownloadFile"));
      console.error("Download failed:", error);
    }
  }

  async function handleDeleteFiles(files: FileItem[]) {
    if (!sshSessionId || files.length === 0) return;

    try {
      for (const file of files) {
        await deleteSSHItem(sshSessionId, file.path);
      }
      toast.success(t("fileManager.itemsDeletedSuccessfully", { count: files.length }));
      loadDirectory(currentPath);
      clearSelection();
    } catch (error: any) {
      toast.error(t("fileManager.failedToDeleteItems"));
      console.error("Delete failed:", error);
    }
  }

  async function handleCreateNewFolder() {
    if (!sshSessionId) return;

    const folderName = prompt(t("fileManager.enterFolderName"));
    if (!folderName) return;

    try {
      const folderPath = currentPath.endsWith('/')
        ? `${currentPath}${folderName}`
        : `${currentPath}/${folderName}`;

      await createSSHFolder(sshSessionId, folderPath);
      toast.success(t("fileManager.folderCreatedSuccessfully", { name: folderName }));
      loadDirectory(currentPath);
    } catch (error: any) {
      toast.error(t("fileManager.failedToCreateFolder"));
      console.error("Create folder failed:", error);
    }
  }

  async function handleCreateNewFile() {
    if (!sshSessionId) return;

    const fileName = prompt(t("fileManager.enterFileName"));
    if (!fileName) return;

    try {
      const filePath = currentPath.endsWith('/')
        ? `${currentPath}${fileName}`
        : `${currentPath}/${fileName}`;

      await createSSHFile(sshSessionId, filePath, "");
      toast.success(t("fileManager.fileCreatedSuccessfully", { name: fileName }));
      loadDirectory(currentPath);
    } catch (error: any) {
      toast.error(t("fileManager.failedToCreateFile"));
      console.error("Create file failed:", error);
    }
  }

  function handleFileOpen(file: FileItem) {
    if (file.type === 'directory') {
      setCurrentPath(file.path);
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

      // 创建窗口组件工厂函数
      const createWindowComponent = (windowId: string) => (
        <FileWindow
          windowId={windowId}
          file={file}
          sshSessionId={sshSessionId}
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
  }

  function handleContextMenu(event: React.MouseEvent, file?: FileItem) {
    event.preventDefault();

    const files = file ? [file] : selectedFiles;

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

  function handlePasteFiles() {
    if (!clipboard || !sshSessionId) return;

    // TODO: 实现粘贴功能
    // 这里需要根据剪贴板操作类型（copy/cut）来执行相应的操作
    toast.info("粘贴功能正在开发中...");
  }

  function handleRenameFile(file: FileItem) {
    if (!sshSessionId) return;

    const newName = prompt(t("fileManager.enterNewName"), file.name);
    if (!newName || newName === file.name) return;

    // TODO: 实现重命名功能
    toast.info("重命名功能正在开发中...");
  }

  // 过滤文件
  const filteredFiles = files.filter(file =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
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
      <div className="flex-1 relative" {...dragHandlers}>
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
          onContextMenu={handleContextMenu}
          viewMode={viewMode}
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
        />
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