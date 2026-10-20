import { useLayoutEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { SurfaceScope } from "@/components/surface/surface-scope";
import { getTabType } from "@/shell/tab-registry";
import { renderTabContent } from "@/shell/tabUtils";
import type { Tab } from "@/types/ui-types";
import {
  useShellController,
  useTabStageStore,
} from "@/shell/controller/ShellControllerProvider";

const ownBackground = (tab: Tab) => !!getTabType(tab.type)?.ownBackground;

/**
 * Renders every open tab into its own stable node. Core mounts this outside
 * the layout, so a layout that moves, hides or crashes never remounts a tab;
 * a TabStage only decides where the nodes sit.
 */
export function TabPortals() {
  const shell = useShellController();
  const store = useTabStageStore();
  // Pane elements and the stage's container come and go with the layout.
  useSyncExternalStore(store.subscribe, store.version, store.version);
  const { list: tabs, activeId, targetTerminal } = shell.tabs;
  const { paneIdByTabId, focusedPaneId } = shell.split;

  // useLayoutEffect (not useEffect) so visibility/display are corrected before
  // the browser paints, otherwise the previous tab's node can flash on screen
  // for a frame while still visible.
  useLayoutEffect(() => {
    store.place(tabs, activeId, paneIdByTabId, ownBackground);
  });

  return (
    <>
      {store.portalOrder(tabs).map((tab) => {
        const paneId = paneIdByTabId.get(tab.id);
        const inPane = !!paneId;
        const activeInline = !inPane && tab.id === activeId;
        const isFocusedPane = inPane ? paneId === focusedPaneId : activeInline;
        return createPortal(
          <SurfaceScope
            kind="tab"
            className="h-full w-full"
            onClose={
              tab.id === "dashboard"
                ? undefined
                : () => shell.tabs.close(tab.id)
            }
          >
            {renderTabContent(tab, {
              shell: shell.callbacks,
              panelTargetTab: targetTerminal,
              isVisible: inPane || activeInline,
              isFocusedPane,
              inSplit: inPane,
            })}
          </SurfaceScope>,
          store.getNode(tab.id, ownBackground(tab)),
          tab.id,
        );
      })}
    </>
  );
}
