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

type DefaultsKind = "terminal" | "rdp";

interface ConnectionDefaultsContextValue {
  ready: boolean;
  terminal: TerminalDefaults;
  rdp: RemoteDesktopDefaults;
  saveDefaults: (
    kind: DefaultsKind,
    value: TerminalDefaults | RemoteDesktopDefaults,
  ) => Promise<void>;
}

const ConnectionDefaultsContext = createContext<ConnectionDefaultsContextValue>(
  {
    ready: true,
    terminal: {},
    rdp: {},
    saveDefaults: async () => {},
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

  const saveDefaults = useCallback(
    async (
      kind: DefaultsKind,
      value: TerminalDefaults | RemoteDesktopDefaults,
    ) => {
      const serialized = JSON.stringify(value);
      await saveUserPreferences({ [`${kind}Defaults`]: serialized });
      if (kind === "terminal") setTerminal(value as TerminalDefaults);
      if (kind === "rdp") setRdp(value as RemoteDesktopDefaults);
    },
    [],
  );

  const value = useMemo(
    () => ({ ready, terminal, rdp, saveDefaults }),
    [ready, terminal, rdp, saveDefaults],
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
