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
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  RefreshCw,
  ArrowUp,
  FileSymlink
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FileItem } from "../../../types/index.js";

// 格式化文件大小
function formatFileSize(bytes?: number): string {
  // 处理未定义或null的情况
  if (bytes === undefined || bytes === null) return '-';

  // 0字节的文件显示为 "0 B"
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  // 对于小于10的数值显示一位小数，大于10的显示整数
  const formattedSize = size < 10 && unitIndex > 0
    ? size.toFixed(1)
    : Math.round(size).toString();

  return `${formattedSize} ${units[unitIndex]}`;
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
  onContextMenu?: (event: React.MouseEvent, file?: FileItem) => void;
  viewMode?: 'grid' | 'list';
  onRename?: (file: FileItem, newName: string) => void;
  editingFile?: FileItem | null;
  onStartEdit?: (file: FileItem) => void;
  onCancelEdit?: () => void;
}

const getFileIcon = (file: FileItem, viewMode: 'grid' | 'list' = 'grid') => {
  const iconClass = viewMode === 'grid' ? "w-8 h-8" : "w-6 h-6";

  if (file.type === 'directory') {
    return <Folder className={`${iconClass} text-blue-400`} />;
  }

  if (file.type === 'link') {
    return <FileSymlink className={`${iconClass} text-cyan-400`} />;
  }

  const ext = file.name.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'txt':
    case 'md':
    case 'readme':
      return <FileText className={`${iconClass} text-gray-400`} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'bmp':
    case 'svg':
      return <FileImage className={`${iconClass} text-green-400`} />;
    case 'mp4':
    case 'avi':
    case 'mkv':
    case 'mov':
      return <FileVideo className={`${iconClass} text-purple-400`} />;
    case 'mp3':
    case 'wav':
    case 'flac':
    case 'ogg':
      return <FileAudio className={`${iconClass} text-pink-400`} />;
    case 'zip':
    case 'tar':
    case 'gz':
    case 'rar':
    case '7z':
      return <Archive className={`${iconClass} text-orange-400`} />;
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx':
    case 'py':
    case 'java':
    case 'cpp':
    case 'c':
    case 'cs':
    case 'php':
    case 'rb':
    case 'go':
    case 'rs':
      return <Code className={`${iconClass} text-yellow-400`} />;
    case 'json':
    case 'xml':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'ini':
    case 'conf':
    case 'config':
      return <Settings className={`${iconClass} text-cyan-400`} />;
    default:
      return <File className={`${iconClass} text-gray-400`} />;
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
  onContextMenu,
  viewMode = 'grid',
  onRename,
  editingFile,
  onStartEdit,
  onCancelEdit
}: FileManagerGridProps) {
  const { t } = useTranslation();
  const gridRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);
  const [editingName, setEditingName] = useState('');
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
    if (editingFile && onRename && editingName.trim() && editingName !== editingFile.name) {
      onRename(editingFile, editingName.trim());
    }
    onCancelEdit?.();
  };

  // 处理编辑取消
  const handleEditCancel = () => {
    setEditingName('');
    onCancelEdit?.();
  };

  // 处理输入框按键
  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEditConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleEditCancel();
    }
  };
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // 导航历史管理
  const [navigationHistory, setNavigationHistory] = useState<string[]>([currentPath]);
  const [historyIndex, setHistoryIndex] = useState(0);

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
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length > 0) {
      parts.pop();
      const parentPath = '/' + parts.join('/');
      onPathChange(parentPath);
    } else if (currentPath !== '/') {
      onPathChange('/');
    }
  };

  // 路径导航
  const pathParts = currentPath.split('/').filter(Boolean);
  const navigateToPath = (index: number) => {
    if (index === -1) {
      onPathChange('/');
    } else {
      const newPath = '/' + pathParts.slice(0, index + 1).join('/');
      onPathChange(newPath);
    }
  };

  // 拖放处理
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => prev + 1);
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => prev - 1);
    if (dragCounter <= 1) {
      setIsDragging(false);
    }
  }, [dragCounter]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // 滚轮事件处理，确保滚动正常工作
  const handleWheel = useCallback((e: React.WheelEvent) => {
    // 不阻止默认滚动行为，让浏览器自己处理滚动
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(false);
    setDragCounter(0);

    if (onUpload && e.dataTransfer.files.length > 0) {
      onUpload(e.dataTransfer.files);
    }
  }, [onUpload]);

  // 文件选择处理
  const handleFileClick = (file: FileItem, event: React.MouseEvent) => {
    event.stopPropagation();

    console.log('File clicked:', file.name, 'Current selected:', selectedFiles.length);

    if (event.detail === 2) {
      // 双击打开
      console.log('Double click - opening file');
      onFileOpen(file);
    } else {
      // 单击选择
      const multiSelect = event.ctrlKey || event.metaKey;
      const rangeSelect = event.shiftKey;

      console.log('Single click - multiSelect:', multiSelect, 'rangeSelect:', rangeSelect);

      if (rangeSelect && selectedFiles.length > 0) {
        // 范围选择 (Shift+点击)
        console.log('Range selection');
        const lastSelected = selectedFiles[selectedFiles.length - 1];
        const currentIndex = files.findIndex(f => f.path === file.path);
        const lastIndex = files.findIndex(f => f.path === lastSelected.path);

        if (currentIndex !== -1 && lastIndex !== -1) {
          const start = Math.min(currentIndex, lastIndex);
          const end = Math.max(currentIndex, lastIndex);
          const rangeFiles = files.slice(start, end + 1);
          console.log('Range selection result:', rangeFiles.length, 'files');
          onSelectionChange(rangeFiles);
        }
      } else if (multiSelect) {
        // 多选 (Ctrl+点击)
        console.log('Multi selection');
        const isSelected = selectedFiles.some(f => f.path === file.path);
        if (isSelected) {
          console.log('Removing from selection');
          onSelectionChange(selectedFiles.filter(f => f.path !== file.path));
        } else {
          console.log('Adding to selection');
          onSelectionChange([...selectedFiles, file]);
        }
      } else {
        // 单选
        console.log('Single selection - should select only:', file.name);
        onSelectionChange([file]);
      }
    }
  };

  // 空白区域点击取消选择
  const handleGridClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) {
      onSelectionChange([]);
    }
  };

  // 键盘支持
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!gridRef.current?.contains(document.activeElement)) return;

      switch (event.key) {
        case 'Escape':
          onSelectionChange([]);
          break;
        case 'a':
        case 'A':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            console.log('Ctrl+A pressed - selecting all files:', files.length);
            onSelectionChange([...files]);
          }
          break;
        case 'Delete':
          if (selectedFiles.length > 0) {
            // 触发删除操作
            console.log('Delete selected files:', selectedFiles);
          }
          break;
        case 'F2':
          if (selectedFiles.length === 1) {
            // 触发重命名
            console.log('Rename file:', selectedFiles[0]);
          }
          break;
        case 'F5':
          event.preventDefault();
          onRefresh();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedFiles, files, onSelectionChange, onRefresh]);

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
              historyIndex <= 0 && "opacity-50 cursor-not-allowed"
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
              historyIndex >= navigationHistory.length - 1 && "opacity-50 cursor-not-allowed"
            )}
            title={t("common.forward")}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={goUp}
            disabled={currentPath === '/'}
            className={cn(
              "p-1 rounded hover:bg-dark-hover",
              currentPath === '/' && "opacity-50 cursor-not-allowed"
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
          <button
            onClick={() => navigateToPath(-1)}
            className="hover:text-blue-400 hover:underline"
          >
            /
          </button>
          {pathParts.map((part, index) => (
            <React.Fragment key={index}>
              <span className="mx-1 text-muted-foreground">/</span>
              <button
                onClick={() => navigateToPath(index)}
                className="hover:text-blue-400 hover:underline"
              >
                {part}
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* 主文件网格 - 滚动区域 */}
      <div className="flex-1 relative overflow-hidden">
        <div
          ref={gridRef}
          className={cn(
            "absolute inset-0 p-4 overflow-y-auto thin-scrollbar",
            isDragging && "bg-blue-500/10 border-2 border-dashed border-blue-500"
          )}
          onClick={handleGridClick}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onWheel={handleWheel}
          onContextMenu={(e) => onContextMenu?.(e)}
          tabIndex={0}
        >
          {isDragging && (
            <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10 backdrop-blur-sm z-10 pointer-events-none">
              <div className="text-center">
                <Download className="w-12 h-12 mx-auto mb-2 text-blue-500" />
                <p className="text-lg font-medium text-blue-500">
                  {t("fileManager.dragFilesToUpload")}
                </p>
              </div>
            </div>
          )}

          {files.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <Folder className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>{t("fileManager.emptyFolder")}</p>
              </div>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
              {files.map((file) => {
              const isSelected = selectedFiles.some(f => f.path === file.path);

              // 详细调试路径比较
              if (selectedFiles.length > 0) {
                console.log(`\n=== File: ${file.name} ===`);
                console.log(`File path: "${file.path}"`);
                console.log(`Selected files:`, selectedFiles.map(f => `"${f.path}"`));
                console.log(`Path comparison results:`, selectedFiles.map(f =>
                  `"${f.path}" === "${file.path}" -> ${f.path === file.path}`
                ));
                console.log(`Final isSelected: ${isSelected}`);
              }

              return (
                <div
                  key={file.path}
                  className={cn(
                    "group p-3 rounded-lg cursor-pointer transition-all",
                    "hover:bg-dark-hover border-2 border-transparent",
                    isSelected && "bg-blue-500/20 border-blue-500"
                  )}
                  title={`${file.name} - Selected: ${isSelected} - SelectedCount: ${selectedFiles.length}`}
                  onClick={(e) => handleFileClick(file, e)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onContextMenu?.(e, file);
                  }}
                >
                  <div className="flex flex-col items-center text-center">
                    {/* 文件图标 */}
                    <div className="mb-2">
                      {getFileIcon(file, viewMode)}
                    </div>

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
                            "max-w-[120px] min-w-[60px] w-fit rounded-md border border-input bg-background px-2 py-1 text-xs shadow-xs transition-[color,box-shadow] outline-none",
                            "text-center text-foreground placeholder:text-muted-foreground",
                            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px]"
                          )}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <p
                          className="text-xs text-white truncate cursor-pointer hover:bg-white/10 px-1 py-0.5 rounded transition-colors duration-150 w-fit max-w-full text-center"
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
                      {file.type === 'file' && file.size !== undefined && file.size !== null && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatFileSize(file.size)}
                        </p>
                      )}
                      {file.type === 'link' && file.linkTarget && (
                        <p className="text-xs text-cyan-400 mt-1 truncate max-w-full" title={file.linkTarget}>
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
            {files.map((file) => {
              const isSelected = selectedFiles.some(f => f.path === file.path);

              return (
                <div
                  key={file.path}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded cursor-pointer transition-all",
                    "hover:bg-dark-hover",
                    isSelected && "bg-blue-500/20"
                  )}
                  onClick={(e) => handleFileClick(file, e)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onContextMenu?.(e, file);
                  }}
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
                          "flex-1 min-w-0 max-w-[200px] rounded-md border border-input bg-background px-2 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none",
                          "text-foreground placeholder:text-muted-foreground",
                          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px]"
                        )}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <p
                        className="text-sm text-white truncate cursor-pointer hover:bg-white/10 px-1 py-0.5 rounded transition-colors duration-150 w-fit max-w-full"
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
                    {file.type === 'link' && file.linkTarget && (
                      <p className="text-xs text-cyan-400 truncate" title={file.linkTarget}>
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
                    {file.type === 'file' && file.size !== undefined && file.size !== null && (
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
        </div>
      </div>

      {/* 状态栏 */}
      <div className="flex-shrink-0 border-t border-dark-border px-4 py-2 text-xs text-muted-foreground">
        <div className="flex justify-between items-center">
          <span>
            {files.length} {t("fileManager.itemCount", { count: files.length })}
          </span>
          {selectedFiles.length > 0 && (
            <span>
              {t("fileManager.selectedCount", { count: selectedFiles.length })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}