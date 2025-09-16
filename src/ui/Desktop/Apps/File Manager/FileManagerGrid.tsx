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
  MoreHorizontal
} from "lucide-react";
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
}

const getFileIcon = (fileName: string, isDirectory: boolean) => {
  if (isDirectory) {
    return <Folder className="w-8 h-8 text-blue-400" />;
  }

  const ext = fileName.split('.').pop()?.toLowerCase();
  const iconClass = "w-8 h-8";

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

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
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
  onContextMenu
}: FileManagerGridProps) {
  const { t } = useTranslation();
  const gridRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

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
    <div className="h-full flex flex-col bg-dark-bg">
      {/* 工具栏和路径导航 */}
      <div className="flex-shrink-0 border-b border-dark-border">
        {/* 导航按钮 */}
        <div className="flex items-center gap-1 p-2 border-b border-dark-border">
          <button
            onClick={() => window.history.back()}
            className="p-1 rounded hover:bg-dark-hover"
            title="后退"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => window.history.forward()}
            className="p-1 rounded hover:bg-dark-hover"
            title="前进"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => onPathChange(files.find(f => f.name === '..')?.path || '/')}
            className="p-1 rounded hover:bg-dark-hover"
            title="上级目录"
          >
            ↑
          </button>
          <button
            onClick={onRefresh}
            className="p-1 rounded hover:bg-dark-hover"
            title="刷新"
          >
            <Download className="w-4 h-4" />
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

      {/* 主文件网格 */}
      <div
        ref={gridRef}
        className={cn(
          "flex-1 p-4 overflow-auto",
          isDragging && "bg-blue-500/10 border-2 border-dashed border-blue-500"
        )}
        onClick={handleGridClick}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onContextMenu={(e) => onContextMenu?.(e)}
        tabIndex={0}
      >
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10 backdrop-blur-sm z-10">
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
        ) : (
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
                      {getFileIcon(file.name, file.type === 'directory')}
                    </div>

                    {/* 文件名 */}
                    <div className="w-full">
                      <p className="text-xs text-white truncate" title={file.name}>
                        {file.name}
                      </p>
                      {file.size && file.type === 'file' && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatFileSize(file.size)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
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