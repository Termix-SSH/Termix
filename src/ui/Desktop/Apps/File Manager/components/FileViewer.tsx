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
  Save,
  RotateCcw,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  Replace
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
  savedContent?: string;
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
  savedContent = '',
  isLoading = false,
  isEditable = false,
  onContentChange,
  onSave,
  onDownload
}: FileViewerProps) {
  const [editedContent, setEditedContent] = useState(content);
  const [originalContent, setOriginalContent] = useState(savedContent || content);
  const [hasChanges, setHasChanges] = useState(false);
  const [showLargeFileWarning, setShowLargeFileWarning] = useState(false);
  const [forceShowAsText, setForceShowAsText] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [showReplacePanel, setShowReplacePanel] = useState(false);
  const [searchMatches, setSearchMatches] = useState<{ start: number; end: number }[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);

  const fileTypeInfo = getFileType(file.name);

  // 文件大小限制 (1MB for warning, 10MB for hard limit)
  const WARNING_SIZE = 1024 * 1024; // 1MB
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB

  // 检查是否应该显示为文本
  const shouldShowAsText =
    fileTypeInfo.type === 'text' ||
    fileTypeInfo.type === 'code' ||
    (fileTypeInfo.type === 'unknown' && (forceShowAsText || !file.size || file.size <= WARNING_SIZE));

  // 检查文件是否过大
  const isLargeFile = file.size && file.size > WARNING_SIZE;
  const isTooLarge = file.size && file.size > MAX_SIZE;

  // 同步外部内容更改
  useEffect(() => {
    setEditedContent(content);
    // 只有在savedContent更新时才更新originalContent
    if (savedContent) {
      setOriginalContent(savedContent);
    }
    setHasChanges(content !== (savedContent || content));

    // 如果是未知文件类型且文件较大，显示警告
    if (fileTypeInfo.type === 'unknown' && isLargeFile && !forceShowAsText) {
      setShowLargeFileWarning(true);
    } else {
      setShowLargeFileWarning(false);
    }
  }, [content, savedContent, fileTypeInfo.type, isLargeFile, forceShowAsText]);

  // 处理内容更改
  const handleContentChange = (newContent: string) => {
    setEditedContent(newContent);
    setHasChanges(newContent !== originalContent);
    onContentChange?.(newContent);
  };

  // 保存文件
  const handleSave = () => {
    onSave?.(editedContent);
    // 注意：不在这里更新originalContent，因为它会通过savedContent prop更新
  };

  // 复原文件
  const handleRevert = () => {
    setEditedContent(originalContent);
    setHasChanges(false);
    onContentChange?.(originalContent);
  };

  // 搜索匹配功能
  const findMatches = (text: string) => {
    if (!text) {
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }

    const matches: { start: number; end: number }[] = [];
    const regex = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let match;

    while ((match = regex.exec(editedContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length
      });
      // 避免无限循环
      if (match.index === regex.lastIndex) regex.lastIndex++;
    }

    setSearchMatches(matches);
    setCurrentMatchIndex(matches.length > 0 ? 0 : -1);
  };

  // 搜索导航
  const goToNextMatch = () => {
    if (searchMatches.length === 0) return;
    setCurrentMatchIndex((prev) => (prev + 1) % searchMatches.length);
  };

  const goToPrevMatch = () => {
    if (searchMatches.length === 0) return;
    setCurrentMatchIndex((prev) => (prev - 1 + searchMatches.length) % searchMatches.length);
  };

  // 替换功能
  const handleFindReplace = (findText: string, replaceWithText: string, replaceAll: boolean = false) => {
    if (!findText) return;

    let newContent = editedContent;
    if (replaceAll) {
      newContent = newContent.replace(new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replaceWithText);
    } else if (currentMatchIndex >= 0 && searchMatches[currentMatchIndex]) {
      // 替换当前匹配项
      const match = searchMatches[currentMatchIndex];
      newContent = editedContent.substring(0, match.start) +
                   replaceWithText +
                   editedContent.substring(match.end);
    }

    setEditedContent(newContent);
    setHasChanges(newContent !== originalContent);
    onContentChange?.(newContent);

    // 重新搜索以更新匹配项
    setTimeout(() => findMatches(findText), 0);
  };

  const handleFind = () => {
    setShowSearchPanel(true);
    setShowReplacePanel(false);
  };

  const handleReplace = () => {
    setShowSearchPanel(true);
    setShowReplacePanel(true);
  };

  // 渲染带高亮的文本
  const renderHighlightedText = (text: string) => {
    if (!searchText || searchMatches.length === 0) {
      return text;
    }

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    searchMatches.forEach((match, index) => {
      // 添加匹配前的文本
      if (match.start > lastIndex) {
        parts.push(text.substring(lastIndex, match.start));
      }

      // 添加高亮的匹配文本
      const isCurrentMatch = index === currentMatchIndex;
      parts.push(
        <span
          key={`match-${index}`}
          className={cn(
            "font-semibold",
            isCurrentMatch
              ? "text-orange-500"
              : "text-blue-600"
          )}
        >
          {text.substring(match.start, match.end)}
        </span>
      );

      lastIndex = match.end;
    });

    // 添加最后的文本
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts;
  };

  // 处理用户确认打开大文件
  const handleConfirmOpenAsText = () => {
    setForceShowAsText(true);
    setShowLargeFileWarning(false);
  };

  // 处理用户拒绝打开大文件
  const handleCancelOpenAsText = () => {
    setShowLargeFileWarning(false);
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
    <div className="h-full flex flex-col bg-background">
      {/* 文件信息头部 */}
      <div className="flex-shrink-0 bg-card border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg bg-muted", fileTypeInfo.color)}>
              {fileTypeInfo.icon}
            </div>
            <div>
              <h3 className="font-medium text-foreground">{file.name}</h3>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{formatFileSize(file.size)}</span>
                {file.modified && <span>Modified: {file.modified}</span>}
                <span className={cn("px-2 py-1 rounded-full text-xs", fileTypeInfo.color, "bg-muted")}>
                  {fileTypeInfo.type.toUpperCase()}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isEditable && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleFind}
                  className="flex items-center gap-2"
                >
                  <Search className="w-4 h-4" />
                  Find
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReplace}
                  className="flex items-center gap-2"
                >
                  <Replace className="w-4 h-4" />
                  Replace
                </Button>
              </>
            )}
            {hasChanges && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRevert}
                  className="flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Revert
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleSave}
                  className="flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Save
                </Button>
              </>
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

      {/* 搜索和替换面板 */}
      {showSearchPanel && (
        <div className="flex-shrink-0 bg-muted/30 border-b border-border p-3">
          <div className="flex items-center gap-2 mb-2">
            <Input
              placeholder="Find..."
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value);
                findMatches(e.target.value);
              }}
              className="w-48 h-8"
            />
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={goToPrevMatch}
                disabled={searchMatches.length === 0}
              >
                <ChevronUp className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={goToNextMatch}
                disabled={searchMatches.length === 0}
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
              <span className="text-xs text-muted-foreground min-w-[3rem]">
                {searchMatches.length > 0
                  ? `${currentMatchIndex + 1}/${searchMatches.length}`
                  : searchText ? '0/0' : ''
                }
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowSearchPanel(false);
                setSearchText('');
                setSearchMatches([]);
                setCurrentMatchIndex(-1);
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          {showReplacePanel && (
            <div className="flex items-center gap-2 mb-2">
              <Input
                placeholder="Replace with..."
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                className="w-48 h-8"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleFindReplace(searchText, replaceText, false)}
                disabled={!searchText}
              >
                Replace
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleFindReplace(searchText, replaceText, true)}
                disabled={!searchText}
              >
                Replace All
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 文件内容 */}
      <div className="flex-1 overflow-hidden">
        {/* 大文件警告对话框 */}
        {showLargeFileWarning && (
          <div className="h-full flex items-center justify-center bg-background">
            <div className="bg-card border border-orange-200 rounded-lg p-6 max-w-md mx-4 shadow-lg">
              <div className="flex items-start gap-3 mb-4">
                <AlertCircle className="w-6 h-6 text-orange-500 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-medium text-foreground mb-2">Large File Warning</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    This file is {formatFileSize(file.size)} in size, which may cause performance issues when opened as text.
                  </p>
                  {isTooLarge ? (
                    <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
                      <p className="text-sm text-red-700 font-medium">
                        File is too large (&gt; 10MB) and cannot be opened as text for security reasons.
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground mb-4">
                      Do you want to continue opening this file as text? This may slow down your browser.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                {!isTooLarge && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleConfirmOpenAsText}
                    className="flex items-center gap-2"
                  >
                    <FileText className="w-4 h-4" />
                    Open as Text
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDownload}
                  className="flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download Instead
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelOpenAsText}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* 图片预览 */}
        {fileTypeInfo.type === 'image' && !showLargeFileWarning && (
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

        {/* 文本和代码文件预览 */}
        {shouldShowAsText && !showLargeFileWarning && (
          <div className="h-full flex flex-col">
            {isEditable ? (
              <div className="relative h-full">
                {/* 高亮背景层 */}
                {searchText && (
                  <div
                    className={cn(
                      "absolute inset-0 p-4 font-mono text-sm whitespace-pre-wrap overflow-auto pointer-events-none",
                      "text-transparent z-0",
                      fileTypeInfo.type === 'code' && "bg-muted"
                    )}
                  >
                    {renderHighlightedText(editedContent)}
                  </div>
                )}
                {/* 编辑器文本区域 */}
                <textarea
                  value={editedContent}
                  onChange={(e) => handleContentChange(e.target.value)}
                  className={cn(
                    "relative w-full h-full p-4 border-none resize-none outline-none z-10",
                    "font-mono text-sm overflow-auto",
                    searchText ? "bg-transparent text-foreground" : "bg-background text-foreground",
                    fileTypeInfo.type === 'code' && !searchText && "bg-muted text-foreground"
                  )}
                  placeholder="Start typing..."
                  spellCheck={false}
                />
              </div>
            ) : (
              <div className={cn(
                "h-full p-4 font-mono text-sm whitespace-pre-wrap overflow-auto",
                fileTypeInfo.type === 'code' ? "bg-muted text-foreground" : "bg-background text-foreground"
              )}>
                {content ? renderHighlightedText(content) : 'File is empty'}
              </div>
            )}
          </div>
        )}

        {/* 视频文件预览 */}
        {fileTypeInfo.type === 'video' && !showLargeFileWarning && (
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

        {/* 音频文件预览 */}
        {fileTypeInfo.type === 'audio' && !showLargeFileWarning && (
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

        {/* 未知文件类型 - 只在不能显示为文本且没有警告时显示 */}
        {fileTypeInfo.type === 'unknown' && !shouldShowAsText && !showLargeFileWarning && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <AlertCircle className="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
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
      <div className="flex-shrink-0 bg-muted/50 border-t border-border px-4 py-2 text-xs text-muted-foreground">
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