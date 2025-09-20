import React, { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Folder,
  File,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  Archive,
  Code,
  Settings,
  Download,
  Upload,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  RefreshCw,
  ArrowUp,
  FileSymlink,
  Move,
  GitCompare,
  Edit,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FileItem } from "../../../types/index.js";

// Linus式数据结构：创建意图与实际文件分离
interface CreateIntent {
  id: string;
  type: 'file' | 'directory';
  defaultName: string;
  currentName: string;
}

// 格式化文件大小
function formatFileSize(bytes?: number): string {
  // 处理未定义或null的情况
  if (bytes === undefined || bytes === null) return "-";

  // 0字节的文件显示为 "0 B"
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  // 对于小于10的数值显示一位小数，大于10的显示整数
  const formattedSize =
    size < 10 && unitIndex > 0 ? size.toFixed(1) : Math.round(size).toString();

  return `${formattedSize} ${units[unitIndex]}`;
}

interface DragState {
  type: "none" | "internal" | "external";
  files: FileItem[];
  target?: FileItem;
  counter: number;
  mousePosition?: { x: number; y: number };
}

interface FileManagerGridProps {
  files: FileItem[];
  selectedFiles: FileItem[];
  onFileSelect: (file: FileItem, multiSelect?: boolean) => void;
  onFileOpen: (file: FileItem) => void;
  onSelectionChange: (files: FileItem[]) => void;
  currentPath: string;
  isLoading?: boolean;
  onPathChange: (path: string) => void;
  onRefresh: () => void;
  onUpload?: (files: FileList) => void;
  onDownload?: (files: FileItem[]) => void;
  onContextMenu?: (event: React.MouseEvent, file?: FileItem) => void;
  viewMode?: "grid" | "list";
  onRename?: (file: FileItem, newName: string) => void;
  editingFile?: FileItem | null;
  onStartEdit?: (file: FileItem) => void;
  onCancelEdit?: () => void;
  onDelete?: (files: FileItem[]) => void;
  onCopy?: (files: FileItem[]) => void;
  onCut?: (files: FileItem[]) => void;
  onPaste?: () => void;
  onUndo?: () => void;
  onFileDrop?: (draggedFiles: FileItem[], targetFile: FileItem) => void;
  onFileDiff?: (file1: FileItem, file2: FileItem) => void;
  onSystemDragStart?: (files: FileItem[]) => void;
  onSystemDragEnd?: (e: DragEvent) => void;
  // Linus式创建意图props
  createIntent?: CreateIntent | null;
  onConfirmCreate?: (name: string) => void;
  onCancelCreate?: () => void;
}

const getFileIcon = (file: FileItem, viewMode: "grid" | "list" = "grid") => {
  const iconClass = viewMode === "grid" ? "w-8 h-8" : "w-6 h-6";

  if (file.type === "directory") {
    return <Folder className={`${iconClass} text-muted-foreground`} />;
  }

  if (file.type === "link") {
    return <FileSymlink className={`${iconClass} text-muted-foreground`} />;
  }

  const ext = file.name.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "txt":
    case "md":
    case "readme":
      return <FileText className={`${iconClass} text-muted-foreground`} />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "bmp":
    case "svg":
      return <FileImage className={`${iconClass} text-muted-foreground`} />;
    case "mp4":
    case "avi":
    case "mkv":
    case "mov":
      return <FileVideo className={`${iconClass} text-muted-foreground`} />;
    case "mp3":
    case "wav":
    case "flac":
    case "ogg":
      return <FileAudio className={`${iconClass} text-muted-foreground`} />;
    case "zip":
    case "tar":
    case "gz":
    case "rar":
    case "7z":
      return <Archive className={`${iconClass} text-muted-foreground`} />;
    case "js":
    case "ts":
    case "jsx":
    case "tsx":
    case "py":
    case "java":
    case "cpp":
    case "c":
    case "cs":
    case "php":
    case "rb":
    case "go":
    case "rs":
      return <Code className={`${iconClass} text-muted-foreground`} />;
    case "json":
    case "xml":
    case "yaml":
    case "yml":
    case "toml":
    case "ini":
    case "conf":
    case "config":
      return <Settings className={`${iconClass} text-muted-foreground`} />;
    default:
      return <File className={`${iconClass} text-muted-foreground`} />;
  }
};

