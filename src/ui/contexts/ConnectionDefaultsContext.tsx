/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getUserPreferences, saveUserPreferences } from "@/api/open-tabs-api";
import {
  parseTerminalDefaults,
  type TerminalDefaults,
} from "@/lib/connection-defaults";

interface ConnectionDefaultsContextValue {
  ready: boolean;
  terminal: TerminalDefaults;
  saveTerminalDefaults: (value: TerminalDefaults) => Promise<void>;
}

const ConnectionDefaultsContext = createContext<ConnectionDefaultsContextValue>(
  {
    ready: true,
    terminal: {},
    saveTerminalDefaults: async () => {},
  },
);

export function ConnectionDefaultsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [terminal, setTerminal] = useState<TerminalDefaults>({});

  useEffect(() => {
    let cancelled = false;
    getUserPreferences()
      .then((preferences) => {
        if (cancelled) return;
        setTerminal(parseTerminalDefaults(preferences.terminalDefaults));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveTerminalDefaults = useCallback(async (value: TerminalDefaults) => {
    await saveUserPreferences({ terminalDefaults: JSON.stringify(value) });
    setTerminal(value);
  }, []);

  const value = useMemo(
    () => ({ ready, terminal, saveTerminalDefaults }),
    [ready, terminal, saveTerminalDefaults],
  );
  return (
    <ConnectionDefaultsContext.Provider value={value}>
      {children}
    </ConnectionDefaultsContext.Provider>
  );
}

export function useConnectionDefaults(): ConnectionDefaultsContextValue {
  return useContext(ConnectionDefaultsContext);
}
