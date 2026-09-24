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
  parseRemoteDesktopDefaults,
  parseTerminalDefaults,
  type RemoteDesktopDefaults,
  type TerminalDefaults,
} from "@/lib/connection-defaults";

interface ConnectionDefaultsContextValue {
  ready: boolean;
  terminal: TerminalDefaults;
  rdp: RemoteDesktopDefaults;
  saveTerminalDefaults: (value: TerminalDefaults) => Promise<void>;
  saveRdpDefaults: (value: RemoteDesktopDefaults) => Promise<void>;
}

const ConnectionDefaultsContext = createContext<ConnectionDefaultsContextValue>(
  {
    ready: true,
    terminal: {},
    rdp: {},
    saveTerminalDefaults: async () => {},
    saveRdpDefaults: async () => {},
  },
);

export function ConnectionDefaultsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [terminal, setTerminal] = useState<TerminalDefaults>({});
  const [rdp, setRdp] = useState<RemoteDesktopDefaults>({});

  useEffect(() => {
    let cancelled = false;
    getUserPreferences()
      .then((preferences) => {
        if (cancelled) return;
        setTerminal(parseTerminalDefaults(preferences.terminalDefaults));
        setRdp(parseRemoteDesktopDefaults(preferences.rdpDefaults));
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
  const saveRdpDefaults = useCallback(async (value: RemoteDesktopDefaults) => {
    await saveUserPreferences({ rdpDefaults: JSON.stringify(value) });
    setRdp(value);
  }, []);

  const value = useMemo(
    () => ({ ready, terminal, rdp, saveTerminalDefaults, saveRdpDefaults }),
    [ready, terminal, rdp, saveTerminalDefaults, saveRdpDefaults],
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
