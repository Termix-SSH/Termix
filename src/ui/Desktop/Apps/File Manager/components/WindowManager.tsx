import React, { useState, useCallback, useRef } from "react";

export interface WindowInstance {
  id: string;
  title: string;
  component: React.ReactNode | ((windowId: string) => React.ReactNode);
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
  isMinimized: boolean;
  zIndex: number;
}

interface WindowManagerProps {
  children?: React.ReactNode;
}

interface WindowManagerContextType {
  windows: WindowInstance[];
  openWindow: (window: Omit<WindowInstance, "id" | "zIndex">) => string;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  updateWindow: (id: string, updates: Partial<WindowInstance>) => void;
}

const WindowManagerContext =
  React.createContext<WindowManagerContextType | null>(null);

export function WindowManager({ children }: WindowManagerProps) {
  const [windows, setWindows] = useState<WindowInstance[]>([]);
  const nextZIndex = useRef(1000);
  const windowCounter = useRef(0);

  // Open new window
  const openWindow = useCallback(
    (windowData: Omit<WindowInstance, "id" | "zIndex">) => {
      const id = `window-${++windowCounter.current}`;
      const zIndex = ++nextZIndex.current;

      // Calculate offset position to avoid windows completely overlapping
      const offset = (windows.length % 5) * 30;
      const adjustedX = windowData.x + offset;
      const adjustedY = windowData.y + offset;

      const newWindow: WindowInstance = {
        ...windowData,
        id,
        zIndex,
        x: adjustedX,
        y: adjustedY,
      };

      setWindows((prev) => [...prev, newWindow]);
      return id;
    },
    [windows.length],
  );

  // Close window
  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  // Minimize window
  const minimizeWindow = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) =>
        w.id === id ? { ...w, isMinimized: !w.isMinimized } : w,
      ),
    );
  }, []);

  // Maximize/restore window
  const maximizeWindow = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) =>
        w.id === id ? { ...w, isMaximized: !w.isMaximized } : w,
      ),
    );
  }, []);

  // Focus window (bring to top)
  const focusWindow = useCallback((id: string) => {
    setWindows((prev) => {
      const targetWindow = prev.find((w) => w.id === id);
      if (!targetWindow) return prev;

      const newZIndex = ++nextZIndex.current;
      return prev.map((w) => (w.id === id ? { ...w, zIndex: newZIndex } : w));
    });
  }, []);

  // Update window properties
  const updateWindow = useCallback(
    (id: string, updates: Partial<WindowInstance>) => {
      setWindows((prev) =>
        prev.map((w) => (w.id === id ? { ...w, ...updates } : w)),
      );
    },
    [],
  );

  const contextValue: WindowManagerContextType = {
    windows,
    openWindow,
    closeWindow,
    minimizeWindow,
    maximizeWindow,
    focusWindow,
    updateWindow,
  };

  return (
    <WindowManagerContext.Provider value={contextValue}>
      {children}
      {/* Render all windows */}
      <div className="window-container">
        {windows.map((window) => (
          <div key={window.id}>
            {typeof window.component === "function"
              ? window.component(window.id)
              : window.component}
          </div>
        ))}
      </div>
    </WindowManagerContext.Provider>
  );
}

// Hook for using window manager
export function useWindowManager() {
  const context = React.useContext(WindowManagerContext);
  if (!context) {
    throw new Error("useWindowManager must be used within a WindowManager");
  }
  return context;
}
