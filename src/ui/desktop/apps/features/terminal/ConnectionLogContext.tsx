import React, { createContext, useContext, useState, useCallback } from "react";

export type LogEntry = {
  id: string;
  timestamp: Date;
  type: "info" | "success" | "warning" | "error";
  stage: "dns" | "tcp" | "handshake" | "auth" | "connected" | "error";
  message: string;
  details?: Record<string, any>;
};

interface ConnectionLogContextType {
  logs: LogEntry[];
  addLog: (entry: Omit<LogEntry, "id" | "timestamp">) => void;
  clearLogs: () => void;
  isExpanded: boolean;
  toggleExpanded: () => void;
  setIsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
}

const ConnectionLogContext = createContext<
  ConnectionLogContextType | undefined
>(undefined);

export function ConnectionLogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  const addLog = useCallback((entry: Omit<LogEntry, "id" | "timestamp">) => {
    const newLog: LogEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
    };
    setLogs((prev) => [...prev, newLog]);

    // Auto-expand on errors and warnings
    if (entry.type === "error" || entry.type === "warning") {
      setIsExpanded(true);
    }
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
    setIsExpanded(false);
  }, []);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <ConnectionLogContext.Provider
      value={{
        logs,
        addLog,
        clearLogs,
        isExpanded,
        toggleExpanded,
        setIsExpanded,
      }}
    >
      {children}
    </ConnectionLogContext.Provider>
  );
}

export function useConnectionLog() {
  const context = useContext(ConnectionLogContext);
  if (!context) {
    throw new Error(
      "useConnectionLog must be used within ConnectionLogProvider",
    );
  }
  return context;
}
