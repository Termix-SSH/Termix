/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils.ts";
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
  ArrowUp,
  ArrowDown,
  FileSymlink,
  Move,
  GitCompare,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FileItem } from "@/types/index";
import type { CreateIntent } from "./file-manager-types.ts";
import { formatFileSize } from "./file-manager-utils.ts";

interface DragState {
  type: "none" | "internal" | "external";
  files: FileItem[];
  draggedFiles?: FileItem[];
  target?: FileItem;
  counter: number;
  mousePosition?: { x: number; y: number };
}

interface FileManagerGridProps {
  files: FileItem[];
  selectedFiles: FileItem[];
  onFileOpen: (file: FileItem) => void;
  onSelectionChange: (files: FileItem[]) => void;
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
  onSystemDragEnd?: (e: DragEvent, files: FileItem[]) => void;
  hasClipboard?: boolean;
  createIntent?: CreateIntent | null;
  onConfirmCreate?: (name: string) => void;
  onCancelCreate?: () => void;
  onNewFile?: () => void;
  onNewFolder?: () => void;
  sortBy?: "name" | "modified" | "size";
  sortOrder?: "asc" | "desc";
  onSortChange?: (field: "name" | "modified" | "size") => void;
}

const getFileTypeColor = (file: FileItem): string => {
  if (file.type === "directory") {
    return "text-red-400";
  }

  if (file.type === "link") {
    return "text-green-400";
  }

  return "text-blue-400";
};

const getFileIcon = (file: FileItem, viewMode: "grid" | "list" = "grid") => {
  const iconClass = viewMode === "grid" ? "w-8 h-8" : "w-6 h-6";
  const colorClass = getFileTypeColor(file);

  if (file.type === "directory") {
    return <Folder className={`${iconClass} ${colorClass}`} />;
  }

  if (file.type === "link") {
    return <FileSymlink className={`${iconClass} ${colorClass}`} />;
  }

  const ext = file.name.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "txt":
    case "md":
    case "readme":
      return <FileText className={`${iconClass} ${colorClass}`} />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "bmp":
    case "svg":
      return <FileImage className={`${iconClass} ${colorClass}`} />;
    case "mp4":
    case "avi":
    case "mkv":
    case "mov":
      return <FileVideo className={`${iconClass} ${colorClass}`} />;
    case "mp3":
    case "wav":
    case "flac":
    case "ogg":
      return <FileAudio className={`${iconClass} ${colorClass}`} />;
    case "zip":
    case "tar":
    case "gz":
    case "rar":
    case "7z":
      return <Archive className={`${iconClass} ${colorClass}`} />;
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
      return <Code className={`${iconClass} ${colorClass}`} />;
    case "json":
    case "xml":
    case "yaml":
    case "yml":
    case "toml":
    case "ini":
    case "conf":
    case "config":
      return <Settings className={`${iconClass} ${colorClass}`} />;
    default:
      return <File className={`${iconClass} ${colorClass}`} />;
  }
};

