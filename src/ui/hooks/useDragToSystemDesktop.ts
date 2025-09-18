import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { downloadSSHFile } from "@/ui/main-axios";
import type { FileItem, SSHHost } from "../../types/index.js";

interface DragToSystemState {
  isDragging: boolean;
  isDownloading: boolean;
  progress: number;
  error: string | null;
}

interface UseDragToSystemProps {
  sshSessionId: string;
  sshHost: SSHHost;
}

interface DragToSystemOptions {
  enableToast?: boolean;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export function useDragToSystemDesktop({
  sshSessionId,
  sshHost,
}: UseDragToSystemProps) {
  const [state, setState] = useState<DragToSystemState>({
    isDragging: false,
    isDownloading: false,
    progress: 0,
    error: null,
  });

  const dragDataRef = useRef<{
    files: FileItem[];
    options: DragToSystemOptions;
  } | null>(null);

  // 目录记忆功能
  const getLastSaveDirectory = async () => {
    try {
      if ("indexedDB" in window) {
        const request = indexedDB.open("termix-dirs", 1);
        return new Promise((resolve) => {
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction(["directories"], "readonly");
            const store = transaction.objectStore("directories");
            const getRequest = store.get("lastSaveDir");
            getRequest.onsuccess = () =>
              resolve(getRequest.result?.handle || null);
          };
          request.onerror = () => resolve(null);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains("directories")) {
              db.createObjectStore("directories");
            }
          };
        });
      }
    } catch (error) {
      console.log("无法获取上次保存目录:", error);
    }
    return null;
  };

  const saveLastDirectory = async (fileHandle: any) => {
    try {
      if ("indexedDB" in window && fileHandle.getParent) {
        const dirHandle = await fileHandle.getParent();
        const request = indexedDB.open("termix-dirs", 1);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["directories"], "readwrite");
          const store = transaction.objectStore("directories");
          store.put({ handle: dirHandle }, "lastSaveDir");
        };
      }
    } catch (error) {
      console.log("无法保存目录记录:", error);
    }
  };

  // 检查File System Access API支持
  const isFileSystemAPISupported = () => {
    return "showSaveFilePicker" in window;
  };

  // 检查拖拽是否离开窗口边界
  const isDraggedOutsideWindow = (e: DragEvent) => {
    const margin = 50; // 增加容差边距
    return (
      e.clientX < margin ||
      e.clientX > window.innerWidth - margin ||
      e.clientY < margin ||
      e.clientY > window.innerHeight - margin
    );
  };

  // 创建文件blob
  const createFileBlob = async (file: FileItem): Promise<Blob> => {
    const response = await downloadSSHFile(sshSessionId, file.path);
    if (!response?.content) {
      throw new Error(`无法获取文件 ${file.name} 的内容`);
    }

    // base64转换为blob
    const binaryString = atob(response.content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return new Blob([bytes]);
  };

  // 创建ZIP文件（用于多文件下载）
  const createZipBlob = async (files: FileItem[]): Promise<Blob> => {
    // 这里需要一个轻量级的zip库，先用简单方案
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    for (const file of files) {
      const blob = await createFileBlob(file);
      zip.file(file.name, blob);
    }

    return await zip.generateAsync({ type: "blob" });
  };

  // 使用File System Access API保存文件
  const saveFileWithSystemAPI = async (blob: Blob, suggestedName: string) => {
    try {
      // 获取上次保存的目录句柄
      const lastDirHandle = await getLastSaveDirectory();

      const fileHandle = await (window as any).showSaveFilePicker({
        suggestedName,
        startIn: lastDirHandle || "desktop", // 优先使用上次目录，否则桌面
        types: [
          {
            description: "文件",
            accept: {
              "*/*": [".txt", ".jpg", ".png", ".pdf", ".zip", ".tar", ".gz"],
            },
          },
        ],
      });

      // 保存当前目录句柄以便下次使用
      await saveLastDirectory(fileHandle);

      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      return true;
    } catch (error: any) {
      if (error.name === "AbortError") {
        return false; // 用户取消
      }
      throw error;
    }
  };

  // 降级方案：传统下载
  const fallbackDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 处理拖拽到系统桌面
  const handleDragToSystem = useCallback(
    async (files: FileItem[], options: DragToSystemOptions = {}) => {
      const { enableToast = true, onSuccess, onError } = options;

      if (files.length === 0) {
        const error = "没有可拖拽的文件";
        if (enableToast) toast.error(error);
        onError?.(error);
        return false;
      }

      // 过滤出文件类型
      const fileList = files.filter((f) => f.type === "file");
      if (fileList.length === 0) {
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

        let blob: Blob;
        let fileName: string;

        if (fileList.length === 1) {
          // 单文件
          blob = await createFileBlob(fileList[0]);
          fileName = fileList[0].name;
          setState((prev) => ({ ...prev, progress: 70 }));
        } else {
          // 多文件打包成ZIP
          blob = await createZipBlob(fileList);
          fileName = `files_${Date.now()}.zip`;
          setState((prev) => ({ ...prev, progress: 70 }));
        }

        setState((prev) => ({ ...prev, progress: 90 }));

        // 优先使用File System Access API
        if (isFileSystemAPISupported()) {
          const saved = await saveFileWithSystemAPI(blob, fileName);
          if (!saved) {
            // 用户取消了
            setState((prev) => ({
              ...prev,
              isDownloading: false,
              progress: 0,
            }));
            return false;
          }
        } else {
          // 降级到传统下载
          fallbackDownload(blob, fileName);
          if (enableToast) {
            toast.info("由于浏览器限制，文件将下载到默认下载目录");
          }
        }

        setState((prev) => ({ ...prev, progress: 100 }));

        if (enableToast) {
          toast.success(
            fileList.length === 1
              ? `${fileName} 已保存到指定位置`
              : `${fileList.length} 个文件已打包保存`,
          );
        }

        onSuccess?.();

        // 重置状态
        setTimeout(() => {
          setState((prev) => ({ ...prev, isDownloading: false, progress: 0 }));
        }, 1000);

        return true;
      } catch (error: any) {
        console.error("拖拽到桌面失败:", error);
        const errorMessage = error.message || "保存失败";

        setState((prev) => ({
          ...prev,
          isDownloading: false,
          progress: 0,
          error: errorMessage,
        }));

        if (enableToast) {
          toast.error(`保存失败: ${errorMessage}`);
        }

        onError?.(errorMessage);
        return false;
      }
    },
    [sshSessionId],
  );

  // 开始拖拽（记录拖拽数据）
  const startDragToSystem = useCallback(
    (files: FileItem[], options: DragToSystemOptions = {}) => {
      dragDataRef.current = { files, options };
      setState((prev) => ({ ...prev, isDragging: true, error: null }));
    },
    [],
  );

  // 结束拖拽检测
  const handleDragEnd = useCallback(
    (e: DragEvent) => {
      if (!dragDataRef.current) return;

      const { files, options } = dragDataRef.current;

      // 检查是否拖拽到窗口外
      if (isDraggedOutsideWindow(e)) {
        // 延迟执行，避免与其他拖拽事件冲突
        setTimeout(() => {
          handleDragToSystem(files, options);
        }, 100);
      }

      // 清理拖拽状态
      dragDataRef.current = null;
      setState((prev) => ({ ...prev, isDragging: false }));
    },
    [handleDragToSystem],
  );

  // 取消拖拽
  const cancelDragToSystem = useCallback(() => {
    dragDataRef.current = null;
    setState((prev) => ({ ...prev, isDragging: false, error: null }));
  }, []);

  return {
    ...state,
    isFileSystemAPISupported: isFileSystemAPISupported(),
    startDragToSystem,
    handleDragEnd,
    cancelDragToSystem,
    handleDragToSystem, // 直接调用版本
  };
}
