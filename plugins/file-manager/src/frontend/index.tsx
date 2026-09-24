import type { ComponentType } from "react";
import { FolderSearch, ArrowLeftRight } from "lucide-react";
import {
  invokeAction,
  type PluginHostRecord,
  type StandaloneViewProps,
  type TabProps,
  type TermixApp,
} from "@termix/plugin-sdk/frontend";
import { GRID_SIZE } from "@/types/homepage-types";
import { FileManager } from "./FileManager.tsx";
import FileManagerApp from "./FileManagerApp.tsx";
import { SftpTransferTab } from "./SftpTransferTab.tsx";
import { HostFilesTab } from "./HostFilesTab.tsx";
import { FileManagerWidget } from "./homepage/FileManagerWidget.tsx";
import { FileManagerWidgetEditForm } from "./homepage/FileManagerWidgetEditForm.tsx";
import { startTransferMonitor } from "./TransferMonitor.tsx";

function FilesTab({ tab, host, sshHost, isVisible }: TabProps) {
  const data = tab.data as
    { initialFilePath?: string; initialPath?: string } | undefined;
  return (
    <FileManager
      initialHost={sshHost as never}
      initialFilePath={data?.initialFilePath}
      initialPath={data?.initialPath}
      isVisible={isVisible}
      onOpenTerminalTab={
        host
          ? (path) => void invokeAction("terminal.open", host, { path })
          : undefined
      }
    />
  );
}

function FilesStandalone({ hostId, params }: StandaloneViewProps) {
  return (
    <FileManagerApp
      hostId={hostId}
      initialPath={params.get("path") ?? undefined}
    />
  );
}

function SftpTab() {
  return <SftpTransferTab />;
}

function openHostAction(
  app: TermixApp,
  host: PluginHostRecord | null,
  path: string | undefined,
): void {
  if (!host) return;
  app.tabs.openTab(host, "files", { data: { initialPath: path } });
}

function openEditorAction(
  app: TermixApp,
  host: PluginHostRecord | null,
  filePath: string,
): void {
  if (!host) return;
  app.tabs.openTab(host, "files", { data: { initialFilePath: filePath } });
}

export function activate(app: TermixApp): void {
  app.registerTab("files", FilesTab as unknown as ComponentType<TabProps>, {
    icon: FolderSearch,
    titleKey: "nav.files",
    requiresHost: true,
    noHostMessageKey: "fileManager.noHostSelected",
    persistent: true,
    standalone: FilesStandalone,
    // The pre-conversion `?view=file-manager` link keeps resolving.
    standaloneViews: ["file-manager"],
    // The activity log still records "file_manager" (matching the backend's
    // stored string), so recent-activity entries resolve to this tab.
    activityTypes: ["file_manager"],
  });

  app.registerTab("sftp", SftpTab as unknown as ComponentType<TabProps>, {
    icon: ArrowLeftRight,
    titleKey: "nav.sftp",
    hostless: true,
    inLayouts: false,
  });

  app.registerRailItem({
    id: "sftp",
    icon: ArrowLeftRight,
    titleKey: "nav.sftp",
    kind: "tab",
    after: "ssh-tools",
    permission: "use",
  });

  app.registerHostAction({
    id: "files",
    titleKey: "nav.files",
    icon: FolderSearch,
    kind: "open",
    order: 20,
    tabType: "files",
    copyUrlView: "file-manager",
    when: (host) => !!host.enableSsh && host.enableFileManager !== false,
  });

  app.registerHostEditorSection({
    id: "files",
    group: "ssh",
    titleKey: "hosts.tabFiles",
    icon: FolderSearch,
    order: 60,
    component: HostFilesTab as never,
  });

  app.registerHomepageWidget({
    id: "file_manager_widget",
    name: "File Manager",
    description: "Embedded SFTP file manager for a configured host",
    category: "system",
    icon: <FolderSearch size={14} />,
    defaultConfig: { hostId: 0 },
    defaultSize: { w: GRID_SIZE * 20, h: GRID_SIZE * 14 },
    minSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 8 },
    component: FileManagerWidget as never,
    editFormComponent: FileManagerWidgetEditForm as never,
  });

  app.registerAction("files.openHost", ((
    host: PluginHostRecord | null,
    path?: string,
  ) => openHostAction(app, host, path)) as never);
  app.registerAction("files.openEditor", ((
    host: PluginHostRecord | null,
    filePath: string,
  ) => openEditorAction(app, host, filePath)) as never);

  app.registerSlotContribution("onboarding.features", {
    actionId: "file-manager.feature",
    titleKey: "onboarding.feature_files",
    descriptionKey: "onboarding.feature_files_desc",
    icon: FolderSearch as ComponentType<{ className?: string }>,
  });

  const stopTransferMonitor = startTransferMonitor(app.t);
  app.onDispose(stopTransferMonitor);
}
