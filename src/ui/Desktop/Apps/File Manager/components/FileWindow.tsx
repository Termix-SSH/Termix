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
  // readOnly parameter removed, determined internally by FileViewer based on file type
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

  // Ensure SSH connection is valid
  const ensureSSHConnection = async () => {
    try {
      // First check SSH connection status
      const status = await getSSHStatus(sshSessionId);
      console.log("SSH connection status:", status);

      if (!status.connected) {
        console.log("SSH not connected, attempting to reconnect...");

        // Re-establish connection
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
      // Even if connection fails, try to continue and let specific API calls handle errors
      throw error;
    }
  };

  // Load file content
  useEffect(() => {
    const loadFileContent = async () => {
      if (file.type !== "file") return;

      try {
        setIsLoading(true);

        // Ensure SSH connection is valid
        await ensureSSHConnection();

        const response = await readSSHFile(sshSessionId, file.path);
        const fileContent = response.content || "";
        setContent(fileContent);
        setPendingContent(fileContent); // Initialize pending content

        // If file size is unknown, calculate size based on content
        if (!file.size) {
          const contentSize = new Blob([fileContent]).size;
          file.size = contentSize;
        }

        // Determine if editable based on file type: all except media files are editable
        const mediaExtensions = [
          // Image files
          "jpg",
          "jpeg",
          "png",
          "gif",
          "bmp",
          "svg",
          "webp",
          "tiff",
          "ico",
          // Audio files
          "mp3",
          "wav",
          "ogg",
          "aac",
          "flac",
          "m4a",
          "wma",
          // Video files
          "mp4",
          "avi",
          "mov",
          "wmv",
          "flv",
          "mkv",
          "webm",
          "m4v",
          // Archive files
          "zip",
          "rar",
          "7z",
          "tar",
          "gz",
          "bz2",
          "xz",
          // Binary files
          "exe",
          "dll",
          "so",
          "dylib",
          "bin",
          "iso",
        ];

        const extension = file.name.split(".").pop()?.toLowerCase();
        // Only media files and binary files are not editable, all other files are editable
        setIsEditable(!mediaExtensions.includes(extension || ""));
      } catch (error: any) {
        console.error("Failed to load file:", error);

        // Check if it's a large file error
        const errorData = error?.response?.data;
        if (errorData?.tooLarge) {
          toast.error(`File too large: ${errorData.error}`, {
            duration: 10000, // 10 seconds for important message
          });
        } else if (
          error.message?.includes("connection") ||
          error.message?.includes("established")
        ) {
          // If connection error, provide more specific error message
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

  // Save file
  const handleSave = async (newContent: string) => {
    try {
      setIsLoading(true);

      // Ensure SSH connection is valid
      await ensureSSHConnection();

      await writeSSHFile(sshSessionId, file.path, newContent);
      setContent(newContent);
      setPendingContent(""); // Clear pending content

      // Clear auto-save timer
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }

      toast.success(t("fileManager.fileSavedSuccessfully"));
    } catch (error: any) {
      console.error("Failed to save file:", error);

      // If it's a connection error, provide more specific error message
      if (
        error.message?.includes("connection") ||
        error.message?.includes("established")
      ) {
        toast.error(
          `SSH connection failed. Please check your connection to ${sshHost.name} (${sshHost.ip}:${sshHost.port})`,
        );
      } else {
        toast.error(`${t("fileManager.failedToSaveFile")}: ${error.message || t("fileManager.unknownError")}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Handle content changes - set 1-minute auto-save
  const handleContentChange = (newContent: string) => {
    setPendingContent(newContent);

    // Clear previous timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Set new 1-minute auto-save timer
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        console.log("Auto-saving file...");
        await handleSave(newContent);
        toast.success(t("fileManager.fileAutoSaved"));
      } catch (error) {
        console.error("Auto-save failed:", error);
        toast.error(t("fileManager.autoSaveFailed"));
      }
    }, 60000); // 1 minute = 60000 milliseconds
  };

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // Download file
  const handleDownload = async () => {
    try {
      // Ensure SSH connection is valid
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

        toast.success(t("fileManager.fileDownloadedSuccessfully"));
      }
    } catch (error: any) {
      console.error("Failed to download file:", error);

      // If it's a connection error, provide more specific error message
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

  // Window operation handling
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
        isEditable={isEditable} // Remove forced read-only mode, controlled internally by FileViewer
        onContentChange={handleContentChange}
        onSave={(newContent) => handleSave(newContent)}
        onDownload={handleDownload}
      />
    </DraggableWindow>
  );
}
