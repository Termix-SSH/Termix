import React from "react";
import { DraggableWindow } from "./DraggableWindow";
import { DiffViewer } from "./DiffViewer";
import { useWindowManager } from "./WindowManager";
import type { FileItem, SSHHost } from "../../../../types/index.js";

interface DiffWindowProps {
  windowId: string;
  file1: FileItem;
  file2: FileItem;
  sshSessionId: string;
  sshHost: SSHHost;
  initialX?: number;
  initialY?: number;
}

export function DiffWindow({
  windowId,
  file1,
  file2,
  sshSessionId,
  sshHost,
  initialX = 150,
  initialY = 100,
}: DiffWindowProps) {
  const { closeWindow, minimizeWindow, maximizeWindow, focusWindow, windows } =
    useWindowManager();

  const currentWindow = windows.find((w) => w.id === windowId);

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
      title={`文件对比: ${file1.name} ↔ ${file2.name}`}
      initialX={initialX}
      initialY={initialY}
      initialWidth={1200}
      initialHeight={700}
      minWidth={800}
      minHeight={500}
      onClose={handleClose}
      onMinimize={handleMinimize}
      onMaximize={handleMaximize}
      onFocus={handleFocus}
      isMaximized={currentWindow.isMaximized}
      zIndex={currentWindow.zIndex}
    >
      <DiffViewer
        file1={file1}
        file2={file2}
        sshSessionId={sshSessionId}
        sshHost={sshHost}
      />
    </DraggableWindow>
  );
}
