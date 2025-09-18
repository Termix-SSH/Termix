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

  // 检查是否在Electron环境中
  const isElectron = () => {
    return (
      typeof window !== "undefined" &&
      window.electronAPI &&
      window.electronAPI.isElectron
    );
  };

  // 拖拽单个文件到桌面
  const dragFileToDesktop = useCallback(
    async (file: FileItem, options: DragToDesktopOptions = {}) => {
      const { enableToast = true, onSuccess, onError } = options;

      if (!isElectron()) {
        const error = "拖拽到桌面功能仅在桌面应用中可用";
        if (enableToast) toast.error(error);
        onError?.(error);
        return false;
      }

      if (file.type !== "file") {
        const error = "只能拖拽文件到桌面";
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

        // 下载文件内容
        const response = await downloadSSHFile(sshSessionId, file.path);

        if (!response?.content) {
          throw new Error("无法获取文件内容");
        }

        setState((prev) => ({ ...prev, progress: 50 }));

        // 创建临时文件
        const tempResult = await window.electronAPI.createTempFile({
          fileName: file.name,
          content: response.content,
          encoding: "base64",
        });

        if (!tempResult.success) {
          throw new Error(tempResult.error || "创建临时文件失败");
        }

        setState((prev) => ({ ...prev, progress: 80, isDragging: true }));

        // 开始拖拽
        const dragResult = await window.electronAPI.startDragToDesktop({
          tempId: tempResult.tempId,
          fileName: file.name,
        });

        if (!dragResult.success) {
          throw new Error(dragResult.error || "开始拖拽失败");
        }

        setState((prev) => ({ ...prev, progress: 100 }));

        if (enableToast) {
          toast.success(`正在拖拽 ${file.name} 到桌面`);
        }

        onSuccess?.();

        // 延迟清理临时文件（给用户时间完成拖拽）
        setTimeout(async () => {
          await window.electronAPI.cleanupTempFile(tempResult.tempId);
          setState((prev) => ({
            ...prev,
            isDragging: false,
            isDownloading: false,
            progress: 0,
          }));
        }, 10000); // 10秒后清理

        return true;
      } catch (error: any) {
        console.error("拖拽到桌面失败:", error);
        const errorMessage = error.message || "拖拽失败";

        setState((prev) => ({
          ...prev,
          isDownloading: false,
          isDragging: false,
          progress: 0,
          error: errorMessage,
        }));

        if (enableToast) {
          toast.error(`拖拽失败: ${errorMessage}`);
        }

        onError?.(errorMessage);
        return false;
      }
    },
    [sshSessionId, sshHost],
  );

  // 拖拽多个文件到桌面（批量操作）
  const dragFilesToDesktop = useCallback(
    async (files: FileItem[], options: DragToDesktopOptions = {}) => {
      const { enableToast = true, onSuccess, onError } = options;

      if (!isElectron()) {
        const error = "拖拽到桌面功能仅在桌面应用中可用";
        if (enableToast) toast.error(error);
        onError?.(error);
        return false;
      }

      const fileList = files.filter((f) => f.type === "file");
      if (fileList.length === 0) {
        const error = "没有可拖拽的文件";
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

        // 批量下载文件
        const downloadPromises = fileList.map((file) =>
          downloadSSHFile(sshSessionId, file.path),
        );

        const responses = await Promise.all(downloadPromises);
        setState((prev) => ({ ...prev, progress: 40 }));

        // 创建临时文件夹结构
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
          throw new Error(tempResult.error || "创建临时文件夹失败");
        }

        setState((prev) => ({ ...prev, progress: 80, isDragging: true }));

        // 开始拖拽文件夹
        const dragResult = await window.electronAPI.startDragToDesktop({
          tempId: tempResult.tempId,
          fileName: folderName,
        });

        if (!dragResult.success) {
          throw new Error(dragResult.error || "开始拖拽失败");
        }

        setState((prev) => ({ ...prev, progress: 100 }));

        if (enableToast) {
          toast.success(`正在拖拽 ${fileList.length} 个文件到桌面`);
        }

        onSuccess?.();

        // 延迟清理临时文件夹
        setTimeout(async () => {
          await window.electronAPI.cleanupTempFile(tempResult.tempId);
          setState((prev) => ({
            ...prev,
            isDragging: false,
            isDownloading: false,
            progress: 0,
          }));
        }, 15000); // 15秒后清理

        return true;
      } catch (error: any) {
        console.error("批量拖拽到桌面失败:", error);
        const errorMessage = error.message || "批量拖拽失败";

        setState((prev) => ({
          ...prev,
          isDownloading: false,
          isDragging: false,
          progress: 0,
          error: errorMessage,
        }));

        if (enableToast) {
          toast.error(`批量拖拽失败: ${errorMessage}`);
        }

        onError?.(errorMessage);
        return false;
      }
    },
    [sshSessionId, sshHost, dragFileToDesktop],
  );

  // 拖拽文件夹到桌面
  const dragFolderToDesktop = useCallback(
    async (folder: FileItem, options: DragToDesktopOptions = {}) => {
      const { enableToast = true, onSuccess, onError } = options;

      if (!isElectron()) {
        const error = "拖拽到桌面功能仅在桌面应用中可用";
        if (enableToast) toast.error(error);
        onError?.(error);
        return false;
      }

      if (folder.type !== "directory") {
        const error = "只能拖拽文件夹类型";
        if (enableToast) toast.error(error);
        onError?.(error);
        return false;
      }

      if (enableToast) {
        toast.info("文件夹拖拽功能开发中...");
      }

      // TODO: 实现文件夹递归下载和拖拽
      // 这需要额外的API来递归获取文件夹内容

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