export function FileManagerGrid({
  files,
  selectedFiles,
  onFileOpen,
  onSelectionChange,
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
  onSystemDragEnd,
  hasClipboard,
  createIntent,
  onConfirmCreate,
  onCancelCreate,
  onNewFile,
  onNewFolder,
  sortBy,
  sortOrder,
  onSortChange,
}: FileManagerGridProps) {
  const { t } = useTranslation();
  const gridRef = useRef<HTMLDivElement>(null);
  const [editingName, setEditingName] = useState("");

  const [dragState, setDragState] = useState<DragState>({
    type: "none",
    files: [],
    counter: 0,
  });

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

  useEffect(() => {
    if (editingFile) {
      setEditingName(editingFile.name);
      setTimeout(() => {
        editInputRef.current?.focus();
        editInputRef.current?.select();
      }, 0);
    }
  }, [editingFile]);

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

  const handleEditCancel = () => {
    setEditingName("");
    onCancelEdit?.();
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleEditConfirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleEditCancel();
    }
  };

  const handleFileDragStart = (e: React.DragEvent, file: FileItem) => {
    const filesToDrag = selectedFiles.includes(file) ? selectedFiles : [file];

    setDragState({
      type: "internal",
      files: filesToDrag,
      draggedFiles: filesToDrag,
      counter: 0,
      mousePosition: { x: e.clientX, y: e.clientY },
    });

    const dragData = {
      type: "internal_files",
      files: filesToDrag.map((f) => f.path),
    };
    e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleFileDragOver = (e: React.DragEvent, targetFile: FileItem) => {
    e.preventDefault();
    e.stopPropagation();

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

    const isDroppingOnSelf = dragState.files.some(
      (f) => f.path === targetFile.path,
    );
    if (isDroppingOnSelf) {
      setDragState({ type: "none", files: [], counter: 0 });
      return;
    }

    if (targetFile.type === "directory") {
      onFileDrop?.(dragState.files, targetFile);
    } else if (
      targetFile.type === "file" &&
      dragState.files.length === 1 &&
      dragState.files[0].type === "file"
    ) {
      onFileDiff?.(dragState.files[0], targetFile);
    }

    setDragState({ type: "none", files: [], counter: 0 });
  };

  const handleFileDragEnd = (e: React.DragEvent) => {
    const draggedFiles = dragState.draggedFiles || [];
    setDragState({ type: "none", files: [], counter: 0 });

    onSystemDragEnd?.(e.nativeEvent, draggedFiles);
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

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const isInternalDrag = dragState.type === "internal";

      if (!isInternalDrag) {
        setDragState((prev) => ({
          ...prev,
          type: "external",
          counter: prev.counter + 1,
        }));
      }
    },
    [dragState.type],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

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
    [dragState.type],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const isInternalDrag = dragState.type === "internal";

      if (isInternalDrag) {
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

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (createIntent) {
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT") {
          e.preventDefault();
        }
        return;
      }
      if (e.target === e.currentTarget && e.button === 0) {
        e.preventDefault();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const startX = e.clientX - rect.left;
        const startY = e.clientY - rect.top;

        setIsSelecting(true);
        setSelectionStart({ x: startX, y: startY });
        setSelectionRect({ x: startX, y: startY, width: 0, height: 0 });

        setJustFinishedSelecting(false);
      }
    },
    [createIntent],
  );

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

        if (gridRef.current) {
          const fileElements =
            gridRef.current.querySelectorAll("[data-file-path]");
          const selectedPaths: string[] = [];

          fileElements.forEach((element) => {
            const elementRect = element.getBoundingClientRect();
            const containerRect = gridRef.current!.getBoundingClientRect();

            const relativeElementRect = {
              left: elementRect.left - containerRect.left,
              top: elementRect.top - containerRect.top,
              right: elementRect.right - containerRect.left,
              bottom: elementRect.bottom - containerRect.top,
            };

            const selectionBox = {
              left: x,
              top: y,
              right: x + width,
              bottom: y + height,
            };

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
              }
            }
          });

          const newSelection = files.filter((file) =>
            selectedPaths.includes(file.path),
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
              setJustFinishedSelecting(true);
              setTimeout(() => {
                setJustFinishedSelecting(false);
              }, 50);
            } else {
              setJustFinishedSelecting(false);
            }
          }
        }
      }
    },
    [isSelecting, selectionStart],
  );

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isSelecting) {
        setIsSelecting(false);
        setSelectionStart(null);
        setSelectionRect(null);

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
        setDragState({ type: "none", files: [], counter: 0 });
      } else if (dragState.type === "external") {
        if (onUpload && e.dataTransfer.files.length > 0) {
          onUpload(e.dataTransfer.files);
        }
      }

      setDragState({ type: "none", files: [], counter: 0 });
    },
    [onUpload, dragState],
  );

  const handleFileClick = (file: FileItem, event: React.MouseEvent) => {
    event.stopPropagation();

    if (gridRef.current && !createIntent) {
      gridRef.current.focus();
    }

    if (event.detail === 2) {
      onFileOpen(file);
    } else {
      const multiSelect = event.ctrlKey || event.metaKey;
      const rangeSelect = event.shiftKey;

      if (rangeSelect && selectedFiles.length > 0) {
        const lastSelected = selectedFiles[selectedFiles.length - 1];
        const currentIndex = files.findIndex((f) => f.path === file.path);
        const lastIndex = files.findIndex((f) => f.path === lastSelected.path);

        if (currentIndex !== -1 && lastIndex !== -1) {
          const start = Math.min(currentIndex, lastIndex);
          const end = Math.max(currentIndex, lastIndex);
          const rangeFiles = files.slice(start, end + 1);
          onSelectionChange(rangeFiles);
        }
      } else if (multiSelect) {
        const isSelected = selectedFiles.some((f) => f.path === file.path);
        if (isSelected) {
          onSelectionChange(selectedFiles.filter((f) => f.path !== file.path));
        } else {
          onSelectionChange([...selectedFiles, file]);
        }
      } else {
        onSelectionChange([file]);
      }
    }
  };

  const handleGridClick = (event: React.MouseEvent) => {
    if (gridRef.current && !createIntent) {
      gridRef.current.focus();
    }

    if (
      event.target === event.currentTarget &&
      !isSelecting &&
      !justFinishedSelecting
    ) {
      onSelectionChange([]);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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
          if ((event.ctrlKey || event.metaKey) && onPaste && hasClipboard) {
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
        case "d":
        case "D":
          if (
            (event.ctrlKey || event.metaKey) &&
            selectedFiles.length > 0 &&
            onDownload
          ) {
            event.preventDefault();
            onDownload(selectedFiles);
          }
          break;
        case "n":
        case "N":
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            if (event.shiftKey && onNewFolder) {
              onNewFolder();
            } else if (!event.shiftKey && onNewFile) {
              onNewFile();
            }
          }
          break;
        case "u":
        case "U":
          if ((event.ctrlKey || event.metaKey) && onUpload) {
            event.preventDefault();
            const input = document.createElement("input");
            input.type = "file";
            input.multiple = true;
            input.onchange = (e) => {
              const files = (e.target as HTMLInputElement).files;
              if (files) onUpload(files);
            };
            input.click();
          }
          break;
        case "Delete":
          if (selectedFiles.length > 0 && onDelete) {
            onDelete(selectedFiles);
          }
          break;
        case "F6":
          if (selectedFiles.length === 1 && onStartEdit) {
            event.preventDefault();
            onStartEdit(selectedFiles[0]);
          }
          break;
        case "Enter":
          if (selectedFiles.length === 1) {
            event.preventDefault();
            onFileOpen(selectedFiles[0]);
          }
          break;
        case "y":
        case "Y":
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            onRefresh();
          }
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

  return (
    <div className="h-full flex flex-col bg-card overflow-hidden relative">
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
          {dragState.type === "external" && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10 pointer-events-none">
              <div className="text-center p-8 bg-card/95 border border-accent-brand/40 flex flex-col items-center gap-4">
                <Upload className="size-12 text-accent-brand" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-accent-brand">
                  {t("fileManager.dragFilesToUpload")}
                </p>
              </div>
            </div>
          )}

          {files.length === 0 && !createIntent ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-10 gap-4 select-none pointer-events-none">
              <Folder className="size-32" strokeWidth={1} />
              <span className="text-2xl font-black uppercase tracking-[0.2em]">
                {t("fileManager.emptyFolder")}
              </span>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
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

                return (
                  <div
                    key={file.path}
                    data-file-path={file.path}
                    draggable={true}
                    className={cn(
                      "group flex flex-col items-center p-3 rounded-none border-2 border-transparent transition-all cursor-pointer hover:bg-muted/50 select-none",
                      isSelected && "bg-accent-brand/10 border-accent-brand/40",
                      dragState.target?.path === file.path &&
                        "bg-accent-brand/20 border-accent-brand border-dashed",
                      dragState.files.some((f) => f.path === file.path) &&
                        "opacity-50",
                    )}
                    title={file.name}
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
                    <div className="relative mb-2 pointer-events-none">
                      {getFileIcon(file, viewMode)}
                    </div>

                    <div className="w-full flex flex-col items-center pointer-events-none">
                      {editingFile?.path === file.path ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={handleEditKeyDown}
                          onBlur={handleEditConfirm}
                          className="max-w-[120px] min-w-[60px] w-fit border border-accent-brand/60 bg-card px-2 py-1 text-xs rounded-none outline-none focus:ring-1 focus:ring-accent-brand/50 text-center pointer-events-auto"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <p
                          className="text-[11px] font-bold tracking-tight text-center truncate w-full px-1"
                          title={file.name}
                        >
                          {file.name}
                        </p>
                      )}
                      {file.type === "file" &&
                        file.size !== undefined &&
                        file.size !== null && (
                          <p className="text-[10px] font-medium text-muted-foreground/60 mt-0.5">
                            {formatFileSize(file.size)}
                          </p>
                        )}
                      {file.type === "link" && file.linkTarget && (
                        <p
                          className="text-[10px] text-accent-brand mt-0.5 truncate w-full text-center"
                          title={file.linkTarget}
                        >
                          → {file.linkTarget}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="grid grid-cols-[1fr_120px_150px_80px_90px] gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border sticky top-0 bg-card z-10">
                <div
                  className="flex items-center gap-1 cursor-pointer hover:text-accent-brand transition-colors"
                  onClick={() => onSortChange?.("name")}
                >
                  {t("fileManager.name")}
                  {sortBy === "name" &&
                    (sortOrder === "asc" ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    ))}
                </div>
                <div
                  className="flex items-center gap-1 cursor-pointer hover:text-accent-brand transition-colors"
                  onClick={() => onSortChange?.("modified")}
                >
                  {t("fileManager.modified")}
                  {sortBy === "modified" &&
                    (sortOrder === "asc" ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    ))}
                </div>
                <div className="hidden md:block" />
                <div
                  className="flex items-center gap-1 cursor-pointer hover:text-accent-brand transition-colors justify-end"
                  onClick={() => onSortChange?.("size")}
                >
                  {t("fileManager.size")}
                  {sortBy === "size" &&
                    (sortOrder === "asc" ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    ))}
                </div>
                <div className="text-right">{t("fileManager.permissions")}</div>
              </div>
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
                      "grid grid-cols-[1fr_120px_150px_80px_90px] gap-2 px-4 py-2 items-center text-xs cursor-pointer border-b border-border hover:bg-muted/50 last:border-0 rounded-none select-none transition-colors",
                      isSelected && "bg-accent-brand/10",
                      dragState.target?.path === file.path &&
                        "bg-accent-brand/20 border-accent-brand border-dashed",
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
                    <div className="flex items-center gap-3 overflow-hidden pointer-events-none">
                      <div className="shrink-0">
                        {getFileIcon(file, viewMode)}
                      </div>
                      {editingFile?.path === file.path ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={handleEditKeyDown}
                          onBlur={handleEditConfirm}
                          className="flex-1 min-w-0 max-w-[200px] border border-accent-brand/60 bg-card px-2 py-1 text-xs rounded-none outline-none focus:ring-1 focus:ring-accent-brand/50 pointer-events-auto"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="font-bold truncate tracking-tight"
                          title={file.name}
                        >
                          {file.name}
                          {file.type === "link" && file.linkTarget && (
                            <span className="text-accent-brand ml-1 normal-case font-normal">
                              → {file.linkTarget}
                            </span>
                          )}
                        </span>
                      )}
                    </div>

                    <span className="text-[10px] text-muted-foreground pointer-events-none">
                      {file.modified || "—"}
                    </span>

                    <span className="text-[10px] text-muted-foreground truncate hidden md:block pointer-events-none">
                      {file.owner
                        ? `${file.owner}${file.group ? `:${file.group}` : ""}`
                        : "—"}
                    </span>

                    <span className="text-[10px] text-right text-muted-foreground tabular-nums pointer-events-none">
                      {file.type === "file" &&
                      file.size !== undefined &&
                      file.size !== null
                        ? formatFileSize(file.size)
                        : "—"}
                    </span>

                    <span className="text-[10px] text-right font-mono text-muted-foreground/60 pointer-events-none">
                      {file.permissions || "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {isSelecting && selectionRect && (
            <div
              className="absolute border border-accent-brand bg-accent-brand/10 pointer-events-none z-50"
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

      <div className="px-4 py-1.5 bg-muted/30 border-t border-border flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">
        <span>
          {files.length} {t("fileManager.items")}
        </span>
        {selectedFiles.length > 0 && (
          <span className="text-accent-brand">
            {selectedFiles.length} {t("fileManager.selected")}
          </span>
        )}
      </div>

      {dragState.type === "internal" &&
        (dragState.files.length > 0 || dragState.draggedFiles?.length > 0) &&
        dragState.mousePosition &&
        createPortal(
          <div
            className="fixed pointer-events-none"
            style={{
              left: Math.min(
                Math.max(dragState.mousePosition.x + 40, 0),
                window.innerWidth - 300,
              ),
              top: Math.max(
                Math.min(
                  dragState.mousePosition.y - 80,
                  window.innerHeight - 100,
                ),
                0,
              ),
              zIndex: 999999,
            }}
          >
            <div className="bg-card border border-border rounded-none shadow-md px-3 py-2 flex items-center gap-2">
              {(() => {
                const files =
                  dragState.files.length > 0
                    ? dragState.files
                    : dragState.draggedFiles || [];
                return dragState.target ? (
                  dragState.target.type === "directory" ? (
                    <>
                      <Move className="size-3.5 text-accent-brand" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-foreground">
                        {t("fileManager.moveTo", {
                          name: dragState.target.name,
                        })}
                      </span>
                    </>
                  ) : (
                    <>
                      <GitCompare className="size-3.5 text-accent-brand" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-foreground">
                        {t("fileManager.diffCompareWith", {
                          name: dragState.target.name,
                        })}
                      </span>
                    </>
                  )
                ) : (
                  <>
                    <Download className="size-3.5 text-accent-brand" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-foreground">
                      {t("fileManager.dragOutsideToDownload", {
                        count: files.length,
                      })}
                    </span>
                  </>
                );
              })()}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function CreateIntentGridItem({
  intent,
  onConfirm,
  onCancel,
}: {
  intent: CreateIntent;
  onConfirm?: (name: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [inputName, setInputName] = useState(intent.currentName);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [intent.id]);

  const commit = useCallback(
    (name: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      if (name) {
        onConfirm?.(name);
      } else {
        onCancel?.();
      }
    },
    [onConfirm, onCancel],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(inputName.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (doneRef.current) return;
      doneRef.current = true;
      onCancel?.();
    }
  };

  return (
    <div
      className="group flex flex-col items-center p-3 rounded-none border-2 border-dashed border-accent-brand/60 bg-accent-brand/5"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2">
        {intent.type === "directory" ? (
          <Folder className="size-10 text-accent-brand" />
        ) : (
          <File className="size-10 text-accent-brand" />
        )}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={inputName}
        onChange={(e) => setInputName(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(inputName.trim())}
        className="w-full max-w-[120px] border border-accent-brand/60 bg-card px-2 py-1 text-xs text-center rounded-none outline-none focus:ring-1 focus:ring-accent-brand/50"
        placeholder={
          intent.type === "directory"
            ? t("fileManager.folderName")
            : t("fileManager.fileName")
        }
      />
    </div>
  );
}

function CreateIntentListItem({
  intent,
  onConfirm,
  onCancel,
}: {
  intent: CreateIntent;
  onConfirm?: (name: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [inputName, setInputName] = useState(intent.currentName);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [intent.id]);

  const commit = useCallback(
    (name: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      if (name) {
        onConfirm?.(name);
      } else {
        onCancel?.();
      }
    },
    [onConfirm, onCancel],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(inputName.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (doneRef.current) return;
      doneRef.current = true;
      onCancel?.();
    }
  };

  return (
    <div
      className="grid grid-cols-[1fr_120px_150px_80px_90px] gap-2 px-4 py-2 items-center border-b border-accent-brand/30 bg-accent-brand/5 rounded-none"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-3">
        <div className="shrink-0">
          {intent.type === "directory" ? (
            <Folder className="size-4 text-accent-brand" />
          ) : (
            <File className="size-4 text-accent-brand" />
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={inputName}
          onChange={(e) => setInputName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => commit(inputName.trim())}
          className="flex-1 min-w-0 max-w-[200px] border border-accent-brand/60 bg-card px-2 py-1 text-xs rounded-none outline-none focus:ring-1 focus:ring-accent-brand/50"
          placeholder={
            intent.type === "directory"
              ? t("fileManager.folderName")
              : t("fileManager.fileName")
          }
        />
      </div>
    </div>
  );
}
