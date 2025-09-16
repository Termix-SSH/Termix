import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  File as FileIcon,
  Code,
  AlertCircle,
  Download,
  Save
} from 'lucide-react';
import { Button } from '@/components/ui/button';

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

interface FileViewerProps {
  file: FileItem;
  content?: string;
  isLoading?: boolean;
  isEditable?: boolean;
  onContentChange?: (content: string) => void;
  onSave?: (content: string) => void;
  onDownload?: () => void;
}

// 获取文件类型和图标
function getFileType(filename: string): { type: string; icon: React.ReactNode; color: string } {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
  const videoExts = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'];
  const audioExts = ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'];
  const textExts = ['txt', 'md', 'readme'];
  const codeExts = ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'cs', 'php', 'rb', 'go', 'rs', 'html', 'css', 'scss', 'less', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf'];

  if (imageExts.includes(ext)) {
    return { type: 'image', icon: <ImageIcon className="w-6 h-6" />, color: 'text-green-500' };
  } else if (videoExts.includes(ext)) {
    return { type: 'video', icon: <Film className="w-6 h-6" />, color: 'text-purple-500' };
  } else if (audioExts.includes(ext)) {
    return { type: 'audio', icon: <Music className="w-6 h-6" />, color: 'text-pink-500' };
  } else if (textExts.includes(ext)) {
    return { type: 'text', icon: <FileText className="w-6 h-6" />, color: 'text-blue-500' };
  } else if (codeExts.includes(ext)) {
    return { type: 'code', icon: <Code className="w-6 h-6" />, color: 'text-yellow-500' };
  } else {
    return { type: 'unknown', icon: <FileIcon className="w-6 h-6" />, color: 'text-gray-500' };
  }
}

// 格式化文件大小
function formatFileSize(bytes?: number): string {
  if (!bytes) return 'Unknown size';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

export function FileViewer({
  file,
  content = '',
  isLoading = false,
  isEditable = false,
  onContentChange,
  onSave,
  onDownload
}: FileViewerProps) {
  const [editedContent, setEditedContent] = useState(content);
  const [hasChanges, setHasChanges] = useState(false);

  const fileTypeInfo = getFileType(file.name);

  // 同步外部内容更改
  useEffect(() => {
    setEditedContent(content);
    setHasChanges(false);
  }, [content]);

  // 处理内容更改
  const handleContentChange = (newContent: string) => {
    setEditedContent(newContent);
    setHasChanges(newContent !== content);
    onContentChange?.(newContent);
  };

  // 保存文件
  const handleSave = () => {
    onSave?.(editedContent);
    setHasChanges(false);
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-sm text-gray-600">Loading file...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* 文件信息头部 */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg bg-gray-100", fileTypeInfo.color)}>
              {fileTypeInfo.icon}
            </div>
            <div>
              <h3 className="font-medium text-gray-900">{file.name}</h3>
              <div className="flex items-center gap-4 text-sm text-gray-500">
                <span>{formatFileSize(file.size)}</span>
                {file.modified && <span>Modified: {file.modified}</span>}
                <span className={cn("px-2 py-1 rounded-full text-xs", fileTypeInfo.color, "bg-gray-100")}>
                  {fileTypeInfo.type.toUpperCase()}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasChanges && (
              <Button
                variant="default"
                size="sm"
                onClick={handleSave}
                className="flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                Save
              </Button>
            )}
            {onDownload && (
              <Button
                variant="outline"
                size="sm"
                onClick={onDownload}
                className="flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 文件内容 */}
      <div className="flex-1 overflow-auto">
        {fileTypeInfo.type === 'image' && (
          <div className="p-6 flex items-center justify-center h-full">
            <img
              src={`data:image/*;base64,${content}`}
              alt={file.name}
              className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
                // Show error message instead
              }}
            />
          </div>
        )}

        {(fileTypeInfo.type === 'text' || fileTypeInfo.type === 'code') && (
          <div className="h-full">
            {isEditable ? (
              <textarea
                value={editedContent}
                onChange={(e) => handleContentChange(e.target.value)}
                className={cn(
                  "w-full h-full p-4 border-none resize-none outline-none",
                  "font-mono text-sm bg-white",
                  fileTypeInfo.type === 'code' && "bg-gray-900 text-gray-100"
                )}
                placeholder="Start typing..."
                spellCheck={false}
              />
            ) : (
              <div className={cn(
                "h-full p-4 font-mono text-sm whitespace-pre-wrap",
                fileTypeInfo.type === 'code' ? "bg-gray-900 text-gray-100" : "bg-white text-gray-900"
              )}>
                {content || 'File is empty'}
              </div>
            )}
          </div>
        )}

        {fileTypeInfo.type === 'video' && (
          <div className="p-6 flex items-center justify-center h-full">
            <video
              controls
              className="max-w-full max-h-full rounded-lg shadow-sm"
              src={`data:video/*;base64,${content}`}
            >
              Your browser does not support video playback.
            </video>
          </div>
        )}

        {fileTypeInfo.type === 'audio' && (
          <div className="p-6 flex items-center justify-center h-full">
            <div className="text-center">
              <div className={cn("w-24 h-24 mx-auto mb-4 rounded-full bg-pink-100 flex items-center justify-center", fileTypeInfo.color)}>
                <Music className="w-12 h-12" />
              </div>
              <audio
                controls
                className="w-full max-w-md"
                src={`data:audio/*;base64,${content}`}
              >
                Your browser does not support audio playback.
              </audio>
            </div>
          </div>
        )}

        {fileTypeInfo.type === 'unknown' && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-gray-500">
              <AlertCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-medium mb-2">Cannot preview this file type</h3>
              <p className="text-sm mb-4">
                This file type is not supported for preview. You can download it to view in an external application.
              </p>
              {onDownload && (
                <Button
                  variant="outline"
                  onClick={onDownload}
                  className="flex items-center gap-2 mx-auto"
                >
                  <Download className="w-4 h-4" />
                  Download File
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 底部状态栏 */}
      <div className="flex-shrink-0 bg-gray-100 border-t border-gray-200 px-4 py-2 text-xs text-gray-600">
        <div className="flex justify-between items-center">
          <span>{file.path}</span>
          {hasChanges && (
            <span className="text-orange-600 font-medium">● Unsaved changes</span>
          )}
        </div>
      </div>
    </div>
  );
}