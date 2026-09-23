import { LayoutTemplate } from "lucide-react";
import i18next from "i18next";
import { toast } from "sonner";
import type { PanelProps, TermixApp } from "@termix/plugin-sdk/frontend";
import type { Workspace, WorkspacePayload } from "@/types/ui-types";
import { WorkspacesPanel } from "./WorkspacesPanel";
import {
  applyWorkspaceServer,
  listWorkspaces,
  saveLastSessionWorkspace,
} from "./workspaces-api";

const LAST_SESSION_DELAY_MS = 2000;

export function activate(app: TermixApp): void {
  const applyWorkspace = async (workspace: Workspace) => {
    const { skipped } = await app.tabs.applyLayout(
      workspace.payload as unknown as Parameters<
        typeof app.tabs.applyLayout
      >[0],
      { name: workspace.name },
    );
    if (skipped.length > 0) {
      toast.warning(
        i18next.t("workspaces:newUi.sidebar.workspaces.tabsSkipped", {
          count: skipped.length,
          names: skipped.join(", "),
        }),
      );
    }
    applyWorkspaceServer(workspace.id).catch(() => {});
  };

  function Panel({ active }: PanelProps) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <WorkspacesPanel
          active={active}
          currentPayload={() =>
            app.tabs.getLayout() as unknown as WorkspacePayload
          }
          onApplyWorkspace={(workspace) => void applyWorkspace(workspace)}
        />
      </div>
    );
  }

  app.registerRailItem({
    id: "workspaces",
    icon: LayoutTemplate,
    titleKey: "nav.workspaces",
    after: "split-screen",
  });
  app.registerPanel("workspaces", Panel);

  // After login, a default workspace applies unless the session already
  // brought tabs back, which is the more precise restore.
  app.tabs.onReady(() => {
    const layout = app.tabs.getLayout() as unknown as WorkspacePayload | null;
    if (layout && layout.tabs.length > 0) return;
    listWorkspaces()
      .then((workspaces) => {
        const preferred = workspaces.find(
          (workspace) => workspace.kind === "manual" && workspace.isDefault,
        );
        if (preferred) void applyWorkspace(preferred);
      })
      .catch(() => {});
  });

  // Keeps an implicit "last session" snapshot current, so an arrangement can
  // always be recovered even if it was never saved.
  let timer: ReturnType<typeof setTimeout> | null = null;
  app.tabs.onChange(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const layout = app.tabs.getLayout();
      if (layout) {
        saveLastSessionWorkspace(layout as unknown as WorkspacePayload).catch(
          () => {},
        );
      }
    }, LAST_SESSION_DELAY_MS);
  });
  app.onDispose(() => {
    if (timer) clearTimeout(timer);
  });

  app.registerSlotContribution("onboarding.workflow", {
    actionId: "workspaces.tip",
    titleKey: "onboarding.workflow_workspaces",
    descriptionKey: "onboarding.workflow_workspaces_desc",
    icon: LayoutTemplate,
  });
}
