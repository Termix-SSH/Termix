import { useState, useCallback } from "react";
import { toast } from "sonner";
import { downloadSSHFile } from "@/ui/main-axios";
import type { FileItem, SSHHost } from "../../types/index.js";

interface DragToDesktopState {
  isDragging: boolean;
  isDownloading: boolean;
  progress: number;
  error: string | null;
}

interface UseDragToDesktopProps {
  sshSessionId: string;
  sshHost: SSHHost;
}

interface DragToDesktopOptions {
  enableToast?: boolean;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export function useDragToDesktop({
  sshSessionId,
  sshHost,
}: UseDragToDesktopProps) {
  const [state, setState] = useState<DragToDesktopState>({
    isDragging: false,
    isDownloading: false,
    progress: 0,
    error: null,
  });

  const isElectron = () => {
    return (
      typeof window !== "undefined" &&
      window.electronAPI &&
      window.electronAPI.isElectron
    );
  };

  const dragFileToDesktop = useCallback(
    async (file: FileItem, options: DragToDesktopOptions = {}) => {
      const { enableToast = true, onSuccess, onError } = options;

      if (!isElectron()) {
        const error =
          "Drag to desktop feature is only available in desktop application";
        if (enableToast) toast.error(error);
        onError?.(error);
        return false;
      }

      if (file.type !== "file") {
        const error = "Only files can be dragged to desktop";
        if (enableToast) toast.error(error);
        onError?.(error);
        return false;
      }

      try {
        setState((prev) => ({
          ...prev,
          isDownloading: true,
          progress: 0,
          error: null,
        }));

        const response = await downloadSSHFile(sshSessionId, file.path);

        if (!response?.content) {
          throw new Error("Unable to get file content");
        }

        setState((prev) => ({ ...prev, progress: 50 }));

        const tempResult = await window.electronAPI.createTempFile({
          fileName: file.name,
          content: response.content,
          encoding: "base64",
        });

        if (!tempResult.success) {
          throw new Error(
            tempResult.error || "Failed to create temporary file",
          );
        }

        setState((prev) => ({ ...prev, progress: 80, isDragging: true }));

        const dragResult = await window.electronAPI.startDragToDesktop({
          tempId: tempResult.tempId,
          fileName: file.name,
        });

        if (!dragResult.success) {
          throw new Error(dragResult.error || "Failed to start dragging");
        }

        setState((prev) => ({ ...prev, progress: 100 }));

        if (enableToast) {
          toast.success(`Dragging ${file.name} to desktop`);
        }

        onSuccess?.();

        setTimeout(async () => {
          await window.electronAPI.cleanupTempFile(tempResult.tempId);
          setState((prev) => ({
            ...prev,
            isDragging: false,
            isDownloading: false,
            progress: 0,
          }));
        }, 10000);

        return true;
      } catch (error: any) {
        console.error("Failed to drag to desktop:", error);
        const errorMessage = error.message || "Drag failed";

        setState((prev) => ({
          ...prev,
          isDownloading: false,
          isDragging: false,
          progress: 0,
          error: errorMessage,
        }));

        if (enableToast) {
          toast.error(`Drag failed: ${errorMessage}`);
        }

        onError?.(errorMessage);
        return false;
      }
    },
    [sshSessionId, sshHost],
  );

  const dragFilesToDesktop = useCallback(
    async (files: FileItem[], options: DragToDesktopOptions = {}) => {
      const { enableToast = true, onSuccess, onError } = options;

      if (!isElectron()) {
        const error =
          "Drag to desktop feature is only available in desktop application";
        if (enableToast) toast.error(error);
        onError?.(error);
        return false;
      }

      const fileList = files.filter((f) => f.type === "file");
      if (fileList.length === 0) {
        const error = "No files available for dragging";
        if (enableToast) toast.error(error);
        onError?.(error);
        return false;
      }

      if (fileList.length === 1) {
        return dragFileToDesktop(fileList[0], options);
      }

      try {
        setState((prev) => ({
          ...prev,
          isDownloading: true,
          progress: 0,
          error: null,
        }));

        const downloadPromises = fileList.map((file) =>
          downloadSSHFile(sshSessionId, file.path),
        );

        const responses = await Promise.all(downloadPromises);
        setState((prev) => ({ ...prev, progress: 40 }));

        const folderName = `Files_${Date.now()}`;
        const filesData = fileList.map((file, index) => ({
          relativePath: file.name,
          content: responses[index]?.content || "",
          encoding: "base64",
        }));

        const tempResult = await window.electronAPI.createTempFolder({
          folderName,
          files: filesData,
        });

        if (!tempResult.success) {
          throw new Error(
            tempResult.error || "Failed to create temporary folder",
          );
        }

        setState((prev) => ({ ...prev, progress: 80, isDragging: true }));

        const dragResult = await window.electronAPI.startDragToDesktop({
          tempId: tempResult.tempId,
          fileName: folderName,
        });

        if (!dragResult.success) {
          throw new Error(dragResult.error || "Failed to start dragging");
        }

        setState((prev) => ({ ...prev, progress: 100 }));

        if (enableToast) {
          toast.success(`Dragging ${fileList.length} files to desktop`);
        }

        onSuccess?.();

        setTimeout(async () => {
          await window.electronAPI.cleanupTempFile(tempResult.tempId);
          setState((prev) => ({
            ...prev,
            isDragging: false,
            isDownloading: false,
            progress: 0,
          }));
        }, 15000);
        return true;
      } catch (error: any) {
        console.error("Failed to batch drag to desktop:", error);
        const errorMessage = error.message || "Batch drag failed";

        setState((prev) => ({
          ...prev,
          isDownloading: false,
          isDragging: false,
          progress: 0,
          error: errorMessage,
        }));

        if (enableToast) {
          toast.error(`Batch drag failed: ${errorMessage}`);
        }

        onError?.(errorMessage);
        return false;
      }
    },
    [sshSessionId, sshHost, dragFileToDesktop],
  );

  const dragFolderToDesktop = useCallback(
    async (folder: FileItem, options: DragToDesktopOptions = {}) => {
      const { enableToast = true, onSuccess, onError } = options;

      if (!isElectron()) {
        const error =
          "Drag to desktop feature is only available in desktop application";
        if (enableToast) toast.error(error);
        onError?.(error);
        return false;
      }

      if (folder.type !== "directory") {
        const error = "Only folder types can be dragged";
        if (enableToast) toast.error(error);
        onError?.(error);
        return false;
      }

      if (enableToast) {
        toast.info("Folder drag functionality is under development...");
      }

      return false;
    },
    [sshSessionId, sshHost],
  );

  return {
    ...state,
    isElectron: isElectron(),
    dragFileToDesktop,
    dragFilesToDesktop,
    dragFolderToDesktop,
  };
}
