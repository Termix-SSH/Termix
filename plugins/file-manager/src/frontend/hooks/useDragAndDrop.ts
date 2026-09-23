import { useState, useCallback } from "react";

interface DragAndDropState {
  isDragging: boolean;
  dragCounter: number;
  draggedFiles: File[];
}

interface UseDragAndDropProps {
  onFilesDropped: (files: FileList) => void;
  onItemsDropped?: (entries: FileSystemEntry[]) => void;
  onError?: (error: string) => void;
  maxFileSize?: number;
  allowedTypes?: string[];
}

export function useDragAndDrop({
  onFilesDropped,
  onItemsDropped,
  onError,
  maxFileSize = 5120,
  allowedTypes = [],
}: UseDragAndDropProps) {
  const [state, setState] = useState<DragAndDropState>({
    isDragging: false,
    dragCounter: 0,
    draggedFiles: [],
  });

  const validateFiles = useCallback(
    (files: FileList): string | null => {
      const maxSizeBytes = maxFileSize * 1024 * 1024;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (file.size > maxSizeBytes) {
          return `File "${file.name}" is too large. Maximum size is ${maxFileSize}MB.`;
        }

        if (allowedTypes.length > 0) {
          const fileExt = file.name.split(".").pop()?.toLowerCase();
          const mimeType = file.type.toLowerCase();

          const isAllowed = allowedTypes.some((type) => {
            if (type.startsWith(".")) {
              return fileExt === type.slice(1);
            }
            if (type.includes("/")) {
              return (
                mimeType === type || mimeType.startsWith(type.replace("*", ""))
              );
            }
            switch (type) {
              case "image":
                return mimeType.startsWith("image/");
              case "video":
                return mimeType.startsWith("video/");
              case "audio":
                return mimeType.startsWith("audio/");
              case "text":
                return mimeType.startsWith("text/");
              default:
                return false;
            }
          });

          if (!isAllowed) {
            return `File type "${file.type || "unknown"}" is not allowed.`;
          }
        }
      }

      return null;
    },
    [maxFileSize, allowedTypes],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setState((prev) => ({
      ...prev,
      dragCounter: prev.dragCounter + 1,
    }));

    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setState((prev) => ({
        ...prev,
        isDragging: true,
      }));
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setState((prev) => {
      const newCounter = prev.dragCounter - 1;
      return {
        ...prev,
        dragCounter: newCounter,
        isDragging: newCounter > 0,
      };
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Read the entries before touching state. Updating state flushes a render
      // and the browser clears dataTransfer once the drop handler unwinds, so
      // anything read later comes back empty (Firefox is strictest here).
      const entries: FileSystemEntry[] = [];
      if (onItemsDropped && e.dataTransfer.items?.length > 0) {
        for (const item of Array.from(e.dataTransfer.items)) {
          const entry = item.webkitGetAsEntry?.();
          if (entry) entries.push(entry);
        }
      }
      const files = e.dataTransfer.files;

      setState({
        isDragging: false,
        dragCounter: 0,
        draggedFiles: [],
      });

      if (onItemsDropped && entries.some((entry) => entry.isDirectory)) {
        onItemsDropped(entries);
        return;
      }

      if (files.length === 0) {
        return;
      }

      const validationError = validateFiles(files);
      if (validationError) {
        onError?.(validationError);
        return;
      }

      onFilesDropped(files);
    },
    [validateFiles, onFilesDropped, onItemsDropped, onError],
  );

  const resetDragState = useCallback(() => {
    setState({
      isDragging: false,
      dragCounter: 0,
      draggedFiles: [],
    });
  }, []);

  return {
    isDragging: state.isDragging,
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop,
    },
    resetDragState,
  };
}
