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
    } catch (error) {}
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
    } catch (error) {}
  };

  const isFileSystemAPISupported = () => {
    return "showSaveFilePicker" in window;
  };

  const isDraggedOutsideWindow = (e: DragEvent) => {
    const margin = 50;
    return (
      e.clientX < margin ||
      e.clientX > window.innerWidth - margin ||
      e.clientY < margin ||
      e.clientY > window.innerHeight - margin
    );
  };

  const createFileBlob = async (file: FileItem): Promise<Blob> => {
    const response = await downloadSSHFile(sshSessionId, file.path);
    if (!response?.content) {
      throw new Error(`Unable to get content for file ${file.name}`);
    }

    const binaryString = atob(response.content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return new Blob([bytes]);
  };

  const createZipBlob = async (files: FileItem[]): Promise<Blob> => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    for (const file of files) {
      const blob = await createFileBlob(file);
      zip.file(file.name, blob);
    }

    return await zip.generateAsync({ type: "blob" });
  };

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

  const handleDragToSystem = useCallback(
    async (files: FileItem[], options: DragToSystemOptions = {}) => {
      const { enableToast = true, onSuccess, onError } = options;

      if (files.length === 0) {
        const error = "No files available for dragging";
        if (enableToast) toast.error(error);
        onError?.(error);
        return false;
      }

      const fileList = files.filter((f) => f.type === "file");
      if (fileList.length === 0) {
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

        const fileName =
          fileList.length === 1 ? fileList[0].name : `files_${Date.now()}.zip`;

        let fileHandle: any = null;
        if (isFileSystemAPISupported()) {
          try {
            fileHandle = await (window as any).showSaveFilePicker({
              suggestedName: fileName,
              startIn: "desktop",
              types: [
                {
                  description: "Files",
                  accept: {
                    "*/*": [
                      ".txt",
                      ".jpg",
                      ".png",
                      ".pdf",
                      ".zip",
                      ".tar",
                      ".gz",
                    ],
                  },
                },
              ],
            });
          } catch (error: any) {
            if (error.name === "AbortError") {
              setState((prev) => ({
                ...prev,
                isDownloading: false,
                progress: 0,
              }));
              return false;
            }
            throw error;
          }
        }

        let blob: Blob;
        if (fileList.length === 1) {
          blob = await createFileBlob(fileList[0]);
          setState((prev) => ({ ...prev, progress: 70 }));
        } else {
          blob = await createZipBlob(fileList);
          setState((prev) => ({ ...prev, progress: 70 }));
        }

        setState((prev) => ({ ...prev, progress: 90 }));

        if (fileHandle) {
          await saveLastDirectory(fileHandle);
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        } else {
          fallbackDownload(blob, fileName);
          if (enableToast) {
            toast.info(
              "Due to browser limitations, file will be downloaded to default download directory",
            );
          }
        }

        setState((prev) => ({ ...prev, progress: 100 }));

        if (enableToast) {
          toast.success(
            fileList.length === 1
              ? `${fileName} saved to specified location`
              : `${fileList.length} files packaged and saved`,
          );
        }

        onSuccess?.();

        setTimeout(() => {
          setState((prev) => ({ ...prev, isDownloading: false, progress: 0 }));
        }, 1000);

        return true;
      } catch (error: any) {
        const errorMessage = error.message || "Save failed";

        setState((prev) => ({
          ...prev,
          isDownloading: false,
          progress: 0,
          error: errorMessage,
        }));

        if (enableToast) {
          toast.error(`Save failed: ${errorMessage}`);
        }

        onError?.(errorMessage);
        return false;
      }
    },
    [sshSessionId],
  );

  const startDragToSystem = useCallback(
    (files: FileItem[], options: DragToSystemOptions = {}) => {
      dragDataRef.current = { files, options };
      setState((prev) => ({ ...prev, isDragging: true, error: null }));
    },
    [],
  );

  const handleDragEnd = useCallback(
    (e: DragEvent) => {
      if (!dragDataRef.current) return;

      const { files, options } = dragDataRef.current;

      if (isDraggedOutsideWindow(e)) {
        handleDragToSystem(files, options);
      }

      dragDataRef.current = null;
      setState((prev) => ({ ...prev, isDragging: false }));
    },
    [handleDragToSystem],
  );

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
    handleDragToSystem,
  };
}
