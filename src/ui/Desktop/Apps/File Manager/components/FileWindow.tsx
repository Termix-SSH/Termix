import React, { useState, useEffect } from 'react';
import { DraggableWindow } from './DraggableWindow';
import { FileViewer } from './FileViewer';
import { useWindowManager } from './WindowManager';
import { downloadSSHFile, readSSHFile, writeSSHFile } from '@/ui/main-axios';
import { toast } from 'sonner';

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

interface FileWindowProps {
  windowId: string;
  file: FileItem;
  sshSessionId: string;
  initialX?: number;
  initialY?: number;
}

export function FileWindow({
  windowId,
  file,
  sshSessionId,
  initialX = 100,
  initialY = 100
}: FileWindowProps) {
  const { closeWindow, minimizeWindow, maximizeWindow, focusWindow, updateWindow, windows } = useWindowManager();

  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isEditable, setIsEditable] = useState(false);

  const currentWindow = windows.find(w => w.id === windowId);

  // 加载文件内容
  useEffect(() => {
    const loadFileContent = async () => {
      if (file.type !== 'file') return;

      try {
        setIsLoading(true);
        const response = await readSSHFile(sshSessionId, file.path);
        setContent(response.content || '');

        // 根据文件类型决定是否可编辑
        const editableExtensions = [
          'txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'cs',
          'php', 'rb', 'go', 'rs', 'html', 'css', 'scss', 'less', 'json', 'xml',
          'yaml', 'yml', 'toml', 'ini', 'conf', 'sh', 'bat', 'ps1'
        ];

        const extension = file.name.split('.').pop()?.toLowerCase();
        setIsEditable(editableExtensions.includes(extension || ''));
      } catch (error: any) {
        console.error('Failed to load file:', error);
        toast.error(`Failed to load file: ${error.message || 'Unknown error'}`);
      } finally {
        setIsLoading(false);
      }
    };

    loadFileContent();
  }, [file, sshSessionId]);

  // 保存文件
  const handleSave = async (newContent: string) => {
    try {
      setIsLoading(true);
      await writeSSHFile(sshSessionId, file.path, newContent);
      setContent(newContent);
      toast.success('File saved successfully');
    } catch (error: any) {
      console.error('Failed to save file:', error);
      toast.error(`Failed to save file: ${error.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 下载文件
  const handleDownload = async () => {
    try {
      const response = await downloadSSHFile(sshSessionId, file.path);

      if (response?.content) {
        // Convert base64 to blob and trigger download
        const byteCharacters = atob(response.content);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: response.mimeType || 'application/octet-stream' });

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = response.fileName || file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast.success('File downloaded successfully');
      }
    } catch (error: any) {
      console.error('Failed to download file:', error);
      toast.error(`Failed to download file: ${error.message || 'Unknown error'}`);
    }
  };

  // 窗口操作处理
  const handleClose = () => {
    closeWindow(windowId);
  };

  const handleMinimize = () => {
    minimizeWindow(windowId);
  };

  const handleMaximize = () => {
    maximizeWindow(windowId);
  };

  const handleFocus = () => {
    focusWindow(windowId);
  };

  if (!currentWindow) {
    return null;
  }

  return (
    <DraggableWindow
      title={file.name}
      initialX={initialX}
      initialY={initialY}
      initialWidth={800}
      initialHeight={600}
      minWidth={400}
      minHeight={300}
      onClose={handleClose}
      onMinimize={handleMinimize}
      onMaximize={handleMaximize}
      onFocus={handleFocus}
      isMaximized={currentWindow.isMaximized}
      zIndex={currentWindow.zIndex}
    >
      <FileViewer
        file={file}
        content={content}
        isLoading={isLoading}
        isEditable={isEditable}
        onSave={handleSave}
        onDownload={handleDownload}
      />
    </DraggableWindow>
  );
}