export function FileManagerGrid({
  files,
  selectedFiles,
  onFileSelect,
  onFileOpen,
  onSelectionChange,
  currentPath,
  isLoading,
  onPathChange,
  onRefresh,
  onUpload,
  onDownload,
  onContextMenu,
  viewMode = "grid",
  onRename,
  editingFile,
  onStartEdit,
  onCancelEdit,
  onDelete,
  onCopy,
  onCut,
  onPaste,
  onUndo,
  onFileDrop,
  onFileDiff,
  onSystemDragStart,
  onSystemDragEnd,
  createIntent,
  onConfirmCreate,
  onCancelCreate,
}: FileManagerGridProps) {
  const { t } = useTranslation();
  const gridRef = useRef<HTMLDivElement>(null);
  const [editingName, setEditingName] = useState("");

  // 统一拖拽状态管理
  const [dragState, setDragState] = useState<DragState>({
    type: "none",
    files: [],
    counter: 0,
  });

  // 全局鼠标移动监听 - 用于拖拽tooltip跟随
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (dragState.type === "internal" && dragState.files.length > 0) {
        setDragState((prev) => ({
          ...prev,
          mousePosition: { x: e.clientX, y: e.clientY },
        }));
      }
    };

    if (dragState.type === "internal" && dragState.files.length > 0) {
      document.addEventListener("mousemove", handleGlobalMouseMove);
      return () =>
        document.removeEventListener("mousemove", handleGlobalMouseMove);
    }
  }, [dragState.type, dragState.files.length]);

  const editInputRef = useRef<HTMLInputElement>(null);

  // 开始编辑时设置初始名称
  useEffect(() => {
    if (editingFile) {
      setEditingName(editingFile.name);
      // 延迟聚焦以确保DOM已更新
      setTimeout(() => {
        editInputRef.current?.focus();
        editInputRef.current?.select();
      }, 0);
    }
  }, [editingFile]);

  // 处理编辑确认
  const handleEditConfirm = () => {
    if (
      editingFile &&
      onRename &&
      editingName.trim() &&
      editingName !== editingFile.name
    ) {
      onRename(editingFile, editingName.trim());
    }
    onCancelEdit?.();
  };

  // 处理编辑取消
  const handleEditCancel = () => {
    setEditingName("");
    onCancelEdit?.();
  };

  // 处理输入框按键
  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleEditConfirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleEditCancel();
    }
  };

  // 文件拖拽处理函数
  const handleFileDragStart = (e: React.DragEvent, file: FileItem) => {
    // 如果拖拽的文件已选中，则拖拽所有选中的文件
    const filesToDrag = selectedFiles.includes(file) ? selectedFiles : [file];

    setDragState({
      type: "internal",
      files: filesToDrag,
      counter: 0,
      mousePosition: { x: e.clientX, y: e.clientY },
    });

    // 设置拖拽数据，添加内部拖拽标识
    const dragData = {
      type: "internal_files",
      files: filesToDrag.map((f) => f.path),
    };
    e.dataTransfer.setData("text/plain", JSON.stringify(dragData));

    // 触发系统级拖拽开始
    onSystemDragStart?.(filesToDrag);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleFileDragOver = (e: React.DragEvent, targetFile: FileItem) => {
    e.preventDefault();
    e.stopPropagation();

    // 只有拖拽到不同文件且不是被拖拽的文件时才设置目标
    if (
      dragState.type === "internal" &&
      !dragState.files.some((f) => f.path === targetFile.path)
    ) {
      setDragState((prev) => ({ ...prev, target: targetFile }));
      e.dataTransfer.dropEffect = "move";
    }
  };

  const handleFileDragLeave = (e: React.DragEvent, targetFile: FileItem) => {
    e.preventDefault();
    e.stopPropagation();

    // 清除拖拽目标高亮
    if (dragState.target?.path === targetFile.path) {
      setDragState((prev) => ({ ...prev, target: undefined }));
    }
  };

  const handleFileDrop = (e: React.DragEvent, targetFile: FileItem) => {
    e.preventDefault();
    e.stopPropagation();

    if (dragState.type !== "internal" || dragState.files.length === 0) {
      setDragState((prev) => ({ ...prev, target: undefined }));
      return;
    }

    // 检查是否拖拽到自身
    const isDroppingOnSelf = dragState.files.some(
      (f) => f.path === targetFile.path,
    );
    if (isDroppingOnSelf) {
      console.log("Ignoring drop on self");
      setDragState({ type: "none", files: [], counter: 0 });
      return;
    }

    // 判断拖拽行为：
    // 1. 文件/文件夹 拖拽到 文件夹 = 移动操作
    // 2. 单个文件 拖拽到 单个文件 = diff对比
    // 3. 其他情况 = 无效操作

    if (targetFile.type === "directory") {
      // 移动操作
      console.log(
        "Moving files to directory:",
        dragState.files.map((f) => f.name),
        "to",
        targetFile.name,
      );
      onFileDrop?.(dragState.files, targetFile);
    } else if (
      targetFile.type === "file" &&
      dragState.files.length === 1 &&
      dragState.files[0].type === "file"
    ) {
      // diff对比操作
      console.log(
        "Comparing files:",
        dragState.files[0].name,
        "vs",
        targetFile.name,
      );
      onFileDiff?.(dragState.files[0], targetFile);
    } else {
      // 无效操作，给用户提示
      console.log("Invalid drag operation");
    }

    setDragState({ type: "none", files: [], counter: 0 });
  };

  const handleFileDragEnd = (e: React.DragEvent) => {
    setDragState({ type: "none", files: [], counter: 0 });

    // 触发系统级拖拽结束检测
    onSystemDragEnd?.(e.nativeEvent);
  };

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [selectionRect, setSelectionRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [justFinishedSelecting, setJustFinishedSelecting] = useState(false);

  // 导航历史管理
  const [navigationHistory, setNavigationHistory] = useState<string[]>([
    currentPath,
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // 路径编辑状态
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [editPathValue, setEditPathValue] = useState(currentPath);

  // 更新导航历史
  useEffect(() => {
    const lastPath = navigationHistory[historyIndex];
    if (currentPath !== lastPath) {
      const newHistory = navigationHistory.slice(0, historyIndex + 1);
      newHistory.push(currentPath);
      setNavigationHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  }, [currentPath]);

  // 导航函数
  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      onPathChange(navigationHistory[newIndex]);
    }
  };

  const goForward = () => {
    if (historyIndex < navigationHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      onPathChange(navigationHistory[newIndex]);
    }
  };

  const goUp = () => {
    const parts = currentPath.split("/").filter(Boolean);
    if (parts.length > 0) {
      parts.pop();
      const parentPath = "/" + parts.join("/");
      onPathChange(parentPath);
    } else if (currentPath !== "/") {
      onPathChange("/");
    }
  };

  // 路径导航
  const pathParts = currentPath.split("/").filter(Boolean);
  const navigateToPath = (index: number) => {
    if (index === -1) {
      onPathChange("/");
    } else {
      const newPath = "/" + pathParts.slice(0, index + 1).join("/");
      onPathChange(newPath);
    }
  };

  // 路径编辑功能
  const startEditingPath = () => {
    setEditPathValue(currentPath);
    setIsEditingPath(true);
  };

  const cancelEditingPath = () => {
    setIsEditingPath(false);
    setEditPathValue(currentPath);
  };

  const confirmEditingPath = () => {
    const trimmedPath = editPathValue.trim();
    if (trimmedPath) {
      // 确保路径以 / 开头
      const normalizedPath = trimmedPath.startsWith("/")
        ? trimmedPath
        : "/" + trimmedPath;
      onPathChange(normalizedPath);
    }
    setIsEditingPath(false);
  };

  const handlePathInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmEditingPath();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEditingPath();
    }
  };

  // 同步editPathValue与currentPath
  useEffect(() => {
    if (!isEditingPath) {
      setEditPathValue(currentPath);
    }
  }, [currentPath, isEditingPath]);

  // 拖放处理 - 区分内部文件拖拽和外部文件上传
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // 检查是否是内部文件拖拽
      const isInternalDrag = dragState.type === "internal";

      if (!isInternalDrag) {
        // 只有外部文件拖拽才显示上传提示
        setDragState((prev) => ({
          ...prev,
          type: "external",
          counter: prev.counter + 1,
        }));
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
          // External drag detected
        }
      }
    },
    [dragState.type],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // 检查是否是内部文件拖拽
      const isInternalDrag = dragState.type === "internal";

      if (!isInternalDrag && dragState.type === "external") {
        setDragState((prev) => {
          const newCounter = prev.counter - 1;
          return {
            ...prev,
            counter: newCounter,
            type: newCounter <= 0 ? "none" : "external",
          };
        });
      }
    },
    [dragState.type, dragState.counter],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // 检查是否是内部文件拖拽
      const isInternalDrag = dragState.type === "internal";

      if (isInternalDrag) {
        // 更新鼠标位置
        setDragState((prev) => ({
          ...prev,
          mousePosition: { x: e.clientX, y: e.clientY },
        }));
        e.dataTransfer.dropEffect = "move";
      } else {
        e.dataTransfer.dropEffect = "copy";
      }
    },
    [dragState.type],
  );

  // 滚轮事件处理，确保滚动正常工作
  const handleWheel = useCallback((e: React.WheelEvent) => {
    // 不阻止默认滚动行为，让浏览器自己处理滚动
    e.stopPropagation();
  }, []);

  // 框选功能实现
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // 只在空白区域开始框选，避免干扰文件点击
    if (e.target === e.currentTarget && e.button === 0) {
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const startX = e.clientX - rect.left;
      const startY = e.clientY - rect.top;

      setIsSelecting(true);
      setSelectionStart({ x: startX, y: startY });
      setSelectionRect({ x: startX, y: startY, width: 0, height: 0 });

      // 重置刚完成框选的标志，准备新的框选
      setJustFinishedSelecting(false);
    }
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isSelecting && selectionStart && gridRef.current) {
        const rect = gridRef.current.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;

        const x = Math.min(selectionStart.x, currentX);
        const y = Math.min(selectionStart.y, currentY);
        const width = Math.abs(currentX - selectionStart.x);
        const height = Math.abs(currentY - selectionStart.y);

        setSelectionRect({ x, y, width, height });

        // 检测与文件项的交集，进行实时选择
        if (gridRef.current) {
          const fileElements =
            gridRef.current.querySelectorAll("[data-file-path]");
          const selectedPaths: string[] = [];

          fileElements.forEach((element) => {
            const elementRect = element.getBoundingClientRect();
            const containerRect = gridRef.current!.getBoundingClientRect();

            // 简化坐标计算 - 直接使用相对于容器的坐标
            const relativeElementRect = {
              left: elementRect.left - containerRect.left,
              top: elementRect.top - containerRect.top,
              right: elementRect.right - containerRect.left,
              bottom: elementRect.bottom - containerRect.top,
            };

            // 选择框坐标
            const selectionBox = {
              left: x,
              top: y,
              right: x + width,
              bottom: y + height,
            };

            // 检查是否相交
            const intersects = !(
              relativeElementRect.right < selectionBox.left ||
              relativeElementRect.left > selectionBox.right ||
              relativeElementRect.bottom < selectionBox.top ||
              relativeElementRect.top > selectionBox.bottom
            );

            if (intersects) {
              const filePath = element.getAttribute("data-file-path");
              if (filePath) {
                selectedPaths.push(filePath);
                console.log("Selected file:", filePath);
              }
            }
          });

          console.log("Total selected paths:", selectedPaths.length);

          // 更新选中的文件
          const newSelection = files.filter((file) =>
            selectedPaths.includes(file.path),
          );
          console.log(
            "New selection:",
            newSelection.map((f) => f.name),
          );
          onSelectionChange(newSelection);
        }
      }
    },
    [isSelecting, selectionStart, files, onSelectionChange],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (isSelecting) {
        setIsSelecting(false);
        setSelectionStart(null);
        setSelectionRect(null);

        // 只有当移动距离足够大时才认为是框选，否则是点击
        const startPos = selectionStart;
        if (startPos) {
          const rect = gridRef.current?.getBoundingClientRect();
          if (rect) {
            const endX = e.clientX - rect.left;
            const endY = e.clientY - rect.top;
            const distance = Math.sqrt(
              Math.pow(endX - startPos.x, 2) + Math.pow(endY - startPos.y, 2),
            );

            if (distance > 5) {
              // 真正的框选，设置标志防止立即清空
              setJustFinishedSelecting(true);
              setTimeout(() => {
                setJustFinishedSelecting(false);
              }, 50);
            } else {
              // 只是点击，不设置标志，让handleGridClick正常处理
              setJustFinishedSelecting(false);
            }
          }
        }
      }
    },
    [isSelecting, selectionStart],
  );

  // 全局鼠标事件监听，确保在容器外也能结束框选
  useEffect(() => {
    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (isSelecting) {
        setIsSelecting(false);
        setSelectionStart(null);
        setSelectionRect(null);

        // 全局mouseup说明是拖拽框选，设置标志
        setJustFinishedSelecting(true);
        setTimeout(() => {
          setJustFinishedSelecting(false);
        }, 50);
      }
    };

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isSelecting && selectionStart && gridRef.current) {
        const rect = gridRef.current.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;

        const x = Math.min(selectionStart.x, currentX);
        const y = Math.min(selectionStart.y, currentY);
        const width = Math.abs(currentX - selectionStart.x);
        const height = Math.abs(currentY - selectionStart.y);

        setSelectionRect({ x, y, width, height });
      }
    };

    if (isSelecting) {
      document.addEventListener("mouseup", handleGlobalMouseUp);
      document.addEventListener("mousemove", handleGlobalMouseMove);

      return () => {
        document.removeEventListener("mouseup", handleGlobalMouseUp);
        document.removeEventListener("mousemove", handleGlobalMouseMove);
      };
    }
  }, [isSelecting, selectionStart]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (dragState.type === "internal") {
        // 内部拖拽到空白区域：触发下载
        console.log(
          "Internal drag to empty area detected, triggering download",
        );
        if (onDownload && dragState.files.length > 0) {
          onDownload(dragState.files);
        }
      } else if (dragState.type === "external") {
        // 外部拖拽：处理文件上传
        if (onUpload && e.dataTransfer.files.length > 0) {
          onUpload(e.dataTransfer.files);
        }
      }

      // 重置拖拽状态
      setDragState({ type: "none", files: [], counter: 0 });
    },
    [onUpload, onDownload, dragState],
  );

  // 文件选择处理
  const handleFileClick = (file: FileItem, event: React.MouseEvent) => {
    event.stopPropagation();

    // 确保网格获得焦点以支持键盘事件
    if (gridRef.current) {
      gridRef.current.focus();
    }

    console.log(
      "File clicked:",
      file.name,
      "Current selected:",
      selectedFiles.length,
    );

    if (event.detail === 2) {
      // 双击打开
      console.log("Double click - opening file");
      onFileOpen(file);
    } else {
      // 单击选择
      const multiSelect = event.ctrlKey || event.metaKey;
      const rangeSelect = event.shiftKey;

      console.log(
        "Single click - multiSelect:",
        multiSelect,
        "rangeSelect:",
        rangeSelect,
      );

      if (rangeSelect && selectedFiles.length > 0) {
        // 范围选择 (Shift+点击)
        console.log("Range selection");
        const lastSelected = selectedFiles[selectedFiles.length - 1];
        const currentIndex = files.findIndex((f) => f.path === file.path);
        const lastIndex = files.findIndex((f) => f.path === lastSelected.path);

        if (currentIndex !== -1 && lastIndex !== -1) {
          const start = Math.min(currentIndex, lastIndex);
          const end = Math.max(currentIndex, lastIndex);
          const rangeFiles = files.slice(start, end + 1);
          console.log("Range selection result:", rangeFiles.length, "files");
          onSelectionChange(rangeFiles);
        }
      } else if (multiSelect) {
        // 多选 (Ctrl+点击)
        console.log("Multi selection");
        const isSelected = selectedFiles.some((f) => f.path === file.path);
        if (isSelected) {
          console.log("Removing from selection");
          onSelectionChange(selectedFiles.filter((f) => f.path !== file.path));
        } else {
          console.log("Adding to selection");
          onSelectionChange([...selectedFiles, file]);
        }
      } else {
        // 单选
        console.log("Single selection - should select only:", file.name);
        onSelectionChange([file]);
      }
    }
  };

  // 空白区域点击取消选择
  const handleGridClick = (event: React.MouseEvent) => {
    // 确保网格获得焦点以支持键盘事件
    if (gridRef.current) {
      gridRef.current.focus();
    }

    // 如果刚完成框选，不要清空选择
    if (
      event.target === event.currentTarget &&
      !isSelecting &&
      !justFinishedSelecting
    ) {
      onSelectionChange([]);
    }
  };

  // 键盘支持
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 检查是否有输入框或可编辑元素获得焦点，如果有则跳过
      const activeElement = document.activeElement;
      if (
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          activeElement.contentEditable === "true")
      ) {
        return;
      }

      switch (event.key) {
        case "Escape":
          onSelectionChange([]);
          break;
        case "a":
        case "A":
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            console.log("Ctrl+A pressed - selecting all files:", files.length);
            onSelectionChange([...files]);
          }
          break;
        case "c":
        case "C":
          if (
            (event.ctrlKey || event.metaKey) &&
            selectedFiles.length > 0 &&
            onCopy
          ) {
            event.preventDefault();
            onCopy(selectedFiles);
          }
          break;
        case "x":
        case "X":
          if (
            (event.ctrlKey || event.metaKey) &&
            selectedFiles.length > 0 &&
            onCut
          ) {
            event.preventDefault();
            onCut(selectedFiles);
          }
          break;
        case "v":
        case "V":
          if ((event.ctrlKey || event.metaKey) && onPaste) {
            event.preventDefault();
            onPaste();
          }
          break;
        case "z":
        case "Z":
          if ((event.ctrlKey || event.metaKey) && onUndo) {
            event.preventDefault();
            onUndo();
          }
          break;
        case "Delete":
          if (selectedFiles.length > 0 && onDelete) {
            // 触发删除操作
            onDelete(selectedFiles);
          }
          break;
        case "F2":
          if (selectedFiles.length === 1 && onStartEdit) {
            event.preventDefault();
            onStartEdit(selectedFiles[0]);
          }
          break;
        case "F5":
          event.preventDefault();
          onRefresh();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedFiles,
    files,
    onSelectionChange,
    onRefresh,
    onDelete,
    onCopy,
    onCut,
    onPaste,
    onUndo,
  ]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-dark-bg overflow-hidden">
      {/* 工具栏和路径导航 */}
      <div className="flex-shrink-0 border-b border-dark-border">
        {/* 导航按钮 */}
        <div className="flex items-center gap-1 p-2 border-b border-dark-border">
          <button
            onClick={goBack}
            disabled={historyIndex <= 0}
            className={cn(
              "p-1 rounded hover:bg-dark-hover",
              historyIndex <= 0 && "opacity-50 cursor-not-allowed",
            )}
            title={t("common.back")}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={goForward}
            disabled={historyIndex >= navigationHistory.length - 1}
            className={cn(
              "p-1 rounded hover:bg-dark-hover",
              historyIndex >= navigationHistory.length - 1 &&
                "opacity-50 cursor-not-allowed",
            )}
            title={t("common.forward")}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={goUp}
            disabled={currentPath === "/"}
            className={cn(
              "p-1 rounded hover:bg-dark-hover",
              currentPath === "/" && "opacity-50 cursor-not-allowed",
            )}
            title={t("fileManager.parentDirectory")}
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <button
            onClick={onRefresh}
            className="p-1 rounded hover:bg-dark-hover"
            title={t("common.refresh")}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* 面包屑导航 */}
        <div className="flex items-center px-3 py-2 text-sm">
          {isEditingPath ? (
            // 编辑模式：路径输入框
            <div className="flex-1 flex items-center gap-2">
              <input
                type="text"
                value={editPathValue}
                onChange={(e) => setEditPathValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    confirmEditingPath();
                  } else if (e.key === "Escape") {
                    cancelEditingPath();
                  }
                }}
                className="flex-1 px-2 py-1 bg-dark-hover border border-dark-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="输入路径..."
                autoFocus
              />
              <button
                onClick={confirmEditingPath}
                className="px-2 py-1 bg-primary text-primary-foreground rounded text-xs hover:bg-primary/80"
              >
                确认
              </button>
              <button
                onClick={cancelEditingPath}
                className="px-2 py-1 bg-secondary text-secondary-foreground rounded text-xs hover:bg-secondary/80"
              >
                取消
              </button>
            </div>
          ) : (
            // 查看模式：面包屑导航
            <>
              <button
                onClick={() => navigateToPath(-1)}
                className="hover:text-primary hover:underline mr-1"
              >
                /
              </button>
              {pathParts.map((part, index) => (
                <React.Fragment key={index}>
                  <button
                    onClick={() => navigateToPath(index)}
                    className="hover:text-primary hover:underline"
                  >
                    {part}
                  </button>
                  {index < pathParts.length - 1 && (
                    <span className="mx-1 text-muted-foreground">/</span>
                  )}
                </React.Fragment>
              ))}
              <button
                onClick={startEditingPath}
                className="ml-2 p-1 rounded hover:bg-dark-hover opacity-60 hover:opacity-100"
                title="编辑路径"
              >
                <Edit className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 主文件网格 - 滚动区域 */}
      <div className="flex-1 relative overflow-hidden">
        <div
          ref={gridRef}
          className={cn(
            "absolute inset-0 p-4 overflow-y-auto thin-scrollbar",
            dragState.type === "external" &&
              "bg-muted/20 border-2 border-dashed border-primary",
          )}
          onClick={handleGridClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onWheel={handleWheel}
          onContextMenu={(e) => onContextMenu?.(e)}
          tabIndex={0}
        >
          {/* 拖拽提示覆盖层 */}
          {dragState.type === "external" && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10 pointer-events-none animate-in fade-in-0">
              <div className="text-center p-8 bg-background/95 border-2 border-dashed border-primary rounded-lg shadow-lg">
                <Upload className="w-16 h-16 mx-auto mb-4 text-primary" />
                <p className="text-xl font-semibold text-foreground mb-2">
                  {t("fileManager.dragFilesToUpload")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("fileManager.dragSystemFilesToUpload")}
                </p>
              </div>
            </div>
          )}

          {files.length === 0 ? (
            <div className="h-full flex items-center justify-center p-8">
              <div className="text-center">
                <Folder className="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
                <p className="text-lg font-medium text-foreground mb-4">
                  {t("fileManager.emptyFolder")}
                </p>
                <div className="space-y-3">
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                    <Upload className="w-4 h-4" />
                    {t("fileManager.dragSystemFilesToUpload")}
                  </div>
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                    <Download className="w-4 h-4" />
                    {t("fileManager.dragFilesToWindowToDownload")}
                  </div>
                </div>
              </div>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
              {/* Linus式创建意图UI - 纯粹分离 */}
              {createIntent && (
                <CreateIntentGridItem
                  intent={createIntent}
                  onConfirm={onConfirmCreate}
                  onCancel={onCancelCreate}
                />
              )}
              {files.map((file) => {
                const isSelected = selectedFiles.some(
                  (f) => f.path === file.path,
                );

                // 详细调试路径比较
                if (selectedFiles.length > 0) {
                  console.log(`\n=== File: ${file.name} ===`);
                  console.log(`File path: "${file.path}"`);
                  console.log(
                    `Selected files:`,
                    selectedFiles.map((f) => `"${f.path}"`),
                  );
                  console.log(
                    `Path comparison results:`,
                    selectedFiles.map(
                      (f) =>
                        `"${f.path}" === "${file.path}" -> ${f.path === file.path}`,
                    ),
                  );
                  console.log(`Final isSelected: ${isSelected}`);
                }

                return (
                  <div
                    key={file.path}
                    data-file-path={file.path}
                    draggable={true}
                    className={cn(
                      "group p-3 rounded-lg cursor-pointer transition-all",
                      "hover:bg-accent hover:text-accent-foreground border-2 border-transparent",
                      isSelected && "bg-primary/20 border-primary",
                      dragState.target?.path === file.path &&
                        "bg-muted border-primary border-dashed",
                      dragState.files.some((f) => f.path === file.path) &&
                        "opacity-50",
                    )}
                    title={`${file.name} - Selected: ${isSelected} - SelectedCount: ${selectedFiles.length}`}
                    onClick={(e) => handleFileClick(file, e)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onContextMenu?.(e, file);
                    }}
                    onDragStart={(e) => handleFileDragStart(e, file)}
                    onDragOver={(e) => handleFileDragOver(e, file)}
                    onDragLeave={(e) => handleFileDragLeave(e, file)}
                    onDrop={(e) => handleFileDrop(e, file)}
                    onDragEnd={handleFileDragEnd}
                  >
                    <div className="flex flex-col items-center text-center">
                      {/* 文件图标 */}
                      <div className="mb-2">{getFileIcon(file, viewMode)}</div>

                      {/* 文件名 */}
                      <div className="w-full flex flex-col items-center">
                        {editingFile?.path === file.path ? (
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={handleEditKeyDown}
                            onBlur={handleEditConfirm}
                            className={cn(
                              "max-w-[120px] min-w-[60px] w-fit rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-xs shadow-xs transition-[color,box-shadow] outline-none",
                              "text-center text-foreground placeholder:text-muted-foreground",
                              "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px]",
                            )}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <p
                            className="text-xs text-foreground truncate cursor-pointer hover:bg-accent px-1 py-0.5 rounded transition-colors duration-150 w-fit max-w-full text-center"
                            title={`${file.name} (点击重命名)`}
                            onClick={(e) => {
                              // 阻止文件选择事件
                              if (onStartEdit) {
                                e.stopPropagation();
                                onStartEdit(file);
                              }
                            }}
                          >
                            {file.name}
                          </p>
                        )}
                        {file.type === "file" &&
                          file.size !== undefined &&
                          file.size !== null && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatFileSize(file.size)}
                            </p>
                          )}
                        {file.type === "link" && file.linkTarget && (
                          <p
                            className="text-xs text-primary mt-1 truncate max-w-full"
                            title={file.linkTarget}
                          >
                            → {file.linkTarget}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* 列表视图 */
            <div className="space-y-1">
              {/* Linus式创建意图UI - 列表视图 */}
              {createIntent && (
                <CreateIntentListItem
                  intent={createIntent}
                  onConfirm={onConfirmCreate}
                  onCancel={onCancelCreate}
                />
              )}
              {files.map((file) => {
                const isSelected = selectedFiles.some(
                  (f) => f.path === file.path,
                );

                return (
                  <div
                    key={file.path}
                    data-file-path={file.path}
                    draggable={true}
                    className={cn(
                      "flex items-center gap-3 p-2 rounded cursor-pointer transition-all",
                      "hover:bg-accent hover:text-accent-foreground",
                      isSelected && "bg-primary/20",
                      dragState.target?.path === file.path &&
                        "bg-muted border-primary border-dashed",
                      dragState.files.some((f) => f.path === file.path) &&
                        "opacity-50",
                    )}
                    onClick={(e) => handleFileClick(file, e)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onContextMenu?.(e, file);
                    }}
                    onDragStart={(e) => handleFileDragStart(e, file)}
                    onDragOver={(e) => handleFileDragOver(e, file)}
                    onDragLeave={(e) => handleFileDragLeave(e, file)}
                    onDrop={(e) => handleFileDrop(e, file)}
                    onDragEnd={handleFileDragEnd}
                  >
                    {/* 文件图标 */}
                    <div className="flex-shrink-0">
                      {getFileIcon(file, viewMode)}
                    </div>

                    {/* 文件信息 */}
                    <div className="flex-1 min-w-0">
                      {editingFile?.path === file.path ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={handleEditKeyDown}
                          onBlur={handleEditConfirm}
                          className={cn(
                            "flex-1 min-w-0 max-w-[200px] rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none",
                            "text-foreground placeholder:text-muted-foreground",
                            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px]",
                          )}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <p
                          className="text-sm text-foreground truncate cursor-pointer hover:bg-accent px-1 py-0.5 rounded transition-colors duration-150 w-fit max-w-full"
                          title={`${file.name} (点击重命名)`}
                          onClick={(e) => {
                            // 阻止文件选择事件
                            if (onStartEdit) {
                              e.stopPropagation();
                              onStartEdit(file);
                            }
                          }}
                        >
                          {file.name}
                        </p>
                      )}
                      {file.type === "link" && file.linkTarget && (
                        <p
                          className="text-xs text-primary truncate"
                          title={file.linkTarget}
                        >
                          → {file.linkTarget}
                        </p>
                      )}
                      {file.modified && (
                        <p className="text-xs text-muted-foreground">
                          {file.modified}
                        </p>
                      )}
                    </div>

                    {/* 文件大小 */}
                    <div className="flex-shrink-0 text-right">
                      {file.type === "file" &&
                        file.size !== undefined &&
                        file.size !== null && (
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(file.size)}
                          </p>
                        )}
                    </div>

                    {/* 权限信息 */}
                    <div className="flex-shrink-0 text-right w-20">
                      {file.permissions && (
                        <p className="text-xs text-muted-foreground font-mono">
                          {file.permissions}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 框选矩形 */}
          {isSelecting && selectionRect && (
            <div
              className="absolute pointer-events-none border-2 border-primary bg-primary/10 z-50"
              style={{
                left: selectionRect.x,
                top: selectionRect.y,
                width: selectionRect.width,
                height: selectionRect.height,
              }}
            />
          )}
        </div>
      </div>

      {/* 状态栏 */}
      <div className="flex-shrink-0 border-t border-dark-border px-4 py-2 text-xs text-muted-foreground">
        <div className="flex justify-between items-center">
          <span>{t("fileManager.itemCount", { count: files.length })}</span>
          {selectedFiles.length > 0 && (
            <span>
              {t("fileManager.selectedCount", { count: selectedFiles.length })}
            </span>
          )}
        </div>
      </div>

      {/* 拖拽跟随tooltip */}
      {dragState.type === "internal" &&
        dragState.files.length > 0 &&
        dragState.mousePosition && (
          <div
            className="fixed z-50 pointer-events-none"
            style={{
              left: dragState.mousePosition.x + 16,
              top: dragState.mousePosition.y - 8,
            }}
          >
            <div className="bg-background border border-border rounded-md shadow-md px-3 py-2 flex items-center gap-2">
              {dragState.target ? (
                dragState.target.type === "directory" ? (
                  <>
                    <Move className="w-4 h-4 text-blue-500" />
                    <span className="text-sm font-medium text-foreground">
                      移动到 {dragState.target.name}
                    </span>
                  </>
                ) : (
                  <>
                    <GitCompare className="w-4 h-4 text-purple-500" />
                    <span className="text-sm font-medium text-foreground">
                      与 {dragState.target.name} 进行diff对比
                    </span>
                  </>
                )
              ) : (
                <>
                  <Download className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-medium text-foreground">
                    拖到窗口外下载 ({dragState.files.length} 个文件)
                  </span>
                </>
              )}
            </div>
          </div>
        )}
    </div>
  );
}

// Linus式创建意图组件：Grid视图
function CreateIntentGridItem({
  intent,
  onConfirm,
  onCancel,
}: {
  intent: CreateIntent;
  onConfirm?: (name: string) => void;
  onCancel?: () => void;
}) {
  const [inputName, setInputName] = useState(intent.currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onConfirm?.(inputName.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel?.();
    }
  };

  return (
    <div className="group p-3 rounded-lg border-2 border-dashed border-primary bg-primary/10 transition-all">
      <div className="flex flex-col items-center text-center">
        <div className="mb-2">
          {intent.type === 'directory' ? (
            <Folder className="w-8 h-8 text-primary" />
          ) : (
            <File className="w-8 h-8 text-primary" />
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={inputName}
          onChange={(e) => setInputName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => onConfirm?.(inputName.trim())}
          className="w-full max-w-[120px] rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-center text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px] outline-none"
          placeholder={intent.type === 'directory' ? 'Folder name' : 'File name'}
        />
      </div>
    </div>
  );
}

// Linus式创建意图组件：List视图
function CreateIntentListItem({
  intent,
  onConfirm,
  onCancel,
}: {
  intent: CreateIntent;
  onConfirm?: (name: string) => void;
  onCancel?: () => void;
}) {
  const [inputName, setInputName] = useState(intent.currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onConfirm?.(inputName.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel?.();
    }
  };

  return (
    <div className="flex items-center gap-3 p-2 rounded border-2 border-dashed border-primary bg-primary/10 transition-all">
      <div className="flex-shrink-0">
        {intent.type === 'directory' ? (
          <Folder className="w-6 h-6 text-primary" />
        ) : (
          <File className="w-6 h-6 text-primary" />
        )}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={inputName}
        onChange={(e) => setInputName(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => onConfirm?.(inputName.trim())}
        className="flex-1 min-w-0 max-w-[200px] rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px] outline-none"
        placeholder={intent.type === 'directory' ? 'Folder name' : 'File name'}
      />
    </div>
  );
}
