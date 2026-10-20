import { useRef } from "react";
import { cn } from "@/lib/utils";
import { SplitView } from "@/shell/split/SplitView";
import { SplitDropOverlay } from "@/shell/split/SplitDropOverlay";
import { EmptyPanePicker } from "@/shell/split/EmptyPanePicker";
import {
  useShellController,
  useTabStageStore,
} from "@/shell/controller/ShellControllerProvider";

/**
 * The area tabs show in: the active tab, or the active split's panes, plus
 * the drop zones for dragging a tab or pane into a split. A layout places it
 * wherever its main area is. Tabs are never mounted here, only moved in, so
 * moving or remounting the stage keeps every session alive.
 */
export function TabStage({ className }: { className?: string }) {
  const shell = useShellController();
  const store = useTabStageStore();
  // The area below the tab bar, where tabs and panes are dropped to split.
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const activeSplit = shell.split.active;
  const empty = shell.split.emptyPane;

  return (
    <div
      ref={mainAreaRef}
      className={cn(
        "relative flex flex-col flex-1 min-h-0 overflow-hidden",
        className,
      )}
    >
      {activeSplit && (
        <div className="motion-workspace-layout absolute inset-0 flex flex-col">
          <SplitView
            splitTab={activeSplit}
            tabs={shell.tabs.list}
            isMobile={shell.isMobile}
            actions={shell.split.viewActions(activeSplit.id)}
            onPaneContentRef={store.setPaneEl}
            renderEmptyPane={(paneId, paneIndex) => (
              <EmptyPanePicker
                paneIndex={paneIndex}
                freeTabs={empty.freeTabs}
                hosts={shell.hosts.list}
                newTabOptions={empty.newTabOptions}
                onPickTab={(tabId) =>
                  empty.pickTab(activeSplit.id, paneId, tabId)
                }
                onPickHost={(host, pick) =>
                  empty.pickHost(activeSplit.id, paneId, host, pick)
                }
                onOpenType={(type) =>
                  empty.openType(activeSplit.id, paneId, type)
                }
                onClosePane={() => empty.closePane(activeSplit.id, paneId)}
              />
            )}
          />
        </div>
      )}
      <SplitDropOverlay containerRef={mainAreaRef} />

      {/* Normal-view container. Tab nodes are moved in here (or into pane
      elements) by TabPortals. Hidden while a split is active. */}
      <div
        ref={store.setNormalView}
        className="absolute inset-0"
        style={{ display: activeSplit ? "none" : undefined }}
      />
    </div>
  );
}
