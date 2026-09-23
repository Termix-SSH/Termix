import { lazy, Suspense } from "react";
import { TerminalSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TerminalHandle, TerminalHostConfig } from "./Terminal";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTabsSafe } from "@/shell/TabContext";
import { hostToSSHHost } from "@/lib/host-to-ssh-host";
import { invokeAction } from "@/shell/action-registry";
import type { TabRenderProps } from "@/shell/tab-registry";

const CommandHistoryProvider = lazy(() =>
  import("./command-history/CommandHistoryContext").then((m) => ({
    default: m.CommandHistoryProvider,
  })),
);
export const loadTerminal = () =>
  import("./Terminal").then((m) => ({ default: m.Terminal }));
const TerminalFeature = lazy(loadTerminal);
const MobileTerminalKeyboard = lazy(() =>
  import("./MobileTerminalKeyboard").then((m) => ({
    default: m.MobileTerminalKeyboard,
  })),
);

function TabChunkFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="size-5 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground/70 animate-spin" />
    </div>
  );
}

/**
 * The SSH terminal as a tab. Core code, because the terminal's session
 * manager, split view and file-manager hooks are core until the terminal's
 * own Phase B step; the ssh-terminal plugin registers it as the "terminal"
 * tab type, so it comes and goes with that plugin.
 */
export function TerminalTabContent({
  tab,
  host,
  label,
  isVisible,
  isFocusedPane,
  shell,
}: TabRenderProps) {
  const { t } = useTranslation();
  const { previewTerminalTheme } = useTabsSafe();
  const isMobile = useIsMobile();

  if (!host) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-center">
        <TerminalSquare className="size-5 text-muted-foreground/30" />
        <span className="text-sm font-semibold text-muted-foreground/60">
          {t("terminal.noHostSelected")}
        </span>
      </div>
    );
  }

  return (
    <Suspense fallback={<TabChunkFallback />}>
      <CommandHistoryProvider>
        <div className="flex flex-col h-full w-full">
          <div className="flex-1 min-h-0">
            <TerminalFeature
              ref={tab.terminalRef as React.Ref<TerminalHandle>}
              hostConfig={
                {
                  ...hostToSSHHost(host),
                  sshPort: host.sshPort ?? host.port,
                  instanceId: tab.instanceId ?? tab.id,
                  restoredSessionId: tab.restoredSessionId ?? null,
                  joinSharedSessionId: tab.joinSharedSessionId ?? null,
                  joinShareId: tab.joinShareId ?? null,
                } as TerminalHostConfig
              }
              isVisible={isVisible}
              initialPath={tab.initialFilePath}
              title={label}
              showTitle={false}
              splitScreen={false}
              onClose={() => shell.closeTab(tab.id)}
              onTitleChange={
                host.terminalConfig?.useSSHTitle
                  ? (title) => shell.renameTab(tab.id, title)
                  : undefined
              }
              previewTheme={previewTerminalTheme}
              onOpenFileInEditor={(filePath) =>
                void invokeAction("files.openEditor", host, filePath)
              }
              onOpenFileManager={(path) =>
                void invokeAction("files.openHost", host, path)
              }
              isQuickConnect={host.id.startsWith("quick-connect-")}
              onSaveQuickConnect={
                shell.saveQuickConnect
                  ? () => shell.saveQuickConnect!(tab, host)
                  : undefined
              }
              host={host}
              onOpenTab={(type) => shell.openTab(host, type)}
              isFocusedPane={isFocusedPane}
            />
          </div>
          {isMobile && (
            <MobileTerminalKeyboard
              terminalRef={
                tab.terminalRef as React.RefObject<TerminalHandle | null>
              }
            />
          )}
        </div>
      </CommandHistoryProvider>
    </Suspense>
  );
}
