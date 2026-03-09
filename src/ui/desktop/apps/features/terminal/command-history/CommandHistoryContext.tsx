import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";

interface CommandHistoryContextType {
  commandHistory: string[];
  isLoading: boolean;
  setCommandHistory: (history: string[]) => void;
  setIsLoading: (loading: boolean) => void;
  onSelectCommand?: (command: string) => void;
  setOnSelectCommand: (callback: (command: string) => void) => void;
  onDeleteCommand?: (command: string) => void;
  setOnDeleteCommand: (callback: (command: string) => void) => void;
  openCommandHistory: () => void;
  setOpenCommandHistory: (callback: () => void) => void;
}

const CommandHistoryContext = createContext<
  CommandHistoryContextType | undefined
>(undefined);

export function CommandHistoryProvider({ children }: { children: ReactNode }) {
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [onSelectCommand, setOnSelectCommand] = useState<
    ((command: string) => void) | undefined
  >(undefined);
  const [onDeleteCommand, setOnDeleteCommand] = useState<
    ((command: string) => void) | undefined
  >(undefined);
  const [openCommandHistory, setOpenCommandHistory] = useState<
    (() => void) | undefined
  >(() => () => {});

  const handleSetOnSelectCommand = useCallback(
    (callback: (command: string) => void) => {
      setOnSelectCommand(() => callback);
    },
    [],
  );

  const handleSetOnDeleteCommand = useCallback(
    (callback: (command: string) => void) => {
      setOnDeleteCommand(() => callback);
    },
    [],
  );

  const handleSetOpenCommandHistory = useCallback((callback: () => void) => {
    setOpenCommandHistory(() => callback);
  }, []);

  return (
    <CommandHistoryContext.Provider
      value={{
        commandHistory,
        isLoading,
        setCommandHistory,
        setIsLoading,
        onSelectCommand,
        setOnSelectCommand: handleSetOnSelectCommand,
        onDeleteCommand,
        setOnDeleteCommand: handleSetOnDeleteCommand,
        openCommandHistory: openCommandHistory || (() => {}),
        setOpenCommandHistory: handleSetOpenCommandHistory,
      }}
    >
      {children}
    </CommandHistoryContext.Provider>
  );
}

export function useCommandHistory() {
  const context = useContext(CommandHistoryContext);
  if (context === undefined) {
    throw new Error(
      "useCommandHistory must be used within a CommandHistoryProvider",
    );
  }
  return context;
}
