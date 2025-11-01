import React from "react";
import { DraggableWindow } from "./DraggableWindow";
import { DiffViewer } from "./DiffViewer";
import { useWindowManager } from "./WindowManager";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const { closeWindow, maximizeWindow, focusWindow, windows } =
    useWindowManager();

  const currentWindow = windows.find((w) => w.id === windowId);

  const handleClose = () => {
    closeWindow(windowId);
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
      title={t("fileManager.fileComparison", {
        file1: file1.name,
        file2: file2.name,
      })}
      initialX={initialX}
      initialY={initialY}
      initialWidth={1200}
      initialHeight={700}
      minWidth={800}
      minHeight={500}
      onClose={handleClose}
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
