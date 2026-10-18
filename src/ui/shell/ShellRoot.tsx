import { lazy, Suspense } from "react";
import { isElectron } from "@/lib/electron";
import { ServerStatusProvider } from "@/lib/ServerStatusContext";
import { ComponentSlot } from "@/shell/ActionSlot";
import { OnboardingHost } from "@/onboarding/OnboardingHost";
import { DesktopUpdateToasts } from "@/shell/DesktopUpdateToasts";
import { getTabType } from "@/shell/tab-registry";
import { TabPortals } from "@/shell/stage/TabPortals";
import { LayoutHost } from "@/shell/layout/LayoutHost";
import {
  ShellControllerProvider,
  useShellController,
} from "@/shell/controller/ShellControllerProvider";

// Not needed for first paint.
const CommandPalette = lazy(() =>
  import("@/shell/CommandPalette").then((m) => ({
    default: m.CommandPalette,
  })),
);

/** Core's palette, opened by any layout through the shell's palette.open(). */
function ShellPalette() {
  const shell = useShellController();
  const { tabs, hosts, palette } = shell;
  if (!palette.isOpen) return null;
  return (
    <Suspense fallback={null}>
      <CommandPalette
        isOpen={palette.isOpen}
        setIsOpen={palette.setOpen}
        hosts={hosts.list}
        terminalTabs={tabs.terminalTabs}
        activeTabId={tabs.activeId}
        onOpenPanel={(view) => shell.regions.railClick(view)}
        onEditHost={hosts.edit}
        onOpenSettings={(section) =>
          tabs.openSingleton(
            "settings",
            undefined,
            undefined,
            section ? { section } : undefined,
          )
        }
        onOpenTab={(type, label, pendingEvent) => {
          if (
            [
              "dashboard",
              "host-manager",
              "user-profile",
              "admin-settings",
              "plugins",
            ].includes(type)
          ) {
            tabs.openSingleton(type, pendingEvent);
          } else if (getTabType(type)?.multiInstance) {
            tabs.openMultiInstance(type);
          } else if (getTabType(type)?.singleton) {
            // A singleton plugin tab, optionally preselecting a host.
            tabs.openSingleton(
              type,
              undefined,
              label ? hosts.list.find((h) => h.name === label) : undefined,
            );
          } else if (label) {
            const host = hosts.list.find((h) => h.name === label);
            if (host) tabs.open(host, type);
          }
        }}
      />
    </Suspense>
  );
}

/**
 * The signed-in app: the shell's state, the chosen layout, every tab's
 * content and the pieces core always owns (palette, overlays, onboarding).
 */
export function ShellRoot({
  username,
  onLogout,
}: {
  username: string;
  onLogout: (options?: { manual?: boolean }) => void;
}) {
  return (
    <ServerStatusProvider isAuthenticated={!!username}>
      <ShellControllerProvider username={username} onLogout={onLogout}>
        <LayoutHost />
        <TabPortals />
        <ComponentSlot slotId="shell.overlay" />
        <ShellPalette />
        <OnboardingHost />
        {isElectron() && <DesktopUpdateToasts />}
      </ShellControllerProvider>
    </ServerStatusProvider>
  );
}
