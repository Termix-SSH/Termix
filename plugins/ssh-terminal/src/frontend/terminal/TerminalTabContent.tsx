import { lazy, Suspense } from "react";
import { TerminalSquare } from "lucide-react";
import type { TerminalHandle, TerminalHostConfig } from "./Terminal";
import { useIsMobile, useTabsSafe } from "@termix/plugin-sdk/ui";
import {
  useTranslation,
  invokeAction,
  type TabProps,
} from "@termix/plugin-sdk/frontend";
import type { Host } from "../types";

/** The session fields the shell keeps on a terminal tab. */
interface TerminalTabRecord {
  id: string;
  instanceId?: string;
  restoredSessionId?: string | null;
  joinSharedSessionId?: string | null;
  joinShareId?: string | null;
  initialFilePath?: string;
  data?: {
    initialPath?: string;
    joinSharedSessionId?: string | null;
    joinShareId?: string | null;
  };
}

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

/** The SSH terminal as a tab. */
export function TerminalTabContent({
  tab: tabRecord,
  host: hostRecord,
  sshHost,
  label,
  isVisible,
  isFocusedPane,
  handleRef,
  shell,
}: TabProps) {
  const tab = tabRecord as unknown as TerminalTabRecord;
  const host = hostRecord as unknown as Host | undefined;
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
              ref={handleRef as React.Ref<TerminalHandle>}
              hostConfig={
                {
                  ...sshHost,
                  sshPort: host.sshPort ?? host.port,
                  instanceId: tab.instanceId ?? tab.id,
                  restoredSessionId: tab.restoredSessionId ?? null,
                  joinSharedSessionId:
                    tab.data?.joinSharedSessionId ??
                    tab.joinSharedSessionId ??
                    null,
                  joinShareId: tab.data?.joinShareId ?? tab.joinShareId ?? null,
                } as unknown as TerminalHostConfig
              }
              isVisible={isVisible}
              initialPath={tab.data?.initialPath ?? tab.initialFilePath}
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
              isQuickConnect={String(host.id).startsWith("quick-connect-")}
              onSaveQuickConnect={
                shell.saveQuickConnect
                  ? () => shell.saveQuickConnect!(tabRecord, hostRecord!)
                  : undefined
              }
              host={host}
              onOpenTab={(type) => shell.openTab(hostRecord!, type)}
              isFocusedPane={isFocusedPane}
            />
          </div>
          {isMobile && (
            <MobileTerminalKeyboard
              terminalRef={handleRef as React.RefObject<TerminalHandle | null>}
            />
          )}
        </div>
      </CommandHistoryProvider>
    </Suspense>
  );
}
