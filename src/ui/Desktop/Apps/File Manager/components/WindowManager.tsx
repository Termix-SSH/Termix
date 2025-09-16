import React, { useState, useCallback, useRef } from 'react';

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
  openWindow: (window: Omit<WindowInstance, 'id' | 'zIndex'>) => string;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  updateWindow: (id: string, updates: Partial<WindowInstance>) => void;
}

const WindowManagerContext = React.createContext<WindowManagerContextType | null>(null);

export function WindowManager({ children }: WindowManagerProps) {
  const [windows, setWindows] = useState<WindowInstance[]>([]);
  const nextZIndex = useRef(1000);
  const windowCounter = useRef(0);

  // 打开新窗口
  const openWindow = useCallback((windowData: Omit<WindowInstance, 'id' | 'zIndex'>) => {
    const id = `window-${++windowCounter.current}`;
    const zIndex = ++nextZIndex.current;

    // 计算偏移位置，避免窗口完全重叠
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

    setWindows(prev => [...prev, newWindow]);
    return id;
  }, [windows.length]);

  // 关闭窗口
  const closeWindow = useCallback((id: string) => {
    setWindows(prev => prev.filter(w => w.id !== id));
  }, []);

  // 最小化窗口
  const minimizeWindow = useCallback((id: string) => {
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, isMinimized: !w.isMinimized } : w
    ));
  }, []);

  // 最大化/还原窗口
  const maximizeWindow = useCallback((id: string) => {
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, isMaximized: !w.isMaximized } : w
    ));
  }, []);

  // 聚焦窗口 (置于顶层)
  const focusWindow = useCallback((id: string) => {
    setWindows(prev => {
      const targetWindow = prev.find(w => w.id === id);
      if (!targetWindow) return prev;

      const newZIndex = ++nextZIndex.current;
      return prev.map(w =>
        w.id === id ? { ...w, zIndex: newZIndex } : w
      );
    });
  }, []);

  // 更新窗口属性
  const updateWindow = useCallback((id: string, updates: Partial<WindowInstance>) => {
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, ...updates } : w
    ));
  }, []);

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
      {/* 渲染所有窗口 */}
      <div className="window-container">
        {windows.map(window => (
          <div key={window.id}>
            {typeof window.component === 'function'
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
    throw new Error('useWindowManager must be used within a WindowManager');
  }
  return context;
}