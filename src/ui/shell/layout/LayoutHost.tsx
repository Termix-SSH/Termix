import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { isElectron } from "@/lib/electron";
import { usePluginStore } from "@/plugin-host/plugin-store";
import { retryPluginFrontend, syncPlugins } from "@/plugin-host/loader";
import { chosenLayoutId, useLookState } from "@/look/look-store";
import {
  getRegisteredLayout,
  useRegisteredLayouts,
} from "@/look/layout-registry";
import { layoutStatus } from "@/look/layout-status";
import { safeLayoutInUrl } from "@/look/resolve-look";
import { useLookTheme } from "@/look/use-look-theme";
import { RepairView } from "@/look/RepairView";
import { useOptionalShellController } from "@/shell/controller/ShellControllerProvider";

/** Catches a crash while a layout draws, so the repair view can take over. */
class LayoutErrorBoundary extends Component<
  { onCrash: (error: Error) => void; children: ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: Error) {
    console.error("[layout] crashed while drawing", error);
    this.props.onCrash(error);
  }

  render() {
    return this.state.crashed ? null : this.props.children;
  }
}

/**
 * Only the chosen layout plugin runs, so the tabs the old one brought (its
 * settings screen, say) cannot draw after a switch. Close them; the home tab
 * stays, since core keeps it in every layout.
 */
function useCloseLeftoverTabs(layoutId: string, tabTypes: string[]) {
  const shell = useOptionalShellController();
  const previous = useRef<{ layoutId: string; tabTypes: string[] } | null>(
    null,
  );
  const current = { layoutId, tabTypes };
  const latest = useRef(current);
  latest.current = current;
  const shellRef = useRef(shell);
  shellRef.current = shell;

  useEffect(() => {
    const before = previous.current;
    previous.current = latest.current;
    if (!before || before.layoutId === layoutId || !shellRef.current) return;
    const kept = new Set(latest.current.tabTypes);
    for (const tab of shellRef.current.tabs.list) {
      if (
        tab.id !== "dashboard" &&
        before.tabTypes.includes(tab.type) &&
        !kept.has(tab.type)
      ) {
        void shellRef.current.tabs.close(tab.id);
      }
    }
  }, [layoutId]);
}

interface CrashState {
  layoutId: string | null;
  count: number;
  error: string | null;
}

/**
 * Draws the chosen layout, or the repair view when it cannot be drawn. A
 * crash remounts the layout once; a second hands over to the repair view.
 */
export function LayoutHost() {
  const look = useLookState();
  const store = usePluginStore();
  useRegisteredLayouts();
  const isMobile = useIsMobile();
  const [crash, setCrash] = useState<CrashState>({
    layoutId: null,
    count: 0,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  // The look store changes identity whenever the choice does.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layoutId = useMemo(() => chosenLayoutId(), [look]);
  useLookTheme(layoutId);

  const crashes = crash.layoutId === layoutId ? crash.count : 0;
  const owner = [...store.records.values()].find((record) =>
    record.summary.contributes?.layouts?.some((l) => l.id === layoutId),
  );
  useCloseLeftoverTabs(
    layoutId,
    owner?.summary.contributes?.tabs?.map((tab) => tab.id) ?? [],
  );
  const status = layoutStatus({
    layoutId,
    safeFromUrl: safeLayoutInUrl(window.location.search),
    safeFromEnv: look.response?.safeLayout === true,
    ready: look.loaded && store.settled,
    registered: getRegisteredLayout(layoutId),
    owner,
    unavailable: look.response?.unavailable.find((plugin) =>
      plugin.layouts.includes(layoutId),
    ),
    crashes,
    lastCrash: crash.layoutId === layoutId ? crash.error : null,
  });

  const retry = () => {
    setCrash({ layoutId: null, count: 0, error: null });
    setAttempt((value) => value + 1);
    if (owner) void retryPluginFrontend(owner.summary.id);
    else void syncPlugins();
  };

  if (status.kind === "loading") {
    return <div className="h-dvh w-screen bg-background" />;
  }
  if (status.kind === "repair") {
    return <RepairView status={status} onRetry={retry} />;
  }

  const { layout } = status;
  // The desktop app always gets the desktop layout.
  const Draw =
    isMobile && !isElectron() && layout.mobileComponent
      ? layout.mobileComponent
      : layout.component;
  return (
    <LayoutErrorBoundary
      key={`${layoutId}:${crashes}:${attempt}`}
      onCrash={(error) =>
        setCrash((previous) => ({
          layoutId,
          count: (previous.layoutId === layoutId ? previous.count : 0) + 1,
          error: error.message,
        }))
      }
    >
      <Draw />
    </LayoutErrorBoundary>
  );
}
