import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Sheet, SheetContent } from "@/components/sheet";
import { SurfaceScope } from "@/components/surface/surface-scope";
import { MobileBar } from "@/shell/MobileBar";
import { AppRail } from "@/sidebar/AppRail";
import { ComponentSlot } from "@/shell/ActionSlot";
import {
  isCoreRailView,
  railItemLabel,
  promotableIds,
  rightDockableIds,
} from "@/sidebar/rail-items";
import { DockPanel, DockReopenStrip } from "@/shell/DockPanel";
import { TabBar } from "@/shell/TabBar";
import { requestManage, type ManageMode } from "@/manage/manage-requests";
import { getTabType } from "@/shell/tab-registry";
import { getPanel, usePanels } from "@/shell/panel-registry";
import { PluginViewPlaceholder } from "@/plugin-host/PluginViewPlaceholder";
import type { TabType } from "@/types/ui-types";
import {
  ShellConfirmCapture,
  useShellController,
} from "@/shell/controller/ShellControllerProvider";
import { TabStage } from "@/shell/stage/TabStage";

const HostsPanel = lazy(() =>
  import("@/sidebar/HostsPanel").then((m) => ({ default: m.HostsPanel })),
);
const QuickConnectPanel = lazy(() =>
  import("@/sidebar/QuickConnectPanel").then((m) => ({
    default: m.QuickConnectPanel,
  })),
);
const SyncPanel = lazy(() =>
  import("@/settings/sync/SyncPanel").then((m) => ({
    default: m.SyncPanel,
  })),
);
const CredentialsPanel = lazy(() =>
  import("@/sidebar/CredentialsPanel").then((m) => ({
    default: m.CredentialsPanel,
  })),
);
const ConnectionsPanel = lazy(() =>
  import("@/sidebar/ConnectionsPanel").then((m) => ({
    default: m.ConnectionsPanel,
  })),
);

function SidebarPanelFallback() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="size-5 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground/70 animate-spin" />
    </div>
  );
}

/**
 * The look Termix has always had: icon rail, left sidebar, tab bar, right
 * dock and the mobile bottom bar. Built in until it moves to its own plugin.
 */
