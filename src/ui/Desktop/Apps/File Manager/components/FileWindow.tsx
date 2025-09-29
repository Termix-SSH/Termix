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
import { useTranslation } from "react-i18next";

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
  onFileNotFound?: (file: FileItem) => void;
}

export function FileWindow({
  windowId,
  file,
  sshSessionId,
  sshHost,
  initialX = 100,
  initialY = 100,
  onFileNotFound,
}: FileWindowProps) {
  const { closeWindow, maximizeWindow, focusWindow, updateWindow, windows } =
    useWindowManager();

  const { t } = useTranslation();

  const [content, setContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isEditable, setIsEditable] = useState(false);
  const [pendingContent, setPendingContent] = useState<string>("");
  const [mediaDimensions, setMediaDimensions] = useState<
    { width: number; height: number } | undefined
  >();
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const currentWindow = windows.find((w) => w.id === windowId);

  const ensureSSHConnection = async () => {
    try {
      const status = await getSSHStatus(sshSessionId);

      if (!status.connected) {
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
      }
    } catch (error) {
      console.error("SSH connection check/reconnect failed:", error);
      throw error;
    }
  };

  useEffect(() => {
    const loadFileContent = async () => {
      if (file.type !== "file") return;

      try {
        setIsLoading(true);

        await ensureSSHConnection();

        const response = await readSSHFile(sshSessionId, file.path);
        const fileContent = response.content || "";
        setContent(fileContent);
        setPendingContent(fileContent);

        if (!file.size) {
          const contentSize = new Blob([fileContent]).size;
          file.size = contentSize;
        }

        const mediaExtensions = [
          "jpg",
          "jpeg",
          "png",
          "gif",
          "bmp",
          "svg",
          "webp",
          "tiff",
          "ico",
          "mp3",
          "wav",
          "ogg",
          "aac",
          "flac",
          "m4a",
          "wma",
          "mp4",
          "avi",
          "mov",
          "wmv",
          "flv",
          "mkv",
          "webm",
          "m4v",
          "zip",
          "rar",
          "7z",
          "tar",
          "gz",
          "bz2",
          "xz",
          "exe",
          "dll",
          "so",
          "dylib",
          "bin",
          "iso",
        ];

        const extension = file.name.split(".").pop()?.toLowerCase();
        setIsEditable(!mediaExtensions.includes(extension || ""));
      } catch (error: any) {
        console.error("Failed to load file:", error);

        const errorData = error?.response?.data;
        if (errorData?.tooLarge) {
          toast.error(`File too large: ${errorData.error}`, {
            duration: 10000,
          });
        } else if (
          error.message?.includes("connection") ||
          error.message?.includes("established")
        ) {
          toast.error(
            `SSH connection failed. Please check your connection to ${sshHost.name} (${sshHost.ip}:${sshHost.port})`,
          );
        } else {
          const errorMessage =
            errorData?.error || error.message || "Unknown error";
          const isFileNotFound =
            (error as any).isFileNotFound ||
            errorData?.fileNotFound ||
            error.response?.status === 404 ||
            errorMessage.includes("File not found") ||
            errorMessage.includes("No such file or directory") ||
            errorMessage.includes("cannot access") ||
            errorMessage.includes("not found") ||
            errorMessage.includes("Resource not found");

          if (isFileNotFound && onFileNotFound) {
            onFileNotFound(file);
            toast.error(
              t("fileManager.fileNotFoundAndRemoved", { name: file.name }),
            );

            closeWindow(windowId);
            return;
          } else {
            toast.error(
              t("fileManager.failedToLoadFile", {
                error: errorMessage.includes("Server error occurred")
                  ? t("fileManager.serverErrorOccurred")
                  : errorMessage,
              }),
            );
          }
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadFileContent();
  }, [file, sshSessionId, sshHost]);

  const handleRevert = async () => {
    const loadFileContent = async () => {
      if (file.type !== "file") return;

      try {
        setIsLoading(true);

        await ensureSSHConnection();

        const response = await readSSHFile(sshSessionId, file.path);
        const fileContent = response.content || "";
        setContent(fileContent);
        setPendingContent("");

        if (!file.size) {
          const contentSize = new Blob([fileContent]).size;
          file.size = contentSize;
        }
      } catch (error: any) {
        console.error("Failed to load file content:", error);
        toast.error(
          `${t("fileManager.failedToLoadFile")}: ${error.message || t("fileManager.unknownError")}`,
        );
      } finally {
        setIsLoading(false);
      }
    };

    loadFileContent();
  };

  const handleSave = async (newContent: string) => {
    try {
      setIsLoading(true);

      await ensureSSHConnection();

      await writeSSHFile(sshSessionId, file.path, newContent);
      setContent(newContent);
      setPendingContent("");

      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }

      toast.success(t("fileManager.fileSavedSuccessfully"));
    } catch (error: any) {
      console.error("Failed to save file:", error);

      if (
        error.message?.includes("connection") ||
        error.message?.includes("established")
      ) {
        toast.error(
          `SSH connection failed. Please check your connection to ${sshHost.name} (${sshHost.ip}:${sshHost.port})`,
        );
      } else {
        toast.error(
          `${t("fileManager.failedToSaveFile")}: ${error.message || t("fileManager.unknownError")}`,
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleContentChange = (newContent: string) => {
    setPendingContent(newContent);

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    if (newContent !== content) {
      autoSaveTimerRef.current = setTimeout(async () => {
        try {
          await handleSave(newContent);
          toast.success(t("fileManager.fileAutoSaved"));
        } catch (error) {
          console.error("Auto-save failed:", error);
          toast.error(t("fileManager.autoSaveFailed"));
        }
      }, 60000);
    }
  };

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  const handleDownload = async () => {
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

        toast.success(t("fileManager.fileDownloadedSuccessfully"));
      }
    } catch (error: any) {
      console.error("Failed to download file:", error);

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

  const handleClose = () => {
    closeWindow(windowId);
  };

  const handleMaximize = () => {
    maximizeWindow(windowId);
  };

  const handleFocus = () => {
    focusWindow(windowId);
  };

  const handleMediaDimensionsChange = (dimensions: {
    width: number;
    height: number;
  }) => {
    setMediaDimensions(dimensions);
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
      onMaximize={handleMaximize}
      onFocus={handleFocus}
      isMaximized={currentWindow.isMaximized}
      zIndex={currentWindow.zIndex}
      targetSize={mediaDimensions}
    >
      <FileViewer
        file={file}
        content={pendingContent || content}
        savedContent={content}
        isLoading={isLoading}
        onRevert={handleRevert}
        isEditable={isEditable}
        onContentChange={handleContentChange}
        onSave={(newContent) => handleSave(newContent)}
        onDownload={handleDownload}
        onMediaDimensionsChange={handleMediaDimensionsChange}
      />
    </DraggableWindow>
  );
}
