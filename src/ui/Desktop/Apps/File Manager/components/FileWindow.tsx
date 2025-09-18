import React, { useState, useEffect, useRef } from "react";
import { DraggableWindow } from "./DraggableWindow";
import { FileViewer } from "./FileViewer";
import { useWindowManager } from "./WindowManager";
import {
  downloadSSHFile,
  readSSHFile,
  writeSSHFile,
  getSSHStatus,
  connectSSH,
} from "@/ui/main-axios";
import { toast } from "sonner";

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

interface SSHHost {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  authType: "password" | "key";
  credentialId?: number;
  userId?: number;
}

interface FileWindowProps {
  windowId: string;
  file: FileItem;
  sshSessionId: string;
  sshHost: SSHHost;
  initialX?: number;
  initialY?: number;
  // readOnly参数已移除，由FileViewer内部根据文件类型决定
}

export function FileWindow({
  windowId,
  file,
  sshSessionId,
  sshHost,
  initialX = 100,
  initialY = 100,
}: FileWindowProps) {
  const {
    closeWindow,
    minimizeWindow,
    maximizeWindow,
    focusWindow,
    updateWindow,
    windows,
  } = useWindowManager();

  const [content, setContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isEditable, setIsEditable] = useState(false);
  const [pendingContent, setPendingContent] = useState<string>("");
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const currentWindow = windows.find((w) => w.id === windowId);

  // 确保SSH连接有效
  const ensureSSHConnection = async () => {
    try {
      // 首先检查SSH连接状态
      const status = await getSSHStatus(sshSessionId);
      console.log("SSH connection status:", status);

      if (!status.connected) {
        console.log("SSH not connected, attempting to reconnect...");

        // 重新建立连接
        await connectSSH(sshSessionId, {
          hostId: sshHost.id,
          ip: sshHost.ip,
          port: sshHost.port,
          username: sshHost.username,
          password: sshHost.password,
          sshKey: sshHost.key,
          keyPassword: sshHost.keyPassword,
          authType: sshHost.authType,
          credentialId: sshHost.credentialId,
          userId: sshHost.userId,
        });

        console.log("SSH reconnection successful");
      }
    } catch (error) {
      console.log("SSH connection check/reconnect failed:", error);
      // 即使连接失败也尝试继续，让具体的API调用报错
      throw error;
    }
  };

  // 加载文件内容
  useEffect(() => {
    const loadFileContent = async () => {
      if (file.type !== "file") return;

      try {
        setIsLoading(true);

        // 确保SSH连接有效
        await ensureSSHConnection();

        const response = await readSSHFile(sshSessionId, file.path);
        const fileContent = response.content || "";
        setContent(fileContent);
        setPendingContent(fileContent); // 初始化待保存内容

        // 如果文件大小未知，根据内容计算大小
        if (!file.size) {
          const contentSize = new Blob([fileContent]).size;
          file.size = contentSize;
        }

        // 根据文件类型决定是否可编辑：除了媒体文件，其他都可编辑
        const mediaExtensions = [
          // 图片文件
          "jpg",
          "jpeg",
          "png",
          "gif",
          "bmp",
          "svg",
          "webp",
          "tiff",
          "ico",
          // 音频文件
          "mp3",
          "wav",
          "ogg",
          "aac",
          "flac",
          "m4a",
          "wma",
          // 视频文件
          "mp4",
          "avi",
          "mov",
          "wmv",
          "flv",
          "mkv",
          "webm",
          "m4v",
          // 压缩文件
          "zip",
          "rar",
          "7z",
          "tar",
          "gz",
          "bz2",
          "xz",
          // 二进制文件
          "exe",
          "dll",
          "so",
          "dylib",
          "bin",
          "iso",
        ];

        const extension = file.name.split(".").pop()?.toLowerCase();
        // 只有媒体文件和二进制文件不可编辑，其他所有文件都可编辑
        setIsEditable(!mediaExtensions.includes(extension || ""));
      } catch (error: any) {
        console.error("Failed to load file:", error);

        // 检查是否是大文件错误
        const errorData = error?.response?.data;
        if (errorData?.tooLarge) {
          toast.error(`File too large: ${errorData.error}`, {
            duration: 10000, // 10 seconds for important message
          });
        } else if (
          error.message?.includes("connection") ||
          error.message?.includes("established")
        ) {
          // 如果是连接错误，提供更明确的错误信息
          toast.error(
            `SSH connection failed. Please check your connection to ${sshHost.name} (${sshHost.ip}:${sshHost.port})`,
          );
        } else {
          toast.error(
            `Failed to load file: ${error.message || errorData?.error || "Unknown error"}`,
          );
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadFileContent();
  }, [file, sshSessionId, sshHost]);

  // 保存文件
  const handleSave = async (newContent: string) => {
    try {
      setIsLoading(true);

      // 确保SSH连接有效
      await ensureSSHConnection();

      await writeSSHFile(sshSessionId, file.path, newContent);
      setContent(newContent);
      setPendingContent(""); // 清除待保存内容

      // 清除自动保存定时器
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }

      toast.success("File saved successfully");
    } catch (error: any) {
      console.error("Failed to save file:", error);

      // 如果是连接错误，提供更明确的错误信息
      if (
        error.message?.includes("connection") ||
        error.message?.includes("established")
      ) {
        toast.error(
          `SSH connection failed. Please check your connection to ${sshHost.name} (${sshHost.ip}:${sshHost.port})`,
        );
      } else {
        toast.error(`Failed to save file: ${error.message || "Unknown error"}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // 处理内容变更 - 设置1分钟自动保存
  const handleContentChange = (newContent: string) => {
    setPendingContent(newContent);

    // 清除之前的定时器
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // 设置新的1分钟自动保存定时器
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        console.log("Auto-saving file...");
        await handleSave(newContent);
        toast.success("File auto-saved");
      } catch (error) {
        console.error("Auto-save failed:", error);
        toast.error("Auto-save failed");
      }
    }, 60000); // 1分钟 = 60000毫秒
  };

  // 清理定时器
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // 下载文件
  const handleDownload = async () => {
    try {
      // 确保SSH连接有效
      await ensureSSHConnection();

      const response = await downloadSSHFile(sshSessionId, file.path);

      if (response?.content) {
        // Convert base64 to blob and trigger download
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

        toast.success("File downloaded successfully");
      }
    } catch (error: any) {
      console.error("Failed to download file:", error);

      // 如果是连接错误，提供更明确的错误信息
      if (
        error.message?.includes("connection") ||
        error.message?.includes("established")
      ) {
        toast.error(
          `SSH connection failed. Please check your connection to ${sshHost.name} (${sshHost.ip}:${sshHost.port})`,
        );
      } else {
        toast.error(
          `Failed to download file: ${error.message || "Unknown error"}`,
        );
      }
    }
  };

  // 窗口操作处理
  const handleClose = () => {
    closeWindow(windowId);
  };

  const handleMinimize = () => {
    minimizeWindow(windowId);
  };

  const handleMaximize = () => {
    maximizeWindow(windowId);
  };

  const handleFocus = () => {
    focusWindow(windowId);
  };

  if (!currentWindow) {
    return null;
  }

  return (
    <DraggableWindow
      title={file.name}
      initialX={initialX}
      initialY={initialY}
      initialWidth={800}
      initialHeight={600}
      minWidth={400}
      minHeight={300}
      onClose={handleClose}
      onMinimize={handleMinimize}
      onMaximize={handleMaximize}
      onFocus={handleFocus}
      isMaximized={currentWindow.isMaximized}
      zIndex={currentWindow.zIndex}
    >
      <FileViewer
        file={file}
        content={pendingContent || content}
        savedContent={content}
        isLoading={isLoading}
        isEditable={isEditable} // 移除强制只读模式，由FileViewer内部控制
        onContentChange={handleContentChange}
        onSave={(newContent) => handleSave(newContent)}
        onDownload={handleDownload}
      />
    </DraggableWindow>
  );
}