export function DefaultLayout() {
  const { t } = useTranslation();
  const shell = useShellController();
  const registeredPanels = usePanels();
  const { tabs, regions, hosts, isMobile } = shell;
  const { left, right } = regions;
  const closeOnMobile = () => {
    if (isMobile) left.setOpen(false);
  };

  // Every panel gets its own surface, so its inline views and confirms stay
  // inside it. Only the left dock widens for them.
  const panelScope = (
    view: string,
    owned: boolean,
    shown: boolean,
    children: React.ReactNode,
    className = "",
  ) => (
    <SurfaceScope
      key={view}
      kind="panel"
      onEditingChange={owned ? regions.scopeEditingSetter(view) : undefined}
      className={`${shown ? "" : "hidden"} ${className}`}
    >
      {children}
    </SurfaceScope>
  );

  /**
   * Sidebar panel content, shared between the desktop sidebar, the mobile
   * sheet and the right dock. Takes the view rather than reading the left
   * dock's so both docks can render from the same code.
   *
   * `owned` marks the dock responsible for the panels that stay mounted while
   * hidden (hosts, credentials, fleets). Only one dock may own them, otherwise
   * two live instances fight over the shared editing state.
   */
  const renderSidebarPanels = (railView: string, owned = true) => (
    <Suspense fallback={<SidebarPanelFallback />}>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {owned && (
          <>
            {panelScope(
              "hosts",
              owned,
              railView === "hosts",
              <HostsPanel
                onOpenTab={(host, type, options) => {
                  tabs.connectHost(host, type, options);
                  closeOnMobile();
                }}
                onEditHost={hosts.edit}
                onCloseSidebar={() => left.setOpen(false)}
                hostTree={hosts.tree ?? undefined}
                loading={hosts.loading}
                onEditingChange={regions.panelEditingSetter("hosts")}
                active={railView === "hosts"}
              />,
            )}
            {panelScope(
              "credentials",
              owned,
              railView === "credentials",
              <CredentialsPanel
                onEditingChange={regions.panelEditingSetter("credentials")}
                active={railView === "credentials"}
              />,
            )}
          </>
        )}

        {railView === "quick-connect" &&
          panelScope(
            "quick-connect",
            owned,
            true,
            <QuickConnectPanel
              onConnect={(host, type) => {
                tabs.open(host, type);
                closeOnMobile();
              }}
            />,
          )}

        {registeredPanels.map((panel) => {
          const shown = railView === panel.id;
          // A kept-mounted panel lives in the owning dock only, so two live
          // copies never fight over the same state.
          if (panel.keepMounted ? !owned : !shown) return null;
          const Panel = panel.component;
          return panelScope(
            panel.id,
            owned,
            shown,
            <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
              <Panel
                targetTab={tabs.targetTerminal}
                active={shown}
                shell={shell.panelCallbacks}
                setEditing={
                  owned ? regions.panelEditingSetter(panel.id) : () => undefined
                }
                activeTabType={tabs.active?.type ?? undefined}
                placement={owned ? "left" : "right"}
              />
            </div>,
          );
        })}

        {!isCoreRailView(railView) && !getPanel(railView) && (
          <PluginViewPlaceholder kind="panel" viewId={railView} compact />
        )}

        {railView === "connections" &&
          panelScope(
            "connections",
            owned,
            true,
            <div className="flex-1 min-h-0 overflow-y-auto">
              <ConnectionsPanel
                tabs={tabs.list}
                activeTabId={tabs.activeId}
                allHosts={hosts.list}
                backgroundTabRecords={tabs.background}
                onSwitchToTab={(tabId) => {
                  tabs.setActive(tabId);
                  closeOnMobile();
                }}
                onCloseTab={tabs.close}
                onReopenTab={(record, restoredSessionId) => {
                  const host = record.hostId
                    ? hosts.list.find((h) => h.id === String(record.hostId))
                    : undefined;
                  if (!host && !getTabType(record.tabType)?.hostless) return;
                  tabs.setBackground((prev) =>
                    prev.filter((r) => r.id !== record.id),
                  );
                  if (host) {
                    const effectiveSessionId =
                      restoredSessionId ?? record.backendSessionId ?? null;
                    tabs.open(host, record.tabType as TabType, {
                      instanceId: record.id,
                      restoredSessionId: effectiveSessionId,
                      savedLabel: record.label,
                    });
                  } else {
                    tabs.openSingleton(record.tabType as TabType);
                  }
                  closeOnMobile();
                }}
                onForgetBackground={(recordId) => {
                  tabs.setBackground((prev) =>
                    prev.filter((r) => r.id !== recordId),
                  );
                }}
                onRenameTab={tabs.rename}
                onReorderTabs={tabs.setList}
              />
            </div>,
          )}

        {railView === "sync" &&
          panelScope(
            "sync",
            owned,
            true,
            <div className="flex-1 min-h-0 overflow-y-auto">
              <SyncPanel />
            </div>,
          )}
      </div>
    </Suspense>
  );

  const sidebarPanelContent = renderSidebarPanels(left.view);

  const dockProps = (view: string) => ({
    // Titles come from the shared rail definitions so they stay translated
    // and in step with the rail itself.
    title: railItemLabel(view, t),
    onOpenAsTab: isMobile
      ? undefined
      : view === "hosts" || view === "credentials"
        ? () => requestManage({ kind: "browse", mode: view as ManageMode })
        : promotableIds().includes(view)
          ? () => tabs.openSingleton(view as TabType)
          : undefined,
  });

  return (
    <div
      className="flex flex-col w-screen bg-background"
      style={{ height: "100dvh" }}
    >
      <div className="flex flex-1 min-h-0">
        {/* Skinny icon rail, desktop only */}
        <AppRail
          railView={left.view}
          sidebarOpen={left.open}
          username={shell.username}
          isAdmin={shell.isAdmin}
          pluginsSettled={shell.pluginsSettled}
          onRailClick={regions.railClick}
          onOpenTab={tabs.openSingleton}
          onOpenInRightDock={regions.openInRightDock}
          onOpenSettings={() => tabs.openSingleton("settings")}
          onOpenNavigationSettings={() =>
            tabs.openSingleton("settings", undefined, undefined, {
              section: "appearance",
              reveal: "settings-navigation",
              revealAt: Date.now(),
            })
          }
          onOpenPalette={shell.palette.open}
          onLogout={shell.logout}
        />

        {/* Desktop: inline resizable sidebar */}
        {!isMobile && (
          <DockPanel
            side="left"
            {...dockProps(left.view)}
            open={left.open}
            width={left.width}
            editing={left.editing}
            dragging={left.dragging}
            onResizeStart={left.startResize}
            onClose={() => left.setOpen(false)}
            onMoveToRightDock={
              rightDockableIds().includes(left.view)
                ? () => regions.openInRightDock(left.view)
                : undefined
            }
            onResetWidth={left.resetWidth}
          >
            {sidebarPanelContent}
          </DockPanel>
        )}

        {/* Mobile: sidebar as overlay sheet */}
        {isMobile && (
          <Sheet open={left.open} onOpenChange={left.setOpen}>
            <SheetContent
              side="left"
              showCloseButton={false}
              className={`p-0 flex flex-col min-h-0 max-w-full bg-sidebar border-r border-border gap-0 ${left.editing ? "w-screen" : "w-[min(85vw,360px)]"}`}
              style={{ height: "100dvh" }}
            >
              <DockPanel
                side="left"
                {...dockProps(left.view)}
                open
                fill
                width={left.width}
                onClose={() => left.setOpen(false)}
              >
                {sidebarPanelContent}
              </DockPanel>
            </SheetContent>
          </Sheet>
        )}

        {/* Main content area */}
        <div
          className={`relative flex flex-col flex-1 min-w-0 overflow-hidden transition-[padding] duration-200 ${!isMobile && !left.open ? "pl-6" : ""}`}
        >
          {!isMobile && !left.open && (
            <DockReopenStrip onClick={() => left.setOpen(true)} />
          )}
          <SurfaceScope kind="tab" className="overflow-hidden">
            <ShellConfirmCapture />
            <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
              <TabBar
                tabs={tabs.topLevel}
                activeTabId={tabs.activeId}
                splits={shell.split.summaries}
                activeSplitFull={shell.split.activeFull}
                onSetActiveTab={tabs.setActive}
                onCloseTab={tabs.close}
                onRefreshTab={tabs.refresh}
                onReconnectDisconnected={tabs.reconnectAll}
                onReorderTabs={tabs.reorder}
                onSplitAction={shell.split.handleAction}
                onRenameTab={tabs.rename}
                isAppFullscreen={shell.fullscreen.active}
                onToggleAppFullscreen={shell.fullscreen.toggle}
                rightDockOpen={right.view !== null}
                onToggleRightDock={
                  isMobile ? undefined : regions.toggleRightDock
                }
                showTabNumbers={tabs.showNumbers}
              />
              <TabStage />
            </div>
          </SurfaceScope>

          {/* Bottom nav bar, mobile only. The desktop app keeps the rail. */}
          {!shell.isElectron && (
            <MobileBar
              railView={left.view}
              sidebarOpen={left.open}
              username={shell.username}
              onRailClick={regions.railClick}
              onOpenTab={(type) => tabs.openSingleton(type)}
              onOpenSettings={() => tabs.openSingleton("settings")}
              onOpenPalette={shell.palette.open}
              onLogout={() => shell.logout({ manual: true })}
            />
          )}
        </div>

        {/* Right dock, desktop only, holds a second reference panel */}
        {!isMobile && right.view && (
          <DockPanel
            side="right"
            {...dockProps(right.view)}
            open
            width={right.width}
            dragging={right.dragging}
            onResizeStart={right.startResize}
            onClose={() => right.setView(null)}
            onResetWidth={right.resetWidth}
          >
            {renderSidebarPanels(right.view, false)}
          </DockPanel>
        )}

        {/* Plugin panels pinned to the right edge, sized by the plugin */}
        <ComponentSlot slotId="shell.rightEdge" />
      </div>
    </div>
  );
}
