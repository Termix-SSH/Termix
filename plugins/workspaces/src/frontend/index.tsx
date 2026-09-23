import { LayoutTemplate } from "lucide-react";
import { toast } from "sonner";
import type { PanelProps, TermixApp } from "@termix/plugin-sdk/frontend";
import { WorkspacesPanel } from "./WorkspacesPanel";
import { createWorkspacesApi } from "./workspaces-api";
import type { Workspace } from "./types";

const LAST_SESSION_DELAY_MS = 2000;

export function activate(app: TermixApp): void {
  const api = createWorkspacesApi(app.api);

  const applyWorkspace = async (workspace: Workspace) => {
    const { skipped } = await app.tabs.applyLayout(workspace.payload, {
      name: workspace.name,
    });
    if (skipped.length > 0) {
      toast.warning(
        app.t("newUi.sidebar.workspaces.tabsSkipped", {
          count: skipped.length,
          names: skipped.join(", "),
        }),
      );
    }
    api.apply(workspace.id).catch(() => {});
  };

  function Panel({ active }: PanelProps) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <WorkspacesPanel
          active={active}
          currentPayload={() => app.tabs.getLayout()}
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
    permission: "use",
  });
  app.registerPanel("workspaces", Panel);

  // Without workspaces.use the restore and the autosave below would only
  // collect 403s. The lookup is cached, so asking each time is cheap and a
  // revoke takes effect.
  const allowed = () => app.hasPermission("use");

  // After login, a default workspace applies unless the session already
  // brought tabs back, which is the more precise restore.
  app.tabs.onReady(() => {
    const layout = app.tabs.getLayout() as { tabs?: unknown[] } | null;
    if (layout && (layout.tabs?.length ?? 0) > 0) return;
    void allowed().then(async (ok) => {
      if (!ok) return;
      try {
        const workspaces = await api.list();
        const preferred = workspaces.find(
          (workspace) => workspace.kind === "manual" && workspace.isDefault,
        );
        if (preferred) await applyWorkspace(preferred);
      } catch {
        // A failed restore leaves the empty session as it is.
      }
    });
  });

  // Keeps an implicit "last session" snapshot current, so an arrangement can
  // always be recovered even if it was never saved.
  let timer: ReturnType<typeof setTimeout> | null = null;
  app.tabs.onChange(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const layout = app.tabs.getLayout();
      if (!layout) return;
      void allowed().then((ok) => {
        if (ok) api.saveLastSession(layout).catch(() => {});
      });
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
