import React from "react";
import { DraggableWindow } from "./DraggableWindow.tsx";
import type { TabHandle as TerminalHandle } from "@termix/plugin-sdk/frontend";
import { PluginComponent } from "@termix/plugin-sdk/ui";
import { useWindowManager } from "./WindowManager.tsx";
import { useTranslation } from "react-i18next";
import type { SSHHost } from "../host-types";
import { ExternalLink } from "lucide-react";

interface TerminalWindowProps {
  windowId: string;
  hostConfig: SSHHost;
  initialPath?: string;
  initialX?: number;
  initialY?: number;
  executeCommand?: string;
  onPromoteToTab?: (path?: string) => void;
}

export function TerminalWindow({
  windowId,
  hostConfig,
  initialPath,
  initialX = 200,
  initialY = 150,
  executeCommand,
  onPromoteToTab,
}: TerminalWindowProps) {
  const { t } = useTranslation();
  const { closeWindow, maximizeWindow, focusWindow, windows } =
    useWindowManager();
  const terminalRef = React.useRef<TerminalHandle | null>(null);
  const resizeTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    return () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, []);

  const currentWindow = windows.find((w) => w.id === windowId);
  if (!currentWindow) {
    return null;
  }

  const handleClose = () => {
    closeWindow(windowId);
  };

  const handleMaximize = () => {
    maximizeWindow(windowId);
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }
    resizeTimeoutRef.current = setTimeout(() => {
      if (terminalRef.current?.fit) {
        terminalRef.current.fit();
      }
    }, 150);
  };

  const handleFocus = () => {
    focusWindow(windowId);
  };

  const handleResize = () => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }

    resizeTimeoutRef.current = setTimeout(() => {
      if (terminalRef.current?.fit) {
        terminalRef.current.fit();
      }
    }, 100);
  };

  const handlePromoteToTab = () => {
    onPromoteToTab?.(initialPath);
    closeWindow(windowId);
  };

  const terminalTitle = executeCommand
    ? t("terminal.runTitle", { host: hostConfig.name, command: executeCommand })
    : initialPath
      ? t("terminal.terminalWithPath", {
          host: hostConfig.name,
          path: initialPath,
        })
      : t("terminal.terminalTitle", { host: hostConfig.name });

  return (
    <>
      <DraggableWindow
        title={terminalTitle}
        initialX={initialX}
        initialY={initialY}
        initialWidth={800}
        initialHeight={500}
        minWidth={600}
        minHeight={400}
        onClose={handleClose}
        onMaximize={handleMaximize}
        onFocus={handleFocus}
        onResize={handleResize}
        isMaximized={currentWindow.isMaximized}
        zIndex={currentWindow.zIndex}
        titleActions={
          onPromoteToTab ? (
            <button
              className="size-6 flex items-center justify-center rounded-none hover:bg-accent-brand/10 hover:text-accent-brand text-muted-foreground transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                handlePromoteToTab();
              }}
              title={t("common.openInNewTab")}
            >
              <ExternalLink className="size-3.5" />
            </button>
          ) : null
        }
      >
        <PluginComponent
          id="terminal.view"
          handleRef={terminalRef}
          hostConfig={hostConfig}
          isVisible={!currentWindow.isMinimized}
          initialPath={initialPath}
          executeCommand={executeCommand}
          onClose={handleClose}
        />
      </DraggableWindow>
    </>
  );
}
