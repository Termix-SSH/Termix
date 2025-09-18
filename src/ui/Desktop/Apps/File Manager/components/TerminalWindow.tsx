import React from "react";
import { DraggableWindow } from "./DraggableWindow";
import { Terminal } from "../../Terminal/Terminal";
import { useWindowManager } from "./WindowManager";

interface SSHHost {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  authType: "password" | "key";
  credentialId?: number;
  userId?: number;
}

interface TerminalWindowProps {
  windowId: string;
  hostConfig: SSHHost;
  initialPath?: string;
  initialX?: number;
  initialY?: number;
  executeCommand?: string;
}

export function TerminalWindow({
  windowId,
  hostConfig,
  initialPath,
  initialX = 200,
  initialY = 150,
  executeCommand,
}: TerminalWindowProps) {
  const { closeWindow, minimizeWindow, maximizeWindow, focusWindow, windows } =
    useWindowManager();

  // 获取当前窗口状态
  const currentWindow = windows.find((w) => w.id === windowId);
  if (!currentWindow) {
    console.warn(`Window with id ${windowId} not found`);
    return null;
  }

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

  const terminalTitle = executeCommand
    ? `运行 - ${hostConfig.name}:${executeCommand}`
    : initialPath
      ? `终端 - ${hostConfig.name}:${initialPath}`
      : `终端 - ${hostConfig.name}`;

  return (
    <DraggableWindow
      title={terminalTitle}
      initialX={initialX}
      initialY={initialY}
      initialWidth={800}
      initialHeight={500}
      minWidth={600}
      minHeight={400}
      onClose={handleClose}
      onMinimize={handleMinimize}
      onMaximize={handleMaximize}
      onFocus={handleFocus}
      isMaximized={currentWindow.isMaximized}
      zIndex={currentWindow.zIndex}
    >
      <Terminal
        hostConfig={hostConfig}
        isVisible={!currentWindow.isMinimized}
        initialPath={initialPath}
        executeCommand={executeCommand}
        onClose={handleClose}
      />
    </DraggableWindow>
  );
}
