import { useState, useCallback } from "react";

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

export function useFileSelection() {
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);

  const selectFile = useCallback((file: FileItem, multiSelect = false) => {
    if (multiSelect) {
      setSelectedFiles((prev) => {
        const isSelected = prev.some((f) => f.path === file.path);
        if (isSelected) {
          return prev.filter((f) => f.path !== file.path);
        } else {
          return [...prev, file];
        }
      });
    } else {
      setSelectedFiles([file]);
    }
  }, []);

  const selectRange = useCallback(
    (files: FileItem[], startFile: FileItem, endFile: FileItem) => {
      const startIndex = files.findIndex((f) => f.path === startFile.path);
      const endIndex = files.findIndex((f) => f.path === endFile.path);

      if (startIndex !== -1 && endIndex !== -1) {
        const start = Math.min(startIndex, endIndex);
        const end = Math.max(startIndex, endIndex);
        const rangeFiles = files.slice(start, end + 1);
        setSelectedFiles(rangeFiles);
      }
    },
    [],
  );

  const selectAll = useCallback((files: FileItem[]) => {
    setSelectedFiles([...files]);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedFiles([]);
  }, []);

  const toggleSelection = useCallback((file: FileItem) => {
    setSelectedFiles((prev) => {
      const isSelected = prev.some((f) => f.path === file.path);
      if (isSelected) {
        return prev.filter((f) => f.path !== file.path);
      } else {
        return [...prev, file];
      }
    });
  }, []);

  const isSelected = useCallback(
    (file: FileItem) => {
      return selectedFiles.some((f) => f.path === file.path);
    },
    [selectedFiles],
  );

  const getSelectedCount = useCallback(() => {
    return selectedFiles.length;
  }, [selectedFiles]);

  const setSelection = useCallback((files: FileItem[]) => {
    setSelectedFiles(files);
  }, []);

  return {
    selectedFiles,
    selectFile,
    selectRange,
    selectAll,
    clearSelection,
    toggleSelection,
    isSelected,
    getSelectedCount,
    setSelection,
  };
}
