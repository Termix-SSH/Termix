import { isElectron } from "@/lib/electron";
import { ServerStatusProvider } from "@/lib/ServerStatusContext";
import { ComponentSlot } from "@/shell/ActionSlot";
import { OnboardingHost } from "@/onboarding/OnboardingHost";
import { DesktopUpdateToasts } from "@/shell/DesktopUpdateToasts";
import { TabPortals } from "@/shell/stage/TabPortals";
import { LayoutHost } from "@/shell/layout/LayoutHost";
import { ShellControllerProvider } from "@/shell/controller/ShellControllerProvider";

/**
 * The signed-in app: the shell's state, the chosen layout, every tab's
 * content and the pieces core always owns (overlays, onboarding).
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
        <OnboardingHost />
        {isElectron() && <DesktopUpdateToasts />}
      </ShellControllerProvider>
    </ServerStatusProvider>
  );
}